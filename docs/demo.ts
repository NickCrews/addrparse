/**
 * Builds the playground's presets: one per topic in examples.ts. A preset is the topic's
 * handpicked examples, then a seeded sample of dev examples of that topic, some the model parses
 * exactly and some it doesn't, mixed together so the failures sit next to the successes.
 */
import { scoreExample } from "../src/eval/accuracy.ts";
import type { Example, Span } from "../src/types.ts";
import type { Topic } from "./examples.ts";
import type { DemoRow, DemoSet } from "./page-data.ts";

/** Dev examples per preset that the model parses exactly. */
const RIGHT = 6;
/** Dev examples per preset that it doesn't; fewer when the topic has fewer. */
const WRONG = 4;

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `k` items of `xs` in a seeded random order. */
function sample<T>(xs: readonly T[], k: number, r: () => number): T[] {
  const a = [...xs];
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (a.length - i));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

export function pickDemo(
  examples: readonly Example[],
  /** The in-page model's parses, in eval-set order. */
  predicted: readonly Span[][],
  impl: string,
  /** The in-page model, to score the handpicked examples. */
  parse: (text: string) => Span[],
  topics: readonly Topic[],
  seed: number,
): { sets: DemoSet[]; rows: Record<string, DemoRow> } {
  const exact = examples.map((ex, i) => scoreExample(ex, predicted[i]!).exact);
  // One example per text, one line each, so a text identifies its row in the table.
  const seen = new Set<string>();
  const pool: number[] = [];
  examples.forEach((ex, i) => {
    if (/[\n\t\r]/.test(ex.text) || seen.has(ex.text)) return;
    seen.add(ex.text);
    pool.push(i);
  });

  const rows: Record<string, DemoRow> = {};
  const sets = topics.map((topic, t) => {
    const r = rng(seed + t);
    const inTopic = pool.filter((i) => topic.test(examples[i]!));
    const right = sample(
      inTopic.filter((i) => exact[i]),
      RIGHT,
      r,
    );
    const wrong = sample(
      inTopic.filter((i) => !exact[i]),
      WRONG,
      r,
    );
    const dev = sample([...right, ...wrong], right.length + wrong.length, r);
    for (const i of dev) {
      rows[examples[i]!.text] = { gold: examples[i]!.spans, exact: { [impl]: exact[i]! } };
    }
    for (const ex of topic.examples) {
      const ok = scoreExample({ id: "", source: "", ...ex }, parse(ex.text)).exact;
      rows[ex.text] = { gold: ex.spans, exact: { [impl]: ok } };
    }
    return {
      id: topic.id,
      title: topic.title,
      texts: [...topic.examples.map((e) => e.text), ...dev.map((i) => examples[i]!.text)],
    };
  });
  return { sets, rows };
}
