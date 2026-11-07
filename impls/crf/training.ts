/** Pieces shared by the trainers. */
import type { Example } from "../../src/types.ts";
import { Features } from "./features.ts";
import { STATES, goldStates } from "./model.ts";
import { FeatureTable } from "./table.ts";
import { pathTransIndex } from "./viterbi.ts";

export interface TrainOptions {
  epochs: number;
  /** Features seen in fewer training tokens than this are dropped. */
  minCount: number;
  seed: number;
  log(message: string): void;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle in place. */
export function shuffle(order: Int32Array, random: () => number): void {
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    const t = order[k]!;
    order[k] = order[j]!;
    order[j] = t;
  }
}

/** Feature hashes seen at least `minCount` times, in first-seen order. */
function collectFeatures(examples: readonly Example[], minCount: number): Int32Array {
  const fx = new Features();
  const table = new FeatureTable(1 << 16);
  const counts: number[] = [];
  const order: number[] = [];
  for (const ex of examples) {
    const n = fx.extract(ex.text);
    for (let q = 0; q < fx.offs[n]!; q++) {
      const key = fx.feats[q]!;
      const idx = table.values[table.slot(key, table.size)]!;
      if (idx === counts.length) {
        counts.push(0);
        order.push(key);
      }
      counts[idx]!++;
    }
  }
  const out: number[] = [];
  for (let k = 0; k < table.size; k++) if (counts[k]! >= minCount) out.push(order[k]!);
  return Int32Array.from(out);
}

/** Transitions that occur in the gold state sequences, as a `(STATES + 1)^2` mask. */
export function allowedTransitions(examples: readonly Example[]): Uint8Array {
  const L = STATES;
  const allowed = new Uint8Array((L + 1) * (L + 1));
  const fx = new Features();
  let gold = new Uint8Array(64);
  for (const ex of examples) {
    fx.tokens.tokenize(ex.text);
    const n = fx.tokens.n;
    if (gold.length < n) gold = new Uint8Array(n * 2);
    goldStates(fx.tokens, ex.spans, gold);
    for (let i = 0; i <= n; i++) allowed[pathTransIndex(L, gold, n, i)] = 1;
  }
  return allowed;
}

/**
 * Row in `table` of each feature of the first n tokens (-1 where the feature was dropped), written
 * to `rows` or, when it is too small, to a new array that is returned.
 */
export function featureRows(fx: Features, n: number, table: FeatureTable, rows: Int32Array) {
  const nFeats = fx.offs[n]!;
  if (rows.length < nFeats) rows = new Int32Array(nFeats * 2);
  for (let k = 0; k < nFeats; k++) rows[k] = table.get(fx.feats[k]!);
  return rows;
}

/** Emission scores of every token from `featureRows` and dense weights `w[row * STATES + state]`. */
export function denseEmissions(
  fx: Features,
  n: number,
  rows: Int32Array,
  w: Float64Array,
  emit: Float64Array,
) {
  const L = STATES;
  emit.fill(0, 0, n * L);
  for (let i = 0; i < n; i++) {
    const row = i * L;
    const end = fx.offs[i + 1]!;
    for (let q = fx.offs[i]!; q < end; q++) {
      const f = rows[q]!;
      if (f < 0) continue;
      const base = f * L;
      for (let y = 0; y < L; y++) emit[row + y]! += w[base + y]!;
    }
  }
}

/** Features kept for training, and a table from their hashes to row indices. */
export function featureTable(examples: readonly Example[], opts: TrainOptions) {
  const keys = collectFeatures(examples, opts.minCount);
  opts.log(`${keys.length} features with count >= ${opts.minCount}`);
  const table = new FeatureTable(keys.length);
  for (let k = 0; k < keys.length; k++) table.slot(keys[k]!, k);
  return { keys, table };
}
