import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Suite } from "../../eval.config.ts";
import { RUNS_DIR } from "../data/paths.ts";
import type { ScoredParse } from "../types.ts";
import type { AccuracyMetrics } from "./accuracy.ts";
import type { BundleMetrics } from "./bundle.ts";

/** Everything one `pnpm eval` run of one implementation measured. Saved to results/runs/. */
export interface RunResult {
  runId: string;
  timestamp: string;
  impl: string;
  suite: string;
  config: Suite;
  git: { sha: string | null; dirty: boolean };
  /**
   * Hash of the impl's sources plus shared src/ outside src/eval; equal hashes mean the same
   * model code. A reference's predictions also depend on src/eval/reference.ts and the
   * externally installed parser, recorded in `metrics.reference.info`.
   */
  implHash: string;
  /**
   * `trainHash` is null for a reference impl, which is trained elsewhere. `trainBlend` names the
   * training blend (`blendLabel`; absent means "default") and `trainWeights` its resolved
   * weights; the eval set always uses the default blend.
   */
  data: {
    trainHash: string | null;
    evalHash: string;
    trainBlend?: string;
    trainWeights?: Record<string, number>;
  };
  machine: {
    cpu: string;
    cores: number;
    memoryGB: number;
    os: string;
    node: string;
    /**
     * 1-minute load average, the higher of its values at the start and end of the run (for
     * `training.measured`, at the start of training). Above `cores`, other processes competed
     * for the CPU, so timings are unreliable.
     */
    load?: number;
  };
  metrics: {
    accuracy?: AccuracyMetrics & { parseErrors: number; firstParseError?: string };
    training?: {
      /** True when the model came from the cache and these metrics from the run that trained it. */
      cached: boolean;
      /**
       * When, at which commit and on which machine training was measured. A cache entry
       * without this record gets only `at`, from its file's modification time.
       */
      measured?: { at: string; git?: RunResult["git"]; machine?: RunResult["machine"] };
      seconds: number;
      examplesPerSec: number;
      tokensPerSec: number;
      /** Process-lifetime peak: includes Node startup and loading the training data. */
      peakRssMB: number;
      /** Peak RSS sampled during `train()`, minus RSS just before it. */
      peakRssOverBaselineMB: number;
      baselineRssMB: number;
      /** Peak V8 heap + external memory during `train()`, minus before (heap.ts). */
      peakHeapOverBaselineMB?: number;
      /** V8 heap + external bytes allocated during `train()`, including garbage. */
      allocatedMB?: number;
      modelBytes: number;
      info: Record<string, number | string>;
    };
    memory?: {
      modelBytes: number;
      modelGzipBytes: number;
      loadMs: number;
      firstParseMs: number;
      modelHeapMB: number;
      modelRssMB: number;
      /** Process-lifetime peak: includes Node startup and loading the eval texts. */
      peakRssMB: number;
      /** Peak RSS sampled during `load()` plus one parse of every eval text, minus RSS before. */
      peakRssOverBaselineMB: number;
      baselineRssMB: number;
      /** Peak V8 heap + external memory over the same window, minus before (heap.ts). */
      peakHeapOverBaselineMB?: number;
    };
    bundle?: BundleMetrics | { error: string };
    latency?: {
      calls: number;
      meanUs: number;
      p50Us: number;
      p90Us: number;
      p99Us: number;
      p999Us: number;
      maxUs: number;
      usPerToken: number;
    };
    /** Keyed by thread count, e.g. "1", "4". */
    throughput?: Record<
      string,
      { threads: number; callsPerSec: number; tokensPerSec: number; runs: number[] }
    >;
    /** The impl's own TypeScript; absent for a reference impl, whose code lives elsewhere. */
    code?: { bytes: number; lines: number; files: number };
    /**
     * Present only for a reference impl (ReferenceImpl), which has no other metrics but
     * accuracy: wall time of its batch prediction, and the versions it reported.
     */
    reference?: { seconds: number; info: Record<string, number | string> };
    determinism?: { identical: boolean; hashes: [string, string] };
    learningCurve?: { trainExamples: number; exactMatch: number; tokenAccuracy: number }[];
  };
}

export function saveRun(run: RunResult): string {
  mkdirSync(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `${run.runId}.json`);
  writeFileSync(path, JSON.stringify(run, null, 2) + "\n");
  return path;
}

/** A predictions .jsonl file (results/predictions/) by example id. */
export function readPredictions(path: string): Map<string, ScoredParse> {
  const byId = new Map<string, ScoredParse>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const p = JSON.parse(line) as ScoredParse & { id: string };
    byId.set(p.id, p);
  }
  return byId;
}

/** The run's training blend label; runs from before blends existed trained on the default. */
export const trainBlendOf = (r: RunResult) => r.data.trainBlend ?? "default";

/** All saved runs, oldest first. */
export function loadRuns(): RunResult[] {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8")) as RunResult);
}

/** A run by path, id, impl name (that impl's latest run) or unique id prefix. */
export function findRun(ref: string): RunResult {
  if (ref.endsWith(".json") && existsSync(ref)) {
    return JSON.parse(readFileSync(ref, "utf8")) as RunResult;
  }
  const runs = loadRuns();
  const exact = runs.find((r) => r.runId === ref);
  if (exact) return exact;
  const ofImpl = runs.filter((r) => r.impl === ref);
  if (ofImpl.length) return ofImpl.at(-1)!;
  const matches = runs.filter((r) => r.runId.startsWith(ref));
  if (matches.length !== 1) throw new Error(`${matches.length} runs match "${ref}"`);
  return matches[0]!;
}
