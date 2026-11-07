/**
 * Averaged structured perceptron (Collins 2002) over the linear-chain model in model.ts.
 * Each example is Viterbi-decoded with the current weights; on a mistake, features of the
 * mispredicted tokens move toward the gold state and away from the predicted one, and so do the
 * differing transitions. The returned weights are averaged over every step (Daumé's trick).
 */
import type { Example } from "../../src/types.ts";
import { Features } from "./features.ts";
import { STATES, goldStates, type Params } from "./model.ts";
import {
  allowedTransitions,
  denseEmissions,
  featureTable,
  rng,
  shuffle,
  type TrainOptions,
} from "./training.ts";
import { Viterbi, transIndex } from "./viterbi.ts";

export function trainPerceptron(examples: readonly Example[], opts: TrainOptions): Params {
  const L = STATES;
  const T = L + 1;
  const { keys, table } = featureTable(examples, opts);

  const w = new Float64Array(keys.length * L);
  const u = new Float64Array(keys.length * L);
  const tw = new Float64Array(T * T);
  const tu = new Float64Array(T * T);

  const fx = new Features();
  const allowed = allowedTransitions(examples);
  const viterbi = new Viterbi(L, tw, allowed);
  let emit = new Float64Array(64 * L);
  let gold = new Uint8Array(64);
  let pred = new Uint8Array(64);
  const random = rng(opts.seed);
  const order = Int32Array.from(examples.keys());
  let c = 1;

  for (let epoch = 0; epoch < opts.epochs; epoch++) {
    shuffle(order, random);
    let mistakes = 0;
    for (const e of order) {
      const ex = examples[e]!;
      const n = fx.extract(ex.text);
      if (n === 0) continue;
      if (emit.length < n * L) {
        emit = new Float64Array(n * L * 2);
        gold = new Uint8Array(n * 2);
        pred = new Uint8Array(n * 2);
      }
      goldStates(fx.tokens, ex.spans, gold);
      denseEmissions(fx, n, table, w, emit);
      viterbi.decode(emit, n, pred);
      let wrong = false;
      for (let i = 0; i < n; i++) {
        const g = gold[i]!;
        const p = pred[i]!;
        if (g === p) continue;
        wrong = true;
        for (let q = fx.offs[i]!; q < fx.offs[i + 1]!; q++) {
          const f = table.get(fx.feats[q]!);
          if (f < 0) continue;
          w[f * L + g]! += 1;
          u[f * L + g]! += c;
          w[f * L + p]! -= 1;
          u[f * L + p]! -= c;
        }
      }
      if (wrong) {
        mistakes++;
        for (let i = 0; i <= n; i++) {
          const ga = i === 0 ? L : gold[i - 1]!;
          const gb = i === n ? L : gold[i]!;
          const pa = i === 0 ? L : pred[i - 1]!;
          const pb = i === n ? L : pred[i]!;
          if (ga === pa && gb === pb) continue;
          tw[transIndex(L, ga, gb)]! += 1;
          tu[transIndex(L, ga, gb)]! += c;
          tw[transIndex(L, pa, pb)]! -= 1;
          tu[transIndex(L, pa, pb)]! -= c;
        }
      }
      c++;
    }
    opts.log(
      `epoch ${epoch + 1}: ${mistakes} mistakes (${((100 * mistakes) / order.length).toFixed(2)}%)`,
    );
  }

  const weights = new Float32Array(w.length);
  for (let k = 0; k < w.length; k++) weights[k] = w[k]! - u[k]! / c;
  const trans = new Float32Array(T * T);
  for (let k = 0; k < T * T; k++) trans[k] = allowed[k] ? tw[k]! - tu[k]! / c : -Infinity;
  return { keys, weights, trans };
}
