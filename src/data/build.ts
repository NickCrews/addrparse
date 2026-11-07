/**
 * Builds data/{train,dev,test}.jsonl and data/stats.json from data/raw/*.tsv.
 *
 * - Sources are interleaved line by line, so any prefix of a split mixes them evenly.
 * - Exact duplicate texts are dropped.
 * - Splits are assigned by a hash of the address identity (number, street name, place, ZIP,
 *   box number), not of the text, so two renderings of one address never straddle train and test.
 *   90% train, 5% dev, 5% test.
 * - Each line's field separator (", " or " ") is chosen by a hash of the line, so builds are
 *   deterministic.
 *
 *   node src/data/build.ts
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, type WriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Label } from "../labels.ts";
import type { Example } from "../types.ts";
import { LIBPOSTAL_FILES, LIBPOSTAL_SNAPSHOT, parseLine, type LibpostalSource } from "./libpostal.ts";
import { DATA_DIR, DATA_STATS_PATH, rawPath, splitPath, type Split } from "./paths.ts";
import { refine } from "./refine.ts";

const SPLITS: readonly Split[] = ["train", "dev", "test"];
const IDENTITY_LABELS: ReadonlySet<Label> = new Set([
  "AddressNumber",
  "StreetName",
  "PlaceName",
  "ZipCode",
  "USPSBoxID",
]);

function hashUnit(s: string): number {
  return createHash("sha1").update(s).digest().readUInt32BE(0) / 2 ** 32;
}

function splitFor(ex: Example): Split {
  const identity = ex.spans
    .filter((s) => IDENTITY_LABELS.has(s.label))
    .map((s) => ex.text.slice(s.start, s.end).toLowerCase())
    .join("|");
  const u = hashUnit(identity || ex.text.toLowerCase());
  return u < 0.9 ? "train" : u < 0.95 ? "dev" : "test";
}

const sources = (Object.keys(LIBPOSTAL_FILES) as LibpostalSource[]).filter((s) =>
  existsSync(rawPath(s)),
);
if (sources.length === 0) throw new Error("no data/raw/*.tsv; run `pnpm data:fetch` first");
const lines = sources.map((s) => readFileSync(rawPath(s), "utf8").split("\n").filter(Boolean));

mkdirSync(DATA_DIR, { recursive: true });
const outs = Object.fromEntries(
  SPLITS.map((s) => [s, createWriteStream(splitPath(s))]),
) as Record<Split, WriteStream>;

const stats = {
  libpostalSnapshot: LIBPOSTAL_SNAPSHOT,
  linesRead: 0,
  examples: 0,
  duplicates: 0,
  rejected: {} as Record<string, number>,
  bySplit: { train: 0, dev: 0, test: 0 } as Record<Split, number>,
  bySource: {} as Record<string, number>,
  /** Number of examples on which each heuristic note fired at least once. */
  notes: {} as Record<string, number>,
  /** Number of spans per label. */
  labels: {} as Record<string, number>,
};
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

const seen = new Set<string>();
const maxLen = Math.max(...lines.map((l) => l.length));
for (let i = 0; i < maxLen; i++) {
  for (let s = 0; s < sources.length; s++) {
    const line = lines[s]![i];
    if (line === undefined) continue;
    const source = sources[s]!;
    stats.linesRead++;
    const parsed = parseLine(line);
    if (!parsed) {
      bump(stats.rejected, "unparseable");
      continue;
    }
    const fieldSeparator = hashUnit(line) < 0.6 ? ", " : " ";
    const result = refine(parsed.tokens, { fieldSeparator });
    for (const note of new Set(result.notes)) bump(stats.notes, note);
    if (!result.ok) {
      bump(stats.rejected, result.reason);
      continue;
    }
    if (seen.has(result.text)) {
      stats.duplicates++;
      continue;
    }
    seen.add(result.text);
    const ex: Example = { id: `${source}:${i}`, text: result.text, spans: result.spans, source };
    const split = splitFor(ex);
    outs[split].write(JSON.stringify(ex) + "\n");
    stats.examples++;
    stats.bySplit[split]++;
    bump(stats.bySource, source);
    for (const span of ex.spans) bump(stats.labels, span.label);
  }
}
await Promise.all(SPLITS.map((s) => new Promise<void>((resolve) => outs[s].end(() => resolve()))));
writeFileSync(DATA_STATS_PATH, JSON.stringify(stats, null, 2) + "\n");
console.log(JSON.stringify(stats, null, 2));
