/**
 * Builds data/{train,dev,test}.jsonl and data/stats.json from data/raw/*.tsv.
 *
 * - Each source contributes its first SOURCE_LIMITS lines (`--limit <source>=<n>`), so a raw
 *   file longer than the limit doesn't change the build.
 * - Sources are interleaved in proportion to SOURCE_WEIGHTS (libpostal.ts), so any prefix of a
 *   split mixes them in those proportions (`mix.ts`). `--mix <source>=<w>` overrides a weight.
 * - Each line is refined (`refine.ts`), then either replaced by its hand-checked override in
 *   `overrides/gold.jsonl` or checked against the whole corpus (`gold.ts`). A first pass over
 *   all lines builds the corpus counts and finds the texts that overrides apply to.
 * - Exact duplicate texts are dropped. An override applies to every line with its text.
 * - Splits are assigned by `splitFor` (`lines.ts`): 90% train, 5% dev, 5% test.
 * - Formatting noise (src/data/noise.ts) is added after the split is chosen, from an RNG seeded by
 *   the line, so noise never moves an address across splits and builds stay deterministic. Both
 *   the clean and the noisy text count as seen for deduplication; an example whose noisy text was
 *   already seen is written clean instead.
 * - Synthetic NotAddress examples (src/data/not-address.ts) are interleaved right after the
 *   address example that seeded them, built from its text before noise. An embedded address is
 *   split with its address; a junk text by `junkSplitKey`, so variants of one name or phone
 *   number share a split.
 *
 *   node src/data/build.ts [--mix <source>=<weight> ...] [--limit <source>=<n> ...]
 *     [--noise-scale 1] [--junk-rate 0.02] [--embedded-rate 0.02]
 *
 * `--noise-scale` multiplies every rate in NOISE_RATES; 0 builds clean data.
 */
import { parseArgs } from "node:util";
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
import {
  LIBPOSTAL_FILES,
  LIBPOSTAL_SNAPSHOT,
  parseSourceNumbers,
  SOURCE_LIMITS,
  SOURCE_WEIGHTS,
  type LibpostalSource,
} from "./libpostal.ts";
import { lineKey, refineLine, splitFor } from "./lines.ts";
import { mixOrder } from "./mix.ts";
import { addNoise, NOISE_NAMES, NOISE_RATES, seededRng, type NoiseName } from "./noise.ts";
import { NOT_ADDRESS_DEFAULTS, notAddressExamples, type NotAddressOptions } from "./not-address.ts";
import { DATA_DIR, DATA_STATS_PATH, rawPath, splitPath, type Split } from "./paths.ts";

const SPLITS: readonly Split[] = ["train", "dev", "test"];

const { values: args } = parseArgs({
  options: {
    mix: { type: "string", multiple: true, default: [] },
    limit: { type: "string", multiple: true, default: [] },
    "noise-scale": { type: "string", default: "1" },
    "junk-rate": { type: "string", default: String(NOT_ADDRESS_DEFAULTS.junkRate) },
    "embedded-rate": { type: "string", default: String(NOT_ADDRESS_DEFAULTS.embeddedRate) },
  },
});
const noiseScale = Number(args["noise-scale"]);
if (!(noiseScale >= 0)) throw new Error(`--noise-scale must be a number >= 0`);
const noiseRates = Object.fromEntries(
  NOISE_NAMES.map((n) => [n, Math.min(1, NOISE_RATES[n] * noiseScale)]),
) as Record<NoiseName, number>;
const notAddress: NotAddressOptions = {
  ...NOT_ADDRESS_DEFAULTS,
  junkRate: Number(args["junk-rate"]),
  embeddedRate: Number(args["embedded-rate"]),
};

const sources = (Object.keys(LIBPOSTAL_FILES) as LibpostalSource[]).filter((s) =>
  existsSync(rawPath(s)),
);
if (sources.length === 0) throw new Error("no data/raw/*.tsv; run `pnpm data:fetch` first");
const weights = { ...SOURCE_WEIGHTS, ...parseSourceNumbers(args.mix ?? []) };
const limits = { ...SOURCE_LIMITS, ...parseSourceNumbers(args.limit ?? []) };
for (const s of Object.keys(LIBPOSTAL_FILES) as LibpostalSource[]) {
  if (weights[s] > 0 && !sources.includes(s)) console.warn(`${s}: no ${rawPath(s)}; skipped`);
}
if (!sources.some((s) => weights[s] > 0 && limits[s] > 0)) {
  throw new Error("every source with raw data has weight or limit 0");
}
const lines = sources.map((s) =>
  readFileSync(rawPath(s), "utf8").split("\n").filter(Boolean).slice(0, limits[s]),
);

const lengths = lines.map((l) => l.length);
const mixWeights = sources.map((s) => weights[s]);

/** Every raw line with its source and line number, in the weighted mix order. */
function* rawLines(): Generator<{ line: string; source: LibpostalSource; i: number }> {
  for (const { source: s, i } of mixOrder(lengths, mixWeights)) {
    yield { line: lines[s]![i]!, source: sources[s]!, i };
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
  weights: Object.fromEntries(sources.map((s) => [s, weights[s]])),
  limits: Object.fromEntries(sources.map((s) => [s, limits[s]])),
  notAddress,
  linesRead: 0,
  examples: 0,
  duplicates: 0,
  /** Lines dropped, by reason, counting duplicates. `override` is lines rejected by overrides/gold.jsonl. */
  rejected: {} as Record<string, number>,
  linesReadBySource: {} as Record<string, number>,
  duplicatesBySource: {} as Record<string, number>,
  /** `rejected`, per source. */
  rejectedBySource: {} as Record<string, Record<string, number>>,
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
  noise: {
    rates: noiseRates,
    /** Examples with no noise applied. */
    clean: 0,
    /** Examples written clean because their noisy text duplicated an earlier example. */
    collisions: 0,
    /** Examples each transform was applied to. */
    applied: Object.fromEntries(NOISE_NAMES.map((n) => [n, 0])) as Record<string, number>,
  },
  /** Number of spans per label. */
  labels: {} as Record<string, number>,
};
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
function reject(source: string, reason: string) {
  bump(stats.rejected, reason);
  bump((stats.rejectedBySource[source] ??= {}), reason);
}
function duplicate(source: string) {
  stats.duplicates++;
  bump(stats.duplicatesBySource, source);
}

function write(ex: Example, split = splitFor(ex)) {
  outs[split].write(JSON.stringify(ex) + "\n");
  stats.examples++;
  stats.bySplit[split]++;
  bump(stats.bySource, ex.source);
  for (const span of ex.spans) bump(stats.labels, span.label);
}

const seen = new Set<string>();
for (const { line, source, i } of rawLines()) {
  stats.linesRead++;
  bump(stats.linesReadBySource, source);
  const result = refineLine(line);
  if (!result) {
    reject(source, "unparseable");
    continue;
  }
  if (!result.ok) {
    for (const note of new Set(result.notes)) bump(stats.notes, note);
    reject(source, result.reason);
    continue;
  }
  const override = overrideByText.get(result.text);
  let { spans, notes } = result;
  if (override?.reject !== undefined) {
    reject(source, "override");
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
      reject(source, check.reject);
      continue;
    }
  }
  for (const note of new Set(notes)) bump(stats.notes, note);
  if (seen.has(result.text)) {
    duplicate(source);
    continue;
  }
  seen.add(result.text);
  const clean: Example = { id: `${source}:${i}`, text: result.text, spans, source };
  const exNotes = noteList(notes);
  if (exNotes) clean.notes = exNotes;
  const split = splitFor(clean);
  let ex = addNoise(clean, seededRng(`noise:${line}`), noiseRates);
  if (ex !== clean && seen.has(ex.text)) {
    stats.noise.collisions++;
    ex = clean;
  }
  seen.add(ex.text);
  if (ex.noise) for (const n of ex.noise) bump(stats.noise.applied, n);
  else stats.noise.clean++;
  write(ex, split);
  if (override) stats.overrides.examples++;
  for (const extra of notAddressExamples(clean, notAddress)) {
    if (seen.has(extra.text)) {
      duplicate(extra.source);
      continue;
    }
    seen.add(extra.text);
    write(extra);
  }
}
for (const o of overrides.values()) {
  if (overrideByText.get(o.text) !== o) console.warn(`stale override ${o.key}: ${o.text}`);
}
await Promise.all(SPLITS.map((s) => new Promise<void>((resolve) => outs[s].end(() => resolve()))));
writeFileSync(DATA_STATS_PATH, JSON.stringify(stats, null, 2) + "\n");
console.log(JSON.stringify(stats, null, 2));
