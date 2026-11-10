/**
 * Each measurement runs in its own `node --expose-gc` process so that peak memory, JIT state
 * and GC pressure from one measurement can't leak into another. The parent (run.ts) passes
 * a task name and JSON args; the child prints one `RESULT {json}` line on stdout.
 * Progress goes to stderr.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { gzipSync } from "node:zlib";
import { loadExamples } from "../data/load.ts";
import type { Split } from "../data/paths.ts";
import { asScoredParse, type Span } from "../types.ts";
import { startHeapWindow } from "./heap.ts";
import { importImpl } from "./impl.ts";
import { startRssSampler } from "./rss-sampler.ts";
import { MB, mean, median, percentile } from "./stats.ts";

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("run with --expose-gc");

function settle(): number {
  gc!();
  gc!();
  return process.memoryUsage().rss;
}
/** Process-lifetime peak, including startup and data loading. */
const peakRss = () => process.resourceUsage().maxRSS * 1024;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const countTokens = (texts: readonly string[]) =>
  texts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0);

interface Common {
  impl: string;
  split: Split;
  n: number;
}

export interface TrainArgs extends Common {
  seed: number;
  /** The training blend's dataset weights. */
  weights: Record<string, number>;
  out: string;
}
async function train(a: TrainArgs) {
  const impl = await importImpl(a.impl);
  const examples = await loadExamples(a.split, a.n, a.weights);
  const tokens = countTokens(examples.map((e) => e.text));
  const sampler = await startRssSampler();
  const rssBefore = settle();
  sampler.reset();
  const endHeap = startHeapWindow();
  const t0 = now();
  const result = await impl.train(examples, {
    seed: a.seed,
    log: (m) => process.stderr.write(`[${a.impl} train] ${m}\n`),
  });
  const seconds = (now() - t0) / 1000;
  const heap = endHeap();
  const windowPeak = sampler.peak();
  await sampler.stop();
  writeFileSync(a.out, result.model);
  return {
    seconds,
    examplesPerSec: a.n / seconds,
    tokensPerSec: tokens / seconds,
    peakRssMB: peakRss() / MB,
    peakRssOverBaselineMB: (windowPeak - rssBefore) / MB,
    baselineRssMB: rssBefore / MB,
    peakHeapOverBaselineMB: heap.peakOverBaseline / MB,
    allocatedMB: heap.allocated === undefined ? undefined : heap.allocated / MB,
    modelBytes: result.model.byteLength,
    info: result.info ?? {},
  };
}

export interface ModelArgs extends Common {
  model: string;
}

export interface PredictArgs extends ModelArgs {
  out: string;
}
async function predict(a: PredictArgs) {
  const impl = await importImpl(a.impl);
  const examples = await loadExamples(a.split, a.n);
  const parser = impl.load(readFileSync(a.model));
  const lines: string[] = [];
  let errors = 0;
  let firstError: string | undefined;
  for (const ex of examples) {
    let spans: Span[] = [];
    let confidence: number | undefined;
    try {
      ({ spans, confidence } = asScoredParse(parser.parse(ex.text)));
    } catch (e) {
      errors++;
      firstError ??= `${ex.id}: ${String(e)}`;
    }
    lines.push(JSON.stringify({ id: ex.id, spans, confidence }));
  }
  writeFileSync(a.out, lines.join("\n") + "\n");
  return { parseErrors: errors, firstError };
}

async function memory(a: ModelArgs) {
  const impl = await importImpl(a.impl);
  const texts = (await loadExamples(a.split, a.n)).map((e) => e.text);
  const bytes = readFileSync(a.model);
  const sampler = await startRssSampler();
  const rss0 = settle();
  const heap0 = process.memoryUsage().heapUsed;
  sampler.reset();
  const endHeap = startHeapWindow();

  const t0 = now();
  const parser = impl.load(bytes);
  const loadMs = now() - t0;
  const t1 = now();
  parser.parse(texts[0]!);
  const firstParseMs = now() - t1;

  const rssLoaded = settle();
  const heapLoaded = process.memoryUsage().heapUsed;
  for (const t of texts) parser.parse(t);
  const heap = endHeap();
  const windowPeak = sampler.peak();
  await sampler.stop();
  return {
    modelBytes: bytes.byteLength,
    modelGzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    loadMs,
    firstParseMs,
    modelHeapMB: (heapLoaded - heap0) / MB,
    modelRssMB: (rssLoaded - rss0) / MB,
    peakRssMB: peakRss() / MB,
    peakRssOverBaselineMB: (windowPeak - rss0) / MB,
    baselineRssMB: rss0 / MB,
    peakHeapOverBaselineMB: heap.peakOverBaseline / MB,
  };
}

export interface LatencyArgs extends ModelArgs {
  warmupPasses: number;
  calls: number;
}
async function latency(a: LatencyArgs) {
  const impl = await importImpl(a.impl);
  const texts = (await loadExamples(a.split, a.n)).map((e) => e.text);
  const parser = impl.load(readFileSync(a.model));
  for (let p = 0; p < a.warmupPasses; p++) for (const t of texts) parser.parse(t);
  settle();

  const us = new Float64Array(a.calls);
  let sink = 0;
  for (let i = 0; i < a.calls; i++) {
    const text = texts[i % texts.length]!;
    const t0 = process.hrtime.bigint();
    const result = parser.parse(text);
    us[i] = Number(process.hrtime.bigint() - t0) / 1e3;
    sink += asScoredParse(result).spans.length;
  }
  if (sink < 0) console.error(sink);
  const meanTokens = countTokens(texts) / texts.length;
  const sorted = us.slice().sort();
  const meanUs = mean(us);
  return {
    calls: a.calls,
    meanUs,
    p50Us: percentile(sorted, 0.5),
    p90Us: percentile(sorted, 0.9),
    p99Us: percentile(sorted, 0.99),
    p999Us: percentile(sorted, 0.999),
    maxUs: sorted[sorted.length - 1]!,
    usPerToken: meanUs / meanTokens,
  };
}

export interface ThroughputArgs extends ModelArgs {
  seconds: number;
  repeats: number;
  threads: number;
}
async function throughput(a: ThroughputArgs) {
  const texts = (await loadExamples(a.split, a.n)).map((e) => e.text);
  const tokensPerText = countTokens(texts) / texts.length;
  const runs: number[] = [];
  for (let r = 0; r < a.repeats; r++) {
    const workers = Array.from(
      { length: a.threads },
      () =>
        new Worker(new URL("./throughput-worker.ts", import.meta.url), {
          workerData: { impl: a.impl, model: a.model, texts, seconds: a.seconds },
        }),
    );
    await Promise.all(workers.map((w) => new Promise((resolve) => w.once("message", resolve))));
    const done = workers.map(
      (w) =>
        new Promise<{ calls: number; seconds: number }>((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
        }),
    );
    for (const w of workers) w.postMessage("go");
    const results = await Promise.all(done);
    await Promise.all(workers.map((w) => w.terminate()));
    runs.push(results.reduce((s, r) => s + r.calls / r.seconds, 0));
  }
  const callsPerSec = median(runs);
  return {
    threads: a.threads,
    callsPerSec,
    tokensPerSec: callsPerSec * tokensPerText,
    runs,
  };
}

const tasks = { train, predict, memory, latency, throughput } as const;
export type Task = keyof typeof tasks;

const [task, json] = process.argv.slice(2) as [Task, string];
const fn = tasks[task] as (a: unknown) => Promise<unknown>;
if (!fn) throw new Error(`unknown task ${task}`);
const result = await fn(JSON.parse(json));
process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
