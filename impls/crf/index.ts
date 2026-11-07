/**
 * Linear-chain model over whitespace tokens. features.ts extracts hashed features for both
 * training and inference; model.ts holds the states, the binary format and the Viterbi parser,
 * which reports its path's probability as the confidence; load.ts is the runtime entry point.
 * `TRAINER` picks the training method: a CRF fit by L1-regularized SGD (crf.ts), or an averaged
 * structured perceptron (perceptron.ts). Both produce the same model format; a perceptron's
 * scores aren't log-probabilities, so its confidences only rank parses.
 */
import type { Impl } from "../../src/types.ts";
import { trainCrf } from "./crf.ts";
import { load } from "./load.ts";
import { decode, encode } from "./model.ts";
import { trainPerceptron } from "./perceptron.ts";

const TRAINER = "crf" as "crf" | "perceptron";
const MIN_COUNT = 2;

const CRF = { epochs: 10, eta0: 0.1, decay: 0.8, l1: 0.2, minWeight: 0.001 };
/** Averaged perceptron weights count updates, so pruning works on a different scale. */
const PERCEPTRON = { epochs: 8, minWeight: 1 };

const impl: Impl = {
  train(examples, ctx) {
    const common = { minCount: MIN_COUNT, seed: ctx.seed, log: ctx.log };
    const params =
      TRAINER === "crf"
        ? trainCrf(examples, { ...common, ...CRF })
        : trainPerceptron(examples, { ...common, ...PERCEPTRON });
    const minWeight = TRAINER === "crf" ? CRF.minWeight : PERCEPTRON.minWeight;
    const model = encode(params, minWeight);
    const kept = decode(model);
    return {
      model,
      info: {
        trainer: TRAINER,
        trainedFeatures: params.keys.length,
        features: kept.keys.length,
        weights: kept.values.length,
      },
    };
  },
  load,
};

export default impl;
