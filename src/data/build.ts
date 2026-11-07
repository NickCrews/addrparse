/**
 * Builds data/<split>/<dataset>.jsonl for every dataset (`datasets.ts`), data/manifest.json
 * with their sizes, and data/stats.json. Training and eval sets are blends of these files,
 * chosen when they are loaded (`blend.ts`, `load.ts`).
 *
 * libpostal datasets (openaddresses, osm, ways, places):
 * - Each source contributes its first SOURCE_LIMITS lines (`--limit <source>=<n>`), so a raw
 *   file longer than the limit doesn't change the build.
 * - Sources are read interleaved by SOURCE_WEIGHTS (libpostal.ts, `mix.ts`). The order decides
 *   which source keeps a text that two of them have.
 * - Each line is refined (`refine.ts`), then either replaced by its hand-checked override in
 *   `overrides/gold.jsonl` or checked against the whole corpus (`gold.ts`). A first pass over
 *   all lines builds the corpus counts and finds the texts that overrides apply to.
 * - Synthetic NotAddress examples (src/data/not-address.ts) go to the junk and embedded datasets,
 *   built from the text before noise of the address example that seeded them. An embedded
 *   address is split with its address; a junk text by `junkSplitKey`, so variants of one name or
 *   phone number share a split.
 *
 * `datasets/` datasets, after the libpostal ones, in name order:
 * - `<name>.ts` generates `count` examples, each from an RNG seeded by the name and number. Its
 *   `locality()` and `street()` draw from the first LOCALITY_POOL clean openaddresses and osm
 *   address examples.
 * - `<name>.jsonl` is read as is: no noise, labels checked.
 *
 * For every dataset:
 * - Exact duplicate texts are dropped, across datasets too; the first one written wins.
 * - Splits are assigned by `splitFor` (`lines.ts`): 90% train, 5% dev, 5% test.
 * - Formatting noise (src/data/noise.ts) is added after the split is chosen, from an RNG seeded by
 *   the example, so noise never moves an address across splits and builds stay deterministic.
 *   Both the clean and the noisy text count as seen for deduplication; an example whose noisy
 *   text was already seen is written clean instead.
 *
 *   node src/data/build.ts [--limit <source>=<n> ...]
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
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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
import {
  listDatasets,
  pick,
  toParts,
  type DatasetInfo,
  type GeneratedDataset,
  type Part,
} from "./datasets.ts";
import { lineKey, refineLine, splitFor } from "./lines.ts";
import { checked, parseLabeled } from "./labeled.ts";
import { mixOrder } from "./mix.ts";
import { addNoise, NOISE_NAMES, NOISE_RATES, seededRng, type NoiseName } from "./noise.ts";
import { NOT_ADDRESS_DEFAULTS, notAddressExamples, type NotAddressOptions } from "./not-address.ts";
import {
  DATA_DIR,
  DATA_STATS_PATH,
  datasetPath,
  manifestPath,
  rawPath,
  type Split,
} from "./paths.ts";

const SPLITS: readonly Split[] = ["train", "dev", "test"];

const { values: args } = parseArgs({
  options: {
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
const weights = SOURCE_WEIGHTS;
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

const datasets = listDatasets();
// Removed datasets must not linger, nor data/<split>.jsonl files of the older one-file-per-split
// layout.
for (const split of SPLITS) {
  rmSync(join(DATA_DIR, split), { recursive: true, force: true });
  rmSync(join(DATA_DIR, `${split}.jsonl`), { force: true });
}
/** Output stream per split and dataset, opened on the first example written to it. */
const outs = new Map<string, WriteStream>();
const counts: Record<string, Record<Split, number>> = {};
function out(split: Split, dataset: string): WriteStream {
  const path = datasetPath(split, dataset);
  let w = outs.get(path);
  if (!w) {
    mkdirSync(dirname(path), { recursive: true });
    outs.set(path, (w = createWriteStream(path)));
  }
  return w;
}

const stats = {
  libpostalSnapshot: LIBPOSTAL_SNAPSHOT,
  datasets: Object.fromEntries(datasets.map((d) => [d.name, { kind: d.kind }])) as Record<
    string,
    { kind: string; description?: string }
  >,
  readOrderWeights: Object.fromEntries(sources.map((s) => [s, weights[s]])),
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

function write(ex: Example, split = splitFor(ex)) {
  out(split, ex.source).write(JSON.stringify(ex) + "\n");
  const c = (counts[ex.source] ??= { train: 0, dev: 0, test: 0 });
  c[split]++;
  stats.examples++;
  stats.bySplit[split]++;
  bump(stats.bySource, ex.source);
  for (const span of ex.spans) bump(stats.labels, span.label);
}

const seen = new Set<string>();
/** Marks `ex.text` seen, or counts `ex` as a duplicate and returns false if it already was. */
function isNew(ex: Example): boolean {
  if (seen.has(ex.text)) {
    stats.duplicates++;
    bump(stats.duplicatesBySource, ex.source);
    return false;
  }
  seen.add(ex.text);
  return true;
}

/** Writes `clean` with noise from an RNG seeded by `noiseKey`, or clean when `noise` is false. */
function writeNoisy(clean: Example, noiseKey: string, noise = true) {
  const split = splitFor(clean);
  let ex = noise ? addNoise(clean, seededRng(noiseKey), noiseRates) : clean;
  if (ex !== clean && seen.has(ex.text)) {
    stats.noise.collisions++;
    ex = clean;
  }
  seen.add(ex.text);
  if (ex.noise) for (const n of ex.noise) bump(stats.noise.applied, n);
  else stats.noise.clean++;
  write(ex, split);
}

/** Localities and street lines for `GenerateContext`, from this many clean address examples. */
const LOCALITY_POOL = 100_000;
const localities: Part[][] = [];
const streets: Part[][] = [];
const LOCALITY_LABELS = new Set(["PlaceName", "StateName", "ZipCode", "CountryName"]);
/** Adds the locality and street line of an address example ("12 Main St" + ", Kenai, AK"). */
function pool(ex: Example) {
  if (localities.length >= LOCALITY_POOL) return;
  const parts = toParts(ex.text, ex.spans);
  const at = parts.findIndex((p) => typeof p !== "string" && p[1] === "PlaceName");
  const gap = parts[at - 1];
  if (at < 2 || typeof gap !== "string" || !/^[, ]+$/.test(gap)) return;
  const tail = parts.slice(at);
  if (!tail.every((p) => typeof p === "string" || LOCALITY_LABELS.has(p[1]))) return;
  const street = parts.slice(0, at - 1);
  if (!street.some((p) => typeof p !== "string" && p[1] === "StreetName")) return;
  if (street.some((p) => typeof p !== "string" && p[1] === "NotAddress")) return;
  localities.push([gap, ...tail]);
  streets.push(street);
}

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
  const clean: Example = { id: `${source}:${i}`, text: result.text, spans, source };
  if (!isNew(clean)) continue;
  const exNotes = noteList(notes);
  if (exNotes) clean.notes = exNotes;
  writeNoisy(clean, `noise:${line}`);
  if (source === "openaddresses" || source === "osm") pool(clean);
  if (override) stats.overrides.examples++;
  for (const extra of notAddressExamples(clean, notAddress)) if (isNew(extra)) write(extra);
}
for (const o of overrides.values()) {
  if (overrideByText.get(o.text) !== o) console.warn(`stale override ${o.key}: ${o.text}`);
}

/** Localities indexed by their state's text, lowercased. */
const byState = new Map<string, Part[][]>();
for (const l of localities) {
  const state = l.find((p) => typeof p !== "string" && p[1] === "StateName");
  if (!state || typeof state === "string") continue;
  const k = state[0].toLowerCase();
  if (!byState.has(k)) byState.set(k, []);
  byState.get(k)!.push(l);
}

async function buildAdded(d: DatasetInfo) {
  if (d.kind === "labeled") {
    for (const ex of parseLabeled(readFileSync(d.path!, "utf8"), d.name, d.path)) {
      if (isNew(ex)) writeNoisy(ex, `noise:${ex.id}`, false);
    }
    return;
  }
  const def = (await import(d.path!)).default as GeneratedDataset;
  if (typeof def?.generate !== "function" || !(def.count >= 0)) {
    throw new Error(`${d.path}: default export must be a GeneratedDataset (src/data/datasets.ts)`);
  }
  if (localities.length === 0) throw new Error(`${d.name}: no libpostal localities to draw from`);
  stats.datasets[d.name]!.description = def.description;
  for (let i = 0; i < def.count; i++) {
    const rng = seededRng(`${d.name}:${i}`);
    const parts = def.generate({
      rng,
      locality(opts) {
        const pools = (opts?.state ?? []).flatMap((s) => byState.get(s.toLowerCase()) ?? []);
        return [...pick(rng, pools.length ? pools : localities)];
      },
      street: () => [...pick(rng, streets)],
    });
    if (!parts) continue;
    const id = `${d.name}:${i}`;
    let ex: Example;
    try {
      ex = { id, ...checked(parts), source: d.name };
    } catch (e) {
      throw new Error(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (isNew(ex)) writeNoisy(ex, `noise:${ex.id}`, def.noise ?? true);
  }
}

for (const d of datasets) {
  if (d.kind === "generated" || d.kind === "labeled") {
    const before = stats.examples;
    await buildAdded(d);
    console.error(`${d.name}: ${(stats.examples - before).toLocaleString("en-US")} examples`);
  }
}

await Promise.all(
  [...outs.values()].map((w) => new Promise<void>((resolve) => w.end(() => resolve()))),
);
/** Datasets in registry order, so blends tie-break the same way on every build. */
const manifest = {
  datasets: Object.fromEntries(
    datasets.filter((d) => counts[d.name]).map((d) => [d.name, counts[d.name]!]),
  ),
};
writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(DATA_STATS_PATH, JSON.stringify(stats, null, 2) + "\n");
console.log(JSON.stringify(stats, null, 2));
