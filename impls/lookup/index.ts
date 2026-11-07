/**
 * Context-free baseline: each token gets the label it most often had in training (lowercased,
 * edge punctuation removed); unseen tokens get the most common label overall. Confidence is the
 * share of tokens seen in training.
 */
import { isLabel, type Label } from "../../src/labels.ts";
import { labeledTokens, spansFromTokens, tokenize } from "../../src/tokens.ts";
import type { Impl } from "../../src/types.ts";

interface Model {
  fallback: Label;
  table: [string, Label][];
}

const key = (s: string) => s.toLowerCase();

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

  load(bytes) {
    const model = JSON.parse(new TextDecoder().decode(bytes)) as Model;
    if (!isLabel(model.fallback)) throw new Error(`bad fallback label ${model.fallback}`);
    const table = new Map(model.table);
    return {
      parse(text) {
        const tokens = tokenize(text);
        let seen = 0;
        const labels = tokens.map((t) => {
          const label = table.get(key(text.slice(t.coreStart, t.coreEnd)));
          if (label) seen++;
          return label ?? model.fallback;
        });
        return {
          spans: spansFromTokens(tokens, labels),
          confidence: tokens.length ? seen / tokens.length : 0,
        };
      },
    };
  },
};

export default impl;
