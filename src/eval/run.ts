/**
 * Trains and measures implementations, saves a run to results/runs/, and prints its headline
 * metrics against the previous run of the same impl, suite and split.
 *
 *   pnpm eval <impl...> [--suite quick] [--split dev|test]
 *                       [--only accuracy,memory,bundle,latency,throughput,determinism,curve]
 *                       [--retrain]
 *                       [--blend <name>] [--use <dataset|tag>,...] [--without <dataset|tag>,...]
 *                       [--mix <dataset>=<weight> ...]
 *
 * The blend flags choose the training set's datasets and weights (`src/data/blend.ts`; named
 * blends are BLENDS in eval.config.ts). The eval set always uses the default blend, so runs with
 * different training blends are scored on the same examples. A run is compared with the previous
 * run of the same impl, suite, split and training blend.
 *
 * Each measurement is a fresh child process (child.ts). Models are cached in
 * models/<impl>/<key>.bin, keyed by the impl's source hash, training data hash, seed and size;
 * `--retrain` ignores the cache. A cached model carries the training metrics, and when and where
 * they were measured, from the run that trained it.
 *
 * A reference impl (`ReferenceImpl`, e.g. usaddress) is trained elsewhere and runs out of
 * process, so only its accuracy is measured; `--only` and `--retrain` don't apply to it.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BLENDS, DATASET_WEIGHTS, SUITES, type Suite, type SuiteName } from "../../eval.config.ts";
import {
  blendLabel,
  isDefaultBlend,
  parseList,
  parseWeights,
  resolveBlend,
  type Blend,
} from "../data/blend.ts";
import { hashSplit, loadExamples, readManifest } from "../data/load.ts";
import { MODELS_DIR, PREDICTIONS_DIR, type Split } from "../data/paths.ts";
import type { Example, ReferenceImpl, ReferencePrediction } from "../types.ts";
import { scoreAll, TARGET_EXACT_MATCH } from "./accuracy.ts";
import { bundleImpl } from "./bundle.ts";
import type { LatencyArgs, PredictArgs, ModelArgs, ThroughputArgs } from "./child.ts";
import {
  ensureModel as ensureCachedModel,
  gitInfo,
  machineInfo,
  runChild,
  sha256,
  trainInChild,
  type Training,
} from "./models.ts";
import { implCodeSize, implSourceHash, importReference, listImpls } from "./impl.ts";
import { c, comparabilityNotes, deltaTable, detailTables, sideBySideTable } from "./report.ts";
import { loadRuns, readPredictions, saveRun, trainBlendOf, type RunResult } from "./results.ts";

const STEPS = [
  "accuracy",
  "memory",
  "bundle",
  "latency",
  "throughput",
  "determinism",
  "curve",
] as const;
type Step = (typeof STEPS)[number];

const { values: opts, positionals: impls } = parseArgs({
  allowPositionals: true,
  options: {
    suite: { type: "string", default: "quick" },
    split: { type: "string" },
    only: { type: "string" },
    retrain: { type: "boolean", default: false },
    blend: { type: "string" },
    use: { type: "string", multiple: true, default: [] },
    without: { type: "string", multiple: true, default: [] },
    mix: { type: "string", multiple: true, default: [] },
  },
});

if (impls.length === 0) {
  console.error(
    `usage: pnpm eval <impl...> [--suite ${Object.keys(SUITES).join("|")}] [--split dev|test]` +
      ` [--only ${STEPS.join(",")}] [--retrain]` +
      ` [--blend ${Object.keys(BLENDS).join("|")}] [--use a,b] [--without a,b] [--mix name=w]` +
      `\nimpls: ${listImpls().join(", ")}`,
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

if (opts.blend !== undefined && !Object.hasOwn(BLENDS, opts.blend)) {
  throw new Error(`unknown blend ${opts.blend}; blends: ${Object.keys(BLENDS).join(", ")}`);
}
const named: Blend = opts.blend ? BLENDS[opts.blend]! : {};
const flags: Blend = {
  use: parseList(opts.use!),
  without: parseList(opts.without!),
  weights: parseWeights(opts.mix!),
};
const trainBlend: Blend = {
  use: flags.use!.length ? flags.use : named.use,
  without: [...(named.without ?? []), ...flags.without!],
  weights: { ...named.weights, ...flags.weights },
};
const built = Object.keys(readManifest().datasets);
const trainWeights = resolveBlend(trainBlend, built);
/** "default", the named blend, or the flags; flags after a named blend are appended to it. */
const trainBlendName = opts.blend
  ? [opts.blend, ...(isDefaultBlend(flags) ? [] : [blendLabel(flags)])].join("+")
  : blendLabel(trainBlend);

const log = (msg: string) => process.stderr.write(msg + "\n");
const now = () => performance.now();
const secs = (t0: number) => `${((now() - t0) / 1000).toFixed(1)}s`;

const ensureModel = (impl: string, implHash: string, n: number) =>
  ensureCachedModel({
    impl,
    implHash,
    n,
    seed: config.seed,
    weights: trainWeights,
    retrain: opts.retrain,
    log,
  });

/** Predicts the eval set into `out` and returns the predictions in eval order. */
async function predict(impl: string, model: string, out: string, examples: readonly Example[]) {
  const r = await runChild<{ parseErrors: number; firstError?: string }>("predict", {
    impl,
    split,
    n: config.evalExamples,
    model,
    out,
  } satisfies PredictArgs);
  const byId = readPredictions(out);
  const parses = examples.map((ex) => byId.get(ex.id));
  return {
    ...r,
    spans: parses.map((p) => p?.spans ?? []),
    confidences: parses.map((p) => p?.confidence),
  };
}

/** "measured 2026-11-06 18:52 at abc1234 on <cpu>", noting a machine other than this one. */
function trainingProvenance(t: Training): string {
  const m = t.measured;
  if (!m) return "training metrics of unknown age";
  let s = `training measured ${m.at.slice(0, 16).replace("T", " ")} UTC`;
  if (m.git?.sha) s += ` at ${m.git.sha.slice(0, 7)}${m.git.dirty ? "+dirty" : ""}`;
  if (m.machine && m.machine.cpu !== machineInfo().cpu) s += c.yellow(` on ${m.machine.cpu}`);
  return s + "; --retrain re-measures";
}

function newRunId(impl: string, started: Date): string {
  const local = new Date(started.getTime() - started.getTimezoneOffset() * 60_000);
  return [
    local.toISOString().slice(0, 19).replaceAll(":", "-"),
    impl,
    suiteName + (split === "test" ? "-test" : ""),
    ...(trainBlendName === "default" ? [] : [trainBlendName.replace(/[^\w.,=+-]/g, "_")]),
  ].join("__");
}

/**
 * The latest earlier run of the same impl, suite, split and training blend that measured at least
 * what `run` did, so `--only` runs don't become the baseline for a full one; failing that, the
 * latest earlier run.
 */
function previousRun(run: RunResult): RunResult | undefined {
  const measured = Object.keys(run.metrics) as (keyof RunResult["metrics"])[];
  const earlier = loadRuns().filter(
    (r) =>
      r.impl === run.impl &&
      r.suite === suiteName &&
      r.config.split === split &&
      trainBlendOf(r) === trainBlendOf(run),
  );
  return (
    earlier.filter((r) => measured.every((k) => r.metrics[k] !== undefined)).at(-1) ??
    earlier.at(-1)
  );
}

/** Scores predictions as a run's accuracy metrics and logs exact match and token accuracy. */
function scoreRun(
  examples: readonly Example[],
  p: Omit<ReferencePrediction, "info"> & { confidences?: (number | undefined)[] },
  t0: number,
) {
  const a = {
    ...scoreAll(examples, p.spans, p.confidences),
    parseErrors: p.parseErrors,
    firstParseError: p.firstError,
  };
  log(
    `  accuracy: exact ${(a.exactMatch * 100).toFixed(2)}%, token ${(a.tokenAccuracy * 100).toFixed(2)}% (${secs(t0)})`,
  );
  return a;
}

/** Scores a ReferenceImpl's predictions; its run has accuracy and nothing else. */
async function evalReference(
  impl: string,
  reference: ReferenceImpl,
  evalExamples: readonly Example[],
  evalHash: string,
) {
  const started = new Date();
  const runId = newRunId(impl, started);
  const t0 = now();
  log(c.bold(`${impl}`) + c.dim(` (${runId}, reference: accuracy only)`));
  if (only || opts.retrain) log(c.yellow(`  --only and --retrain don't apply to a reference`));
  const texts = evalExamples.map((ex) => ex.text);
  const p = await reference.predict(texts, { log });
  if (p.spans.length !== evalExamples.length) {
    throw new Error(`${impl} returned ${p.spans.length} parses for ${evalExamples.length} texts`);
  }
  mkdirSync(PREDICTIONS_DIR, { recursive: true });
  writeFileSync(
    join(PREDICTIONS_DIR, `${runId}.jsonl`),
    evalExamples.map((ex, i) => JSON.stringify({ id: ex.id, spans: p.spans[i] }) + "\n").join(""),
  );
  const seconds = (now() - t0) / 1000;
  const metrics: RunResult["metrics"] = {
    accuracy: scoreRun(evalExamples, p, t0),
    reference: { seconds, info: p.info },
  };
  if (p.parseErrors) log(c.red(`  ${p.parseErrors} parse errors, first: ${p.firstError}`));
  const run: RunResult = {
    runId,
    timestamp: started.toISOString(),
    impl,
    suite: suiteName,
    config,
    git: gitInfo(),
    implHash: implSourceHash(impl),
    data: { trainHash: null, evalHash },
    machine: machineInfo(),
    metrics,
  };
  const previous = previousRun(run);
  log(c.dim(`  saved ${saveRun(run)}`));
  return { run, previous };
}

async function evalImpl(impl: string, evalExamples: readonly Example[], evalHash: string) {
  const reference = await importReference(impl);
  if (reference) return evalReference(impl, reference, evalExamples, evalHash);
  const started = new Date();
  const runId = newRunId(impl, started);
  const tImpl = now();
  const loadAtStart = os.loadavg()[0]!;
  log(c.bold(`${impl}`) + c.dim(` (${runId})`));

  const implHash = implSourceHash(impl);
  const main = await ensureModel(impl, implHash, config.trainExamples);
  if (main.training.cached) log(`  train: cached model; ${trainingProvenance(main.training)}`);
  const metrics: RunResult["metrics"] = { training: main.training, code: implCodeSize(impl) };
  const modelArgs: ModelArgs = { impl, split, n: config.evalExamples, model: main.model };

  if (enabled("accuracy")) {
    const t0 = now();
    mkdirSync(PREDICTIONS_DIR, { recursive: true });
    const out = join(PREDICTIONS_DIR, `${runId}.jsonl`);
    const p = await predict(impl, main.model, out, evalExamples);
    metrics.accuracy = scoreRun(evalExamples, p, t0);
    const rc = metrics.accuracy.riskCoverage;
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
  if (enabled("bundle")) {
    try {
      const b = await bundleImpl(impl);
      metrics.bundle = b;
      const note = b.includesTraining ? `, includes training code (no ${impl}/load.ts)` : "";
      log(
        `  bundle: ${b.bytes.toLocaleString("en-US")} B, gzip ${b.gzipBytes.toLocaleString("en-US")} B${note}`,
      );
    } catch (e) {
      metrics.bundle = { error: e instanceof Error ? e.message : String(e) };
      log(c.red(`  bundle failed: ${metrics.bundle.error}`));
    }
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
      const r = (metrics.throughput[String(threads)] = await runChild("throughput", {
        ...modelArgs,
        ...config.throughput,
        threads,
      } satisfies ThroughputArgs));
      log(
        `  throughput ${threads}t: ${Math.round(r.callsPerSec).toLocaleString("en-US")}/s (${secs(t0)})`,
      );
    }
  }
  if (enabled("determinism")) {
    const t0 = now();
    const again = join(MODELS_DIR, impl, `determinism-${process.pid}.bin`);
    await trainInChild({
      impl,
      split: "train",
      n: config.trainExamples,
      seed: config.seed,
      weights: trainWeights,
      out: again,
    });
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
      const out = join(os.tmpdir(), `nerdress-curve-${process.pid}.jsonl`);
      const p = await predict(impl, model, out, evalExamples);
      rmSync(out);
      const a = scoreAll(evalExamples, p.spans);
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

  const machine = machineInfo();
  machine.load = Math.max(loadAtStart, machine.load ?? 0);
  const run: RunResult = {
    runId,
    timestamp: started.toISOString(),
    impl,
    suite: suiteName,
    config,
    git: gitInfo(),
    implHash,
    data: {
      trainHash: main.trainHash,
      evalHash,
      ...(trainBlendName === "default" ? {} : { trainBlend: trainBlendName }),
      trainWeights,
    },
    machine,
    metrics,
  };
  const previous = previousRun(run);
  log(c.dim(`  saved ${saveRun(run)} (${secs(tImpl)})`));
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
const unweighted = built.filter((d) => !Object.hasOwn(DATASET_WEIGHTS, d));
if (unweighted.length) {
  log(c.dim(`datasets without a weight in DATASET_WEIGHTS, so weight 1: ${unweighted.join(", ")}`));
}
if (trainBlendName !== "default") {
  const share = Object.values(trainWeights).reduce((a, b) => a + b, 0);
  log(
    `training blend ${c.bold(trainBlendName)}: ` +
      Object.entries(trainWeights)
        .map(([d, w]) => `${d} ${((w / share) * 100).toFixed(1)}%`)
        .join(", "),
  );
}

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
  if (run.metrics.training?.cached) console.log(c.dim(trainingProvenance(run.metrics.training)));
  for (const n of comparabilityNotes(previous ? [previous, run] : [run])) console.log(n);
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
