/**
 * Builds datasets/ak-apoc.jsonl from the addresses `extract.py` pulled out of APOC's campaign
 * finance data. See the `ak-apoc` section of datasets/README.md for what is kept and why.
 *
 *   node scripts/ak-apoc/build.ts --addresses data/raw/apoc.jsonl --model <crf model.bin> \
 *     [--hand scripts/ak-apoc/hand.jsonl] [--out datasets/ak-apoc.jsonl] [--residue <path>]
 *
 * 1. Each row is rendered as one line: `address, city, state zip`. The locality is left off
 *    when the address line already ends with it.
 * 2. Rows are deduplicated by shape: lines that differ only in their digits or letter case count
 *    as one, and the most frequent row of each shape is kept.
 * 3. Each shape is labeled by `rules.ts`, or by its line in `--hand`, which holds labels written
 *    for shapes the rules don't cover. Shapes in neither go to `--residue` for labeling.
 * 4. A labeled shape is kept when the `--model` parser gets it wrong: a different span set, or
 *    a confidence below 0.9. Of the lines with a dollar amount for a ZIP, the first 100 are kept.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { load } from "../../impls/crf/load.ts";
import { fromParts, toParts, type Part } from "../../src/data/datasets.ts";
import { resolveSpans } from "../../src/data/gold.ts";
import { checked, parseLabeled } from "../../src/data/labeled.ts";
import type { Label } from "../../src/labels.ts";
import { asScoredParse, type Span } from "../../src/types.ts";
import {
  isNoValue,
  labelAddress,
  labelCity,
  labelWithLocality,
  labelZip,
  stateCode,
  toWordParts,
  words,
} from "./rules.ts";

const { values } = parseArgs({
  options: {
    addresses: { type: "string", default: "data/raw/apoc.jsonl" },
    model: { type: "string" },
    hand: { type: "string", default: "scripts/ak-apoc/hand.jsonl" },
    out: { type: "string", default: "datasets/ak-apoc.jsonl" },
    residue: { type: "string", default: "data/raw/apoc-residue.jsonl" },
  },
});
if (!values.model) throw new Error("--model <crf model .bin> is required");

interface Row {
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  n: number;
}

/** Collapses runs of spaces and strips separators from a field's ends. */
const clean = (s: string | null) =>
  (s ?? "")
    .replace(/[\r\n]+/g, ", ")
    .replace(/^[\s,;]+|[\s,;]+$/g, "")
    .replace(/\s+/g, " ");

const shapeOf = (text: string) => text.toUpperCase().replace(/\d/g, "9");

interface Rendered {
  text: string;
  /** Undefined when a field has a shape the rules don't cover. */
  parts?: Part[];
  /** Which fields the rules couldn't label. */
  why?: string[];
  n: number;
}

/** The row as one line, labeled by the rules where they can. */
function render(row: Row): Rendered | undefined {
  const address = clean(row.address);
  const city = clean(row.city);
  const state = clean(row.state);
  const zip = clean(row.zip);
  if (!address || /^armed forces/i.test(state)) return undefined;

  const ws = words(address);
  // The address line already ends with the city, state or ZIP: don't repeat them.
  const ends = new Set([city, state, zip, stateCode(state) ?? ""].map((s) => s.toLowerCase()));
  const last = ws.at(-1)?.text.toLowerCase() ?? "";
  const repeats = ws.length > 1 && (ends.has(last) || (!!zip && last.startsWith(zip.slice(0, 5))));

  const why: string[] = [];
  const parts: Part[] = [];
  if (isNoValue(address)) {
    parts.push([address, "NotAddress"]);
  } else {
    const labels = repeats ? labelWithLocality(ws, city, state) : labelAddress(ws);
    if (labels) parts.push(...toWordParts(address, ws, labels));
    else why.push(repeats ? "repeat" : "address");
  }
  if (!repeats) {
    if (city) {
      const c = labelCity(city, state);
      if (c) parts.push(", ", ...c);
      else why.push("city");
    }
    if (state) parts.push(", ", [state, "StateName"]);
    if (zip) {
      const z = labelZip(zip, state);
      if (z) parts.push(state ? " " : ", ", [zip, z]);
      else why.push("zip");
    }
  }
  const text = repeats
    ? address
    : [address, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (why.length) return { text, why, n: row.n };
  if (fromParts(parts).text !== text) throw new Error(`rendering mismatch: ${text}`);
  return { text, parts, n: row.n };
}

const rows: Row[] = readFileSync(values.addresses, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Row);

const hand = new Map<string, Span[]>();
try {
  for (const ex of parseLabeled(readFileSync(values.hand, "utf8"), "ak-apoc", values.hand)) {
    hand.set(ex.text, ex.spans);
  }
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const byShape = new Map<string, Rendered>();
for (const row of rows) {
  const r = render(row);
  if (!r) continue;
  const shape = shapeOf(r.text);
  const prev = byShape.get(shape);
  if (!prev) byShape.set(shape, r);
  else prev.n += r.n;
}

const parser = load(new Uint8Array(readFileSync(values.model)));
const sameSpans = (a: readonly Span[], b: readonly Span[]) =>
  a.length === b.length &&
  a.every((s, k) => s.start === b[k]!.start && s.end === b[k]!.end && s.label === b[k]!.label);

/** Spans as `[text, label]` pairs when the pairs resolve back to the same spans. */
function asPairs(text: string, spans: readonly Span[]): [string, Label][] | undefined {
  const pairs = toParts(text, spans).filter((p): p is [string, Label] => typeof p !== "string");
  try {
    if (sameSpans(resolveSpans(text, pairs), spans)) return pairs.map(([t, l]) => [t, l]);
  } catch {}
  return undefined;
}

const MAX_MONEY_ZIP = 100;
const kept: string[] = [];
const residue: string[] = [];
const stats = {
  shapes: byShape.size,
  rules: 0,
  hand: 0,
  residue: 0,
  kept: 0,
  wrong: 0,
  unsure: 0,
  moneyZips: 0,
};
for (const r of byShape.values()) {
  let spans: Span[];
  if (hand.has(r.text)) {
    spans = hand.get(r.text)!;
    stats.hand++;
  } else if (r.parts) {
    spans = checked(r.parts).spans;
    stats.rules++;
  } else {
    stats.residue++;
    residue.push(JSON.stringify({ text: r.text, why: r.why, n: r.n }));
    continue;
  }
  const parse = asScoredParse(parser.parse(r.text));
  const wrong = !sameSpans(
    parse.spans.map(({ start, end, label }) => ({ start, end, label })),
    spans,
  );
  const unsure = (parse.confidence ?? 0) < 0.9;
  if (!wrong && !unsure) continue;
  // Shapes that differ only in the street before a dollar amount in the ZIP field teach one
  // thing; keep the first MAX_MONEY_ZIP.
  if (/ \$[\d,.]+$/.test(r.text) && ++stats.moneyZips > MAX_MONEY_ZIP) continue;
  if (wrong) stats.wrong++;
  else stats.unsure++;
  stats.kept++;
  kept.push(JSON.stringify({ text: r.text, spans: asPairs(r.text, spans) ?? spans }));
}
writeFileSync(values.out, kept.join("\n") + "\n");
writeFileSync(values.residue, residue.join("\n") + (residue.length ? "\n" : ""));
console.log(stats);
