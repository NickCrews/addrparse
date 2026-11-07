/**
 * Trains and measures implementations, saves a run to results/runs/, and prints its headline
 * metrics against the previous run of the same impl, suite and split.
 *
 *   pnpm eval <impl...> [--suite quick] [--split dev|test]
 *                       [--only accuracy,memory,latency,throughput,determinism,curve] [--retrain]
 *
 * Each measurement is a fresh child process (child.ts). Models are cached in
 * models/<impl>/<key>.bin, keyed by the impl's source hash, training data hash, seed and size;
 * `--retrain` ignores the cache.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SUITES, type Suite, type SuiteName } from "../../eval.config.ts";
import { hashSplit, loadExamples } from "../data/load.ts";
import { MODELS_DIR, PREDICTIONS_DIR, ROOT, type Split } from "../data/paths.ts";
import type { Example, ScoredParse } from "../types.ts";
import { scoreAll, TARGET_EXACT_MATCH } from "./accuracy.ts";
import type {
  LatencyArgs,
  PredictArgs,
  ModelArgs,
  Task,
  ThroughputArgs,
  TrainArgs,
} from "./child.ts";
import { implCodeSize, implSourceHash, listImpls } from "./impl.ts";
import { c, comparabilityNotes, deltaTable, detailTables, sideBySideTable } from "./report.ts";
import { loadRuns, saveRun, type RunResult } from "./results.ts";

const STEPS = ["accuracy", "memory", "latency", "throughput", "determinism", "curve"] as const;
type Step = (typeof STEPS)[number];
type Training = NonNullable<RunResult["metrics"]["training"]>;

const { values: opts, positionals: impls } = parseArgs({
  allowPositionals: true,
  options: {
    suite: { type: "string", default: "quick" },
    split: { type: "string" },
    only: { type: "string" },
    retrain: { type: "boolean", default: false },
  },
});

if (impls.length === 0) {
  console.error(
    `usage: pnpm eval <impl...> [--suite ${Object.keys(SUITES).join("|")}] [--split dev|test]` +
      ` [--only ${STEPS.join(",")}] [--retrain]\nimpls: ${listImpls().join(", ")}`,
  );
  process.exit(2);
}
const unknown = impls.filter((i) => !listImpls().includes(i));
if (unknown.length) {
  console.error(
    `no impls/<name>/index.ts for ${unknown.join(", ")}; impls: ${listImpls().join(", ")}`,
  );
  process.exit(2);
}
if (!(opts.suite! in SUITES)) throw new Error(`unknown suite ${opts.suite}`);
const suiteName = opts.suite as SuiteName;
const split = (opts.split ?? SUITES[suiteName].split) as Split;
if (split !== "dev" && split !== "test") throw new Error(`--split must be dev or test`);
const config: Suite = { ...SUITES[suiteName], split };
const only = opts.only?.split(",") as Step[] | undefined;
for (const s of only ?? []) if (!STEPS.includes(s)) throw new Error(`unknown step ${s}`);
const enabled = (s: Step) =>
  only
    ? only.includes(s)
    : s === "determinism"
      ? config.determinism
      : s === "curve"
        ? config.learningCurve.length > 0
        : true;

const log = (msg: string) => process.stderr.write(msg + "\n");
const now = () => performance.now();
const secs = (t0: number) => `${((now() - t0) / 1000).toFixed(1)}s`;

/** Runs `child.ts <task>` in a fresh process and returns its RESULT. */
function runChild<T>(task: Task, args: object, nodeFlags: string[] = []): Promise<T> {
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      ...nodeFlags,
      join(import.meta.dirname, "child.ts"),
      task,
      JSON.stringify(args),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      if (code === 0 && line) resolve(JSON.parse(line.slice("RESULT ".length)) as T);
      else reject(new Error(`${task} child exited with ${signal ?? code}`));
    });
  });
}

const sha256 = (buf: Uint8Array | string) => createHash("sha256").update(buf).digest("hex");

/** Trains `impl` on the first `n` training examples unless a cached model exists. */
async function ensureModel(impl: string, implHash: string, n: number) {
  const trainHash = await hashSplit("train", n);
  const key = sha256([implHash, trainHash, config.seed, n].join("|")).slice(0, 16);
  const dir = join(MODELS_DIR, impl);
  const model = join(dir, `${key}.bin`);
  const metaPath = join(dir, `${key}.train.json`);
  if (!opts.retrain && existsSync(model) && existsSync(metaPath)) {
    const training = JSON.parse(readFileSync(metaPath, "utf8")) as Training;
    return { model, trainHash, training: { ...training, cached: true } };
  }
  mkdirSync(dir, { recursive: true });
  const t0 = now();
  log(`  train ${n.toLocaleString("en-US")} examples …`);
  const result = await runChild<Omit<Training, "cached">>(
    "train",
    { impl, split: "train", n, seed: config.seed, out: model } satisfies TrainArgs,
    ["--max-old-space-size=16384"],
  );
  writeFileSync(metaPath, JSON.stringify(result, null, 2) + "\n");
  log(`  train done in ${secs(t0)}`);
  return { model, trainHash, training: { ...result, cached: false } };
}

/** Predicts the eval set into `out` and returns the predictions in eval order. */
async function predict(impl: string, model: string, out: string, examples: readonly Example[]) {
  const r = await runChild<{ parseErrors: number; firstError?: string }>("predict", {
    impl,
    split,
    n: config.evalExamples,
    model,
    out,
  } satisfies PredictArgs);
  const byId = new Map<string, ScoredParse>();
  for (const line of readFileSync(out, "utf8").split("\n")) {
    if (!line) continue;
    const p = JSON.parse(line) as ScoredParse & { id: string };
    byId.set(p.id, p);
  }
  const parses = examples.map((ex) => byId.get(ex.id));
  return {
    ...r,
    predictions: parses.map((p) => p?.spans ?? []),
    confidences: parses.map((p) => p?.confidence),
  };
}

function gitInfo(): RunResult["git"] {
  const git = (...args: string[]) => spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
  const head = git("rev-parse", "HEAD");
  // Saved runs are results, not code; they don't make the tree dirty.
  const status = git("status", "--porcelain", "--", ".", ":!results");
  return {
    sha: head.status === 0 ? head.stdout.trim() : null,
    dirty: status.status === 0 ? status.stdout.trim() !== "" : true,
  };
}

function machineInfo(): RunResult["machine"] {
  return {
    cpu: os.cpus()[0]?.model ?? "unknown",
    cores: os.availableParallelism(),
    memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.platform()} ${os.release()}`,
    node: process.version,
  };
}

async function evalImpl(impl: string, evalExamples: readonly Example[], evalHash: string) {
  const started = new Date();
  const local = new Date(started.getTime() - started.getTimezoneOffset() * 60_000);
  const runId = [
    local.toISOString().slice(0, 19).replaceAll(":", "-"),
    impl,
    suiteName + (split === "test" ? "-test" : ""),
  ].join("__");
  const tImpl = now();
  log(c.bold(`${impl}`) + c.dim(` (${runId})`));

  const implHash = implSourceHash(impl);
  const main = await ensureModel(impl, implHash, config.trainExamples);
  if (main.training.cached) log(`  train: cached model`);
  const metrics: RunResult["metrics"] = { training: main.training, code: implCodeSize(impl) };
  const modelArgs: ModelArgs = { impl, split, n: config.evalExamples, model: main.model };

  if (enabled("accuracy")) {
    const t0 = now();
    mkdirSync(PREDICTIONS_DIR, { recursive: true });
    const out = join(PREDICTIONS_DIR, `${runId}.jsonl`);
    const p = await predict(impl, main.model, out, evalExamples);
    metrics.accuracy = {
      ...scoreAll(evalExamples, p.predictions, p.confidences),
      parseErrors: p.parseErrors,
      firstParseError: p.firstError,
    };
    const a = metrics.accuracy;
    log(
      `  accuracy: exact ${(a.exactMatch * 100).toFixed(2)}%, token ${(a.tokenAccuracy * 100).toFixed(2)}% (${secs(t0)})`,
    );
    const rc = a.riskCoverage;
    if (rc) {
      const at = rc.atTarget;
      log(
        `  risk–coverage: AURC ${(rc.aurc * 100).toFixed(2)}%, ` +
          (at
            ? `${(at.target * 100).toFixed(0)}% exact at ${(at.coverage * 100).toFixed(1)}% coverage (confidence ≥ ${at.threshold.toPrecision(3)})`
            : `${(TARGET_EXACT_MATCH * 100).toFixed(0)}% exact not reached`),
      );
    }
    const unscored = p.confidences.filter((x) => typeof x !== "number" || !Number.isFinite(x));
    if (!rc && unscored.length < p.confidences.length) {
      log(
        c.yellow(
          `  risk–coverage skipped: ${unscored.length} parses had no finite confidence (parse errors count)`,
        ),
      );
    }
    if (p.parseErrors) log(c.red(`  ${p.parseErrors} parse errors, first: ${p.firstError}`));
  }
  if (enabled("memory")) {
    const t0 = now();
    metrics.memory = await runChild("memory", modelArgs);
    log(`  memory: load ${metrics.memory!.loadMs.toFixed(1)} ms (${secs(t0)})`);
  }
  if (enabled("latency")) {
    const t0 = now();
    metrics.latency = await runChild("latency", {
      ...modelArgs,
      ...config.latency,
    } satisfies LatencyArgs);
    log(`  latency: p50 ${metrics.latency!.p50Us.toFixed(1)} µs (${secs(t0)})`);
  }
  if (enabled("throughput")) {
    metrics.throughput = {};
    for (const threads of config.throughput.threads) {
      const t0 = now();
      const r = await runChild<NonNullable<RunResult["metrics"]["throughput"]>[string]>(
        "throughput",
        {
          ...modelArgs,
          seconds: config.throughput.seconds,
          repeats: config.throughput.repeats,
          threads,
        } satisfies ThroughputArgs,
      );
      metrics.throughput[String(threads)] = r;
      log(
        `  throughput ${threads}t: ${Math.round(r.callsPerSec).toLocaleString("en-US")}/s (${secs(t0)})`,
      );
    }
  }
  if (enabled("determinism")) {
    const t0 = now();
    const again = join(MODELS_DIR, impl, `determinism-${process.pid}.bin`);
    await runChild(
      "train",
      {
        impl,
        split: "train",
        n: config.trainExamples,
        seed: config.seed,
        out: again,
      } satisfies TrainArgs,
      ["--max-old-space-size=16384"],
    );
    const hashes: [string, string] = [
      sha256(readFileSync(main.model)).slice(0, 16),
      sha256(readFileSync(again)).slice(0, 16),
    ];
    rmSync(again);
    metrics.determinism = { identical: hashes[0] === hashes[1], hashes };
    const verdict = metrics.determinism.identical ? c.green("identical") : c.red("DIFFERENT");
    log(`  determinism: ${verdict} (${secs(t0)})`);
  }
  if (enabled("curve")) {
    metrics.learningCurve = [];
    const sizes = [...new Set([...config.learningCurve, config.trainExamples])].sort(
      (a, b) => a - b,
    );
    for (const n of sizes) {
      const t0 = now();
      const { model } = n === config.trainExamples ? main : await ensureModel(impl, implHash, n);
      const out = join(os.tmpdir(), `addrparse-curve-${process.pid}.jsonl`);
      const p = await predict(impl, model, out, evalExamples);
      rmSync(out);
      const a = scoreAll(evalExamples, p.predictions);
      metrics.learningCurve.push({
        trainExamples: n,
        exactMatch: a.exactMatch,
        tokenAccuracy: a.tokenAccuracy,
      });
      log(
        `  curve ${n.toLocaleString("en-US")}: exact ${(a.exactMatch * 100).toFixed(2)}% (${secs(t0)})`,
      );
    }
  }

  const run: RunResult = {
    runId,
    timestamp: started.toISOString(),
    impl,
    suite: suiteName,
    config,
    git: gitInfo(),
    implHash,
    data: { trainHash: main.trainHash, evalHash },
    machine: machineInfo(),
    metrics,
  };
  // Baseline: the latest earlier run that measured at least what this one did, so `--only`
  // runs don't become the baseline for a full one; failing that, the latest earlier run.
  const measured = Object.keys(metrics) as (keyof RunResult["metrics"])[];
  const earlier = loadRuns().filter(
    (r) => r.impl === impl && r.suite === suiteName && r.config.split === split,
  );
  const previous =
    earlier.filter((r) => measured.every((k) => r.metrics[k] !== undefined)).at(-1) ??
    earlier.at(-1);
  const path = saveRun(run);
  log(c.dim(`  saved ${path} (${secs(tImpl)})`));
  return { run, previous };
}

const evalExamples = await loadExamples(split, config.evalExamples);
const evalHash = await hashSplit(split, config.evalExamples);
log(
  c.dim(
    `suite ${suiteName}: train ${config.trainExamples.toLocaleString("en-US")}, ` +
      `eval ${config.evalExamples.toLocaleString("en-US")} ${split}`,
  ),
);

const done: { run: RunResult; previous?: RunResult }[] = [];
let failed = false;
for (const impl of impls) {
  try {
    const r = await evalImpl(impl, evalExamples, evalHash);
    done.push(r);
    if (r.run.metrics.accuracy?.parseErrors) failed = true;
    if (r.run.metrics.determinism?.identical === false) failed = true;
  } catch (e) {
    failed = true;
    log(c.red(`  ${impl} failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

for (const { run, previous } of done) {
  console.log(`\n${c.bold(run.impl)} ${c.dim(run.runId)}`);
  if (!previous) console.log(c.dim("first run of this impl, suite and split"));
  console.log(deltaTable(previous, run));
  for (const n of previous ? comparabilityNotes([previous, run]) : []) console.log(n);
  const det = run.metrics.determinism;
  if (det) {
    console.log(
      det.identical
        ? `determinism: ${c.green("identical")} model bytes from two trainings`
        : c.red(`determinism: training twice gave different models (${det.hashes.join(" ≠ ")})`),
    );
  }
  if (run.metrics.learningCurve) console.log("\n" + detailTables([run], ["this run"], ["curve"]));
}
if (done.length > 1) {
  console.log();
  console.log(
    sideBySideTable(
      done.map((d) => d.run),
      done.map((d) => d.run.impl),
    ),
  );
}
if (failed) process.exit(1);
