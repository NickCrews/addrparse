/** Runtime half of the lookup baseline: parses with a model made by index.ts's `train`. */
import { isLabel, type Label } from "../../src/labels.ts";
import { spansFromTokens, tokenize } from "../../src/tokens.ts";
import type { Parser } from "../../src/types.ts";

export interface Model {
  fallback: Label;
  table: [string, Label][];
}

export const key = (s: string) => s.toLowerCase();

export function load(bytes: Uint8Array): Parser {
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
}
