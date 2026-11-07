import { join, resolve } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");
/** data/, or the directory in `ADDRPARSE_DATA_DIR` (CI points it at test/fixtures/data). */
export const DATA_DIR = process.env.ADDRPARSE_DATA_DIR
  ? resolve(process.env.ADDRPARSE_DATA_DIR)
  : join(ROOT, "data");
/** Downloaded sources; always data/raw, since only the splits are swapped out for fixtures. */
export const RAW_DIR = join(ROOT, "data", "raw");
export const MODELS_DIR = join(ROOT, "models");
export const RESULTS_DIR = join(ROOT, "results");
export const RUNS_DIR = join(RESULTS_DIR, "runs");
export const PREDICTIONS_DIR = join(RESULTS_DIR, "predictions");
export const IMPLS_DIR = join(ROOT, "impls");

export type Split = "train" | "dev" | "test";

export const rawPath = (source: string) => join(RAW_DIR, `${source}.tsv`);
export const splitPath = (split: Split) => join(DATA_DIR, `${split}.jsonl`);
export const DATA_STATS_PATH = join(DATA_DIR, "stats.json");
