/**
 * Builds data/{train,dev,test}.jsonl and data/stats.json from data/raw/*.tsv.
 *
 * - Sources are interleaved line by line, so any prefix of a split mixes them evenly.
 * - Each line is refined (`refine.ts`), then either replaced by its hand-checked override in
 *   `overrides/gold.jsonl` or checked against the whole corpus (`gold.ts`). A first pass over
 *   all lines builds the corpus counts and finds the texts that overrides apply to.
 * - Exact duplicate texts are dropped. An override applies to every line with its text.
 * - Splits are assigned by `splitFor` (`lines.ts`): 90% train, 5% dev, 5% test.
 *
 *   node src/data/build.ts
 */
import {
  createWriteStream,
  existsSync,
  type WriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { Example } from "../types.ts";
import {
  checkGold,
  GoldIndex,
  loadOverrides,
  noteList,
  resolveSpans,
  type GoldOverride,
} from "./gold.ts";
import { LIBPOSTAL_FILES, LIBPOSTAL_SNAPSHOT, type LibpostalSource } from "./libpostal.ts";
import { lineKey, refineLine, splitFor } from "./lines.ts";
import { DATA_DIR, DATA_STATS_PATH, rawPath, splitPath, type Split } from "./paths.ts";

const SPLITS: readonly Split[] = ["train", "dev", "test"];

const sources = (Object.keys(LIBPOSTAL_FILES) as LibpostalSource[]).filter((s) =>
  existsSync(rawPath(s)),
);
if (sources.length === 0) throw new Error("no data/raw/*.tsv; run `pnpm data:fetch` first");
const lines = sources.map((s) => readFileSync(rawPath(s), "utf8").split("\n").filter(Boolean));
const maxLen = Math.max(...lines.map((l) => l.length));

/** Every raw line with its source and line number, interleaving sources. */
function* rawLines(): Generator<{ line: string; source: LibpostalSource; i: number }> {
  for (let i = 0; i < maxLen; i++) {
    for (let s = 0; s < sources.length; s++) {
      const line = lines[s]![i];
      if (line !== undefined) yield { line, source: sources[s]!, i };
    }
  }
}

const overrides = loadOverrides();
const index = new GoldIndex();
/** Refined text → the override that applies to it. */
const overrideByText = new Map<string, GoldOverride>();
for (const { line } of rawLines()) {
  const result = refineLine(line);
  if (!result?.ok) continue;
  index.add(result);
  const o = overrides.get(lineKey(line));
  if (o && o.text === result.text) overrideByText.set(o.text, o);
}

mkdirSync(DATA_DIR, { recursive: true });
const outs = Object.fromEntries(SPLITS.map((s) => [s, createWriteStream(splitPath(s))])) as Record<
  Split,
  WriteStream
>;

const stats = {
  libpostalSnapshot: LIBPOSTAL_SNAPSHOT,
  linesRead: 0,
  examples: 0,
  duplicates: 0,
  /** Lines dropped, by reason, counting duplicates. `override` is lines rejected by overrides/gold.jsonl. */
  rejected: {} as Record<string, number>,
  /** Entries in overrides/gold.jsonl, and examples written with overridden labels. */
  overrides: {
    entries: overrides.size,
    /** Entries whose line is missing or refines to a different text than the entry's. */
    stale: [...overrides.values()].filter((o) => overrideByText.get(o.text) !== o).length,
    examples: 0,
  },
  bySplit: { train: 0, dev: 0, test: 0 } as Record<Split, number>,
  bySource: {} as Record<string, number>,
  /**
   * Number of lines on which each note fired at least once, counting duplicates and lines
   * rejected by refine or gold.ts, but not lines rejected by an override.
   */
  notes: {} as Record<string, number>,
  /** Number of spans per label. */
  labels: {} as Record<string, number>,
};
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

const seen = new Set<string>();
for (const { line, source, i } of rawLines()) {
  stats.linesRead++;
  const result = refineLine(line);
  if (!result) {
    bump(stats.rejected, "unparseable");
    continue;
  }
  if (!result.ok) {
    for (const note of new Set(result.notes)) bump(stats.notes, note);
    bump(stats.rejected, result.reason);
    continue;
  }
  const override = overrideByText.get(result.text);
  let { spans, notes } = result;
  if (override?.reject !== undefined) {
    bump(stats.rejected, "override");
    continue;
  } else if (override?.spans) {
    spans = resolveSpans(result.text, override.spans);
    notes = [...notes.filter((n) => n.startsWith("dropped:")), "override"];
  } else {
    const check = checkGold(result, index);
    notes = [...notes, ...check.notes];
    spans = check.spans ?? spans;
    if (check.reject) {
      for (const note of new Set(notes)) bump(stats.notes, note);
      bump(stats.rejected, check.reject);
      continue;
    }
  }
  for (const note of new Set(notes)) bump(stats.notes, note);
  if (seen.has(result.text)) {
    stats.duplicates++;
    continue;
  }
  seen.add(result.text);
  const ex: Example = { id: `${source}:${i}`, text: result.text, spans, source };
  const exNotes = noteList(notes);
  if (exNotes) ex.notes = exNotes;
  const split = splitFor(ex);
  outs[split].write(JSON.stringify(ex) + "\n");
  stats.examples++;
  if (override) stats.overrides.examples++;
  stats.bySplit[split]++;
  bump(stats.bySource, source);
  for (const span of ex.spans) bump(stats.labels, span.label);
}
for (const o of overrides.values()) {
  if (overrideByText.get(o.text) !== o) console.warn(`stale override ${o.key}: ${o.text}`);
}
await Promise.all(SPLITS.map((s) => new Promise<void>((resolve) => outs[s].end(() => resolve()))));
writeFileSync(DATA_STATS_PATH, JSON.stringify(stats, null, 2) + "\n");
console.log(JSON.stringify(stats, null, 2));
