import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");
export const DATA_DIR = join(ROOT, "data");
export const RAW_DIR = join(DATA_DIR, "raw");
export const MODELS_DIR = join(ROOT, "models");
export const RESULTS_DIR = join(ROOT, "results");
export const RUNS_DIR = join(RESULTS_DIR, "runs");
export const PREDICTIONS_DIR = join(RESULTS_DIR, "predictions");
export const IMPLS_DIR = join(ROOT, "impls");

export type Split = "train" | "dev" | "test";

export const rawPath = (source: string) => join(RAW_DIR, `${source}.tsv`);
export const splitPath = (split: Split) => join(DATA_DIR, `${split}.jsonl`);
export const DATA_STATS_PATH = join(DATA_DIR, "stats.json");
