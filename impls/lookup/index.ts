/**
 * Context-free baseline: each token gets the label it most often had in training (lowercased,
 * edge punctuation removed); unseen tokens get the most common label overall. Confidence is the
 * share of tokens seen in training. Parsing lives in load.ts so the browser bundle leaves out
 * training.
 */
import type { Label } from "../../src/labels.ts";
import { labeledTokens } from "../../src/tokens.ts";
import type { Impl } from "../../src/types.ts";
import { key, load, type Model } from "./load.ts";

const impl: Impl = {
  train(examples) {
    const counts = new Map<string, Map<Label, number>>();
    const totals = new Map<Label, number>();
    for (const ex of examples) {
      for (const { text, label } of labeledTokens(ex)) {
        if (!label) continue;
        const byLabel = counts.get(key(text)) ?? new Map<Label, number>();
        byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
        counts.set(key(text), byLabel);
        totals.set(label, (totals.get(label) ?? 0) + 1);
      }
    }
    const argmax = (m: Map<Label, number>) => [...m].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    const model: Model = {
      fallback: argmax(totals),
      table: [...counts].map(([k, m]) => [k, argmax(m)]),
    };
    return {
      model: new TextEncoder().encode(JSON.stringify(model)),
      info: { vocabulary: model.table.length },
    };
  },
  load,
};

export default impl;
