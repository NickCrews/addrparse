import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Suite } from "../../eval.config.ts";
import { RUNS_DIR } from "../data/paths.ts";
import type { AccuracyMetrics } from "./accuracy.ts";

/** Everything one `pnpm eval` run of one implementation measured. Saved to results/runs/. */
export interface RunResult {
  runId: string;
  timestamp: string;
  impl: string;
  suite: string;
  config: Suite;
  git: { sha: string | null; dirty: boolean };
  /** Hash of the impl's sources plus shared src/; equal hashes mean the same code. */
  implHash: string;
  data: { trainHash: string; evalHash: string };
  machine: { cpu: string; cores: number; memoryGB: number; os: string; node: string };
  metrics: {
    accuracy?: AccuracyMetrics & { parseErrors: number; firstParseError?: string };
    training?: {
      cached: boolean;
      seconds: number;
      examplesPerSec: number;
      tokensPerSec: number;
      /** Process-lifetime peak: includes Node startup and loading the training data. */
      peakRssMB: number;
      /** Peak RSS sampled during `train()`, minus RSS just before it. */
      peakRssOverBaselineMB: number;
      baselineRssMB: number;
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
    };
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
    code: { bytes: number; lines: number; files: number };
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
