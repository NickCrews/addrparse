/**
 * Conditional random field training: stochastic gradient descent on the negative
 * log-likelihood with an L1 penalty applied by the cumulative-penalty method (Tsuruoka, Tsujii
 * and Ananiadou 2009), which drives most weights to exactly zero. Marginals come from scaled
 * forward-backward over the allowed transitions.
 */
import type { Example } from "../../src/types.ts";
import { Features } from "./features.ts";
import { STATES, goldStates, type Params } from "./model.ts";
import { ForwardBackward } from "./forward-backward.ts";
import {
  allowedTransitions,
  denseEmissions,
  featureRows,
  featureTable,
  rng,
  shuffle,
  type TrainOptions,
} from "./training.ts";
import { pathTransIndex, transIndex } from "./viterbi.ts";

export interface CrfOptions extends TrainOptions {
  /** L1 strength per training example: the objective is NLL summed over examples + l1 * |w|. */
  l1: number;
  /** Learning rate of the first epoch. */
  eta0: number;
  /** Learning rate multiplier per epoch. */
  decay: number;
}

export function trainCrf(examples: readonly Example[], opts: CrfOptions): Params {
  const L = STATES;
  const T = L + 1;
  const { keys, table } = featureTable(examples, opts);
  const allowed = allowedTransitions(examples);
  const nf = keys.length;
  const w = new Float64Array(nf * L);
  /** L1 penalty applied to each weight so far. */
  const q = new Float64Array(nf * L);
  const tw = new Float64Array(T * T);
  const fb = new ForwardBackward(L, allowed);

  const fx = new Features();
  let emit = new Float64Array(64 * L);
  let gold = new Uint8Array(64);
  let rows: Int32Array = new Int32Array(64 * 64);
  const random = rng(opts.seed);
  const order = Int32Array.from(examples.keys());
  /** Total L1 penalty each weight could have received so far. */
  let u = 0;
  const N = examples.length;

  const penalize = (k: number) => {
    const z = w[k]!;
    if (z > 0) w[k] = Math.max(0, z - (u + q[k]!));
    else if (z < 0) w[k] = Math.min(0, z + (u - q[k]!));
    q[k]! += w[k]! - z;
  };

  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    shuffle(order, random);
    const eta = opts.eta0 * opts.decay ** epoch;
    let loss = 0;
    for (const e of order) {
      const ex = examples[e]!;
      const n = fx.extract(ex.text);
      if (n === 0) continue;
      if (emit.length < n * L) {
        emit = new Float64Array(n * L * 2);
        gold = new Uint8Array(n * 2);
      }
      rows = featureRows(fx, n, table, rows);
      goldStates(fx.tokens, ex.spans, gold);
      denseEmissions(fx, n, rows, w, emit);
      fb.setTransitions(tw);
      fb.run(emit, n);
      let goldScore = 0;
      for (let i = 0; i <= n; i++) {
        if (i < n) goldScore += emit[i * L + gold[i]!]!;
        goldScore += tw[pathTransIndex(L, gold, n, i)]!;
      }
      loss += fb.logZ - goldScore;

      // Gradient step on emissions.
      const node = fb.node;
      for (let i = 0; i < n; i++) {
        const g = gold[i]!;
        for (let k = fx.offs[i]!; k < fx.offs[i + 1]!; k++) {
          const f = rows[k]!;
          if (f < 0) continue;
          const base = f * L;
          for (let y = 0; y < L; y++) w[base + y]! -= eta * node[i * L + y]!;
          w[base + g]! += eta;
        }
      }
      // Gradient step on transitions: gold counts minus expected counts.
      const { alpha, beta, expEmit, expTrans, scale } = fb;
      const { src, srcPtr } = fb.sources;
      for (let i = 0; i <= n; i++) tw[pathTransIndex(L, gold, n, i)]! += eta;
      for (let y = 0; y < L; y++) {
        tw[transIndex(L, L, y)]! -= eta * node[y]!;
        tw[transIndex(L, y, L)]! -= eta * node[(n - 1) * L + y]!;
      }
      for (let i = 1; i < n; i++) {
        for (let y = 0; y < L; y++) {
          const v = (expEmit[i * L + y]! * beta[i * L + y]!) / scale[i]!;
          if (v === 0) continue;
          for (let j = srcPtr[y]!; j < srcPtr[y + 1]!; j++) {
            const x = src[j]!;
            const t = y * T + x;
            tw[t]! -= eta * alpha[(i - 1) * L + x]! * expTrans[t]! * v;
          }
        }
      }

      // L1 penalty on the weights this example touched.
      u += (eta * opts.l1) / N;
      const nFeats = fx.offs[n]!;
      for (let k = 0; k < nFeats; k++) {
        const f = rows[k]!;
        if (f < 0) continue;
        for (let y = 0; y < L; y++) penalize(f * L + y);
      }
    }
    let nonzero = 0;
    for (let k = 0; k < w.length; k++) if (w[k] !== 0) nonzero++;
    opts.log(
      `epoch ${epoch + 1}: eta ${eta.toFixed(4)}, loss ${(loss / N).toFixed(4)}, ${nonzero} nonzero weights`,
    );
  }
  for (let k = 0; k < w.length; k++) penalize(k);

  const trans = new Float32Array(T * T);
  for (let k = 0; k < T * T; k++) trans[k] = allowed[k] ? tw[k]! : -Infinity;
  return { keys, weights: Float32Array.from(w), trans };
}
