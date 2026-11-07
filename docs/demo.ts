/**
 * Picks the playground's demo sets from the dev eval set: random samples, samples of slices,
 * the best model's errors grouped by their first wrong token, and examples where two models
 * disagree on correctness. Selection is seeded, so a build from the same data, models and seed
 * picks the same rows.
 */
import { scoreExample } from "../src/eval/accuracy.ts";
import { SLICES } from "../src/eval/slices.ts";
import type { Example, Span } from "../src/types.ts";
import type { DemoRow, DemoSet } from "./page-data.ts";

export interface ModelPredictions {
  impl: string;
  /** Parses in eval-set order. */
  spans: Span[][];
  /** True when the page computes this model's parses itself, so they aren't embedded. */
  inPage: boolean;
}

const SAMPLE = 24;
const SLICE_SAMPLE = 16;
const CATEGORY_SAMPLE = 10;
const CATEGORIES = 6;
const DISAGREE_SAMPLE = 16;

const SLICE_TITLES: Record<string, string> = {
  "po-box": "PO boxes",
  unit: "Units (apartment, suite, floor)",
  "pre-type": "Street type before the name (Highway 9)",
  "post-directional": "Directional after the street (Main St NE)",
  "all-caps": "All caps",
  "no-commas": "No commas",
  "junk-only": "Not an address (junk only)",
  embedded: "Address embedded in other text",
};

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
function sample<T>(xs: readonly T[], k: number, seed: number): T[] {
  const a = [...xs];
  const r = rng(seed);
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (a.length - i));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

const SPAN_BOUNDARIES = "span boundaries";

/** First token whose gold and predicted labels differ, as "gold → predicted". */
function errorCategory(ex: Example, spans: readonly Span[]): string {
  const pair = scoreExample(ex, spans).tokenPairs.find(([g, p]) => g !== p);
  return pair ? `${pair[0] ?? "no label"} → ${pair[1] ?? "no label"}` : SPAN_BOUNDARIES;
}

export function pickDemo(
  examples: readonly Example[],
  models: readonly ModelPredictions[],
  /** The model whose errors get their own sets, e.g. the most accurate trained one. */
  best: string,
  seed: number,
): { sets: DemoSet[]; rows: Record<string, DemoRow> } {
  // One example per text, one line each, so a text identifies its row in the textarea.
  const seen = new Set<string>();
  const pool: number[] = [];
  examples.forEach((ex, i) => {
    if (/[\n\t\r]/.test(ex.text) || seen.has(ex.text)) return;
    seen.add(ex.text);
    pool.push(i);
  });
  const exact = models.map((m) => examples.map((ex, i) => scoreExample(ex, m.spans[i]!).exact));
  const ok = (impl: string, i: number) => exact[models.findIndex((m) => m.impl === impl)]![i]!;

  const sets: DemoSet[] = [];
  const add = (set: Omit<DemoSet, "texts">, idx: readonly number[], k: number) => {
    const picked = sample(idx, k, seed + sets.length);
    if (picked.length) sets.push({ ...set, texts: picked.map((i) => examples[i]!.text) });
  };

  add(
    {
      id: "random",
      group: "Samples",
      title: "Random dev examples",
      description: "A seeded random sample of the dev eval set.",
    },
    pool,
    SAMPLE,
  );
  for (const [name, title] of Object.entries(SLICE_TITLES)) {
    const slice = SLICES.find((s) => s.name === name);
    if (!slice) throw new Error(`no slice ${name} in src/eval/slices.ts`);
    add(
      {
        id: `slice-${name}`,
        group: "Slices",
        title,
        description: `A random sample of the "${name}" slice of the dev eval set.`,
      },
      pool.filter((i) => slice.test(examples[i]!)),
      SLICE_SAMPLE,
    );
  }
  add(
    {
      id: "noisy",
      group: "Slices",
      title: "Formatting noise (typos, case, reordering)",
      description: "A random sample of dev examples with synthetic formatting noise.",
    },
    pool.filter((i) => examples[i]!.noise?.length),
    SLICE_SAMPLE,
  );

  const bestIdx = models.findIndex((m) => m.impl === best);
  if (bestIdx >= 0) {
    const byCategory = new Map<string, number[]>();
    for (const i of pool) {
      if (ok(best, i)) continue;
      const cat = errorCategory(examples[i]!, models[bestIdx]!.spans[i]!);
      byCategory.set(cat, [...(byCategory.get(cat) ?? []), i]);
    }
    const top = [...byCategory].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
    for (const [cat, idx] of top.slice(0, CATEGORIES)) {
      add(
        {
          id: `errors-${best}-${cat}`,
          group: `${best} errors by first wrong token (gold → predicted)`,
          title: `${cat} (${idx.length} in the eval set)`,
          description:
            cat === SPAN_BOUNDARIES
              ? `Dev examples ${best} misparses although every token's first label is right: ` +
                `spans split or join differently, or a token holds two labels (Apt4).`
              : `Dev examples ${best} misparses whose first wrong token has gold label ` +
                `${cat.replace(" → ", " and predicted label ")}.`,
        },
        idx,
        CATEGORY_SAMPLE,
      );
    }
    for (const other of models) {
      if (other.impl === best) continue;
      for (const [right, wrong] of [
        [best, other.impl],
        [other.impl, best],
      ] as const) {
        add(
          {
            id: `disagree-${right}-${wrong}`,
            group: "Disagreements",
            title: `${right} right, ${wrong} wrong`,
            description: `Dev examples ${right} parses exactly and ${wrong} doesn't.`,
          },
          pool.filter((i) => ok(right, i) && !ok(wrong, i)),
          DISAGREE_SAMPLE,
        );
      }
    }
  }

  const index = new Map<string, number>();
  for (const i of pool) index.set(examples[i]!.text, i);
  const rows: Record<string, DemoRow> = {};
  for (const text of new Set(sets.flatMap((s) => s.texts))) {
    const i = index.get(text)!;
    rows[text] = {
      gold: examples[i]!.spans,
      exact: Object.fromEntries(models.map((m) => [m.impl, ok(m.impl, i)])),
      spans: Object.fromEntries(models.filter((m) => !m.inPage).map((m) => [m.impl, m.spans[i]!])),
    };
  }
  return { sets, rows };
}
