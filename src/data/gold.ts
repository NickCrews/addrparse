/**
 * Checks on refined gold labels that need the whole corpus or a human, applied by `build.ts`
 * after `refine.ts`.
 *
 * libpostal truncates and misspells words on purpose as noise, which `refine.ts`, seeing one
 * line at a time, can't always recognize. `checkGold` finds it with corpus counts:
 *
 * | note                       | example          | action   | why                                                |
 * | -------------------------- | ---------------- | -------- | -------------------------------------------------- |
 * | `road:truncated-to-letter` | "Wilmont D"      | reject   | Drive, Road or Lane cut to one letter: which letters are types can't be told from names ("Windsor C") |
 * | `road:misspelled-type`     | "Laurel Cyn Raod" | relabel | the last word, one edit from a type, becomes StreetNamePostType |
 * | `city:abbreviated`         | "S Diego", "Cty" | note     | labels are right, but the text is libpostal noise  |
 *
 * `overrides/gold.jsonl` holds hand-checked labels for single lines, keyed by `lineKey` of the
 * raw libpostal line. An override replaces both refine's labels and these checks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLabel, type Label } from "../labels.ts";
import type { Example, Span } from "../types.ts";
import { ROOT } from "./paths.ts";
import { norm } from "./refine.ts";
import { STREET_SUFFIXES } from "./street-suffixes.ts";

export const GOLD_OVERRIDES_PATH = join(ROOT, "overrides", "gold.jsonl");

type Labeled = Pick<Example, "text" | "spans">;

/**
 * Words one edit from a street type that end names without one ("Amber Leaf", "Phoebe Lace",
 * "Las Olas") often enough to pass the misspelling ratio.
 */
const NOT_MISSPELLED: ReadonlySet<string> = new Set([
  ...["leaf", "lace", "olas", "dame", "curva", "tunas", "paro", "plan", "miel", "milla"],
]);

/** Final letters that are libpostal's truncations of Drive, Road and Lane. */
const TRUNCATED_LETTERS: ReadonlySet<string> = new Set(["d", "r", "l"]);

/**
 * A word one edit from a street type is a misspelling of it when it ends a street name this many
 * times more often than it appears anywhere else in street or place names. "Raod" ends 3187
 * names and appears elsewhere 56 times; "Tree" 911 and 205.
 */
const MISSPELLING_RATIO = 5;

/** A city spelling counts as known when seen at least this often in the same ZIP or state. */
const MIN_CITY_COUNT = { zip: 3, state: 10 };

const LONG_SUFFIXES = [...STREET_SUFFIXES].filter((s) => s.length >= 4);

const DIRECTIONAL_WORDS: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
};

/** True when `a` and `b` differ by one insertion, deletion, substitution or adjacent swap. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** A street type, a truncation of one ("Ro"), or one edit from a type of 4+ letters ("Avnu"). */
function typeLike(w: string): boolean {
  if (STREET_SUFFIXES.has(w)) return true;
  return LONG_SUFFIXES.some((s) => s[0] === w[0] && (s.startsWith(w) || oneEditApart(w, s)));
}

/**
 * `short` is a prefix of `full` ("S" of "San"), or `full` with letters left out keeping the
 * first and no later vowel ("Cty" of "City", "Mddl" of "Middle"; not "Novi" of "Northville").
 */
function abbreviates(short: string, full: string): boolean {
  if (short.length >= full.length || short[0] !== full[0]) return false;
  if (full.startsWith(short)) return true;
  if (/[aeiou]/.test(short.slice(1))) return false;
  let i = 0;
  for (const ch of full) if (ch === short[i]) i++;
  return i === short.length;
}

/** USPS street-type abbreviations ("Mt", "Spgs", "Hts"), "Twp" and directionals are real spellings. */
function standardAbbreviation(short: string, full: string): boolean {
  return STREET_SUFFIXES.has(short) || short === "twp" || DIRECTIONAL_WORDS[short] === full;
}

const textOf = (ex: Labeled, s: Span) => ex.text.slice(s.start, s.end);
const words = (s: string) => s.split(/\s+/).map(norm).filter(Boolean);
const cityText = (s: string) => words(s).join(" ").replace(/\./g, "");

/** Where a city is compared: its 5-digit ZIP, else its state's text, else nowhere. */
function cityArea(ex: Labeled): { key: string; min: number } | undefined {
  const zip = ex.spans.find((s) => s.label === "ZipCode");
  const digits = zip && /\d{5}/.exec(textOf(ex, zip));
  if (digits) return { key: `zip:${digits[0]}`, min: MIN_CITY_COUNT.zip };
  const state = ex.spans.find((s) => s.label === "StateName");
  if (state) return { key: `state:${cityText(textOf(ex, state))}`, min: MIN_CITY_COUNT.state };
  return undefined;
}

/** Corpus counts the checks compare against: city spellings per area, and known words. */
export class GoldIndex {
  /** `${area}|${word count}|${first letter}` → city spelling → count. */
  private cities = new Map<string, Map<string, number>>();
  /** Last words of street names of 2+ words, with counts. */
  private finalWords = new Map<string, number>();
  /** Other street-name words and place-name words, with counts. */
  private otherWords = new Map<string, number>();

  add(ex: Labeled): void {
    const bump = (m: Map<string, number>, w: string) => m.set(w, (m.get(w) ?? 0) + 1);
    for (const span of ex.spans) {
      if (span.label !== "StreetName" && span.label !== "PlaceName") continue;
      const ws = words(textOf(ex, span));
      if (span.label === "StreetName" && ws.length >= 2) bump(this.finalWords, ws.pop()!);
      for (const w of ws) bump(this.otherWords, w);
    }
    const city = ex.spans.find((s) => s.label === "PlaceName");
    const area = cityArea(ex);
    if (!city || !area) return;
    const name = cityText(textOf(ex, city));
    const bucket = this.bucket(area.key, name);
    if (!bucket) return;
    let m = this.cities.get(bucket);
    if (!m) this.cities.set(bucket, (m = new Map()));
    m.set(name, (m.get(name) ?? 0) + 1);
  }

  private bucket(area: string, name: string): string | undefined {
    if (!name) return undefined;
    return `${area}|${name.split(" ").length}|${name[0]}`;
  }

  /** True when `w` mostly ends street names, as a misspelled type would. */
  mostlyFinal(w: string): boolean {
    return (this.otherWords.get(w) ?? 0) * MISSPELLING_RATIO < (this.finalWords.get(w) ?? 0);
  }

  /** The common spelling in the same area that `name` abbreviates, if any. */
  expandCity(area: { key: string; min: number }, name: string): string | undefined {
    const m = this.cities.get(this.bucket(area.key, name) ?? "");
    if (!m) return undefined;
    const own = m.get(name) ?? 0;
    const short = name.split(" ");
    let best: [string, number] | undefined;
    for (const [full, n] of m) {
      if (n < area.min || n <= own || (best && n <= best[1])) continue;
      const long = full.split(" ");
      const pairs = short.map((w, k) => [w, long[k]!] as const);
      const changed = pairs.filter(([a, b]) => a !== b);
      if (changed.length === 0 || !changed.every(([a, b]) => abbreviates(a, b))) continue;
      if (changed.every(([a, b]) => standardAbbreviation(a, b))) continue;
      best = [full, n];
    }
    return best?.[0];
  }
}

export interface GoldCheck {
  /** Set when the example's gold can't be trusted and it should be dropped. */
  reject?: string;
  /** The corrected spans, when they differ from the example's. */
  spans?: Span[];
  notes: string[];
}

/** Finds gold labels that rest on a libpostal truncation or misspelling; see the module doc. */
export function checkGold(ex: Labeled, index: GoldIndex): GoldCheck {
  const notes: string[] = [];
  let spans: Span[] | undefined;
  const k = ex.spans.findLastIndex((s) => s.label === "StreetName");
  const name = ex.spans[k];
  const typed =
    ex.spans[k + 1]?.label === "StreetNamePostType" ||
    ex.spans[k - 1]?.label === "StreetNamePreType";
  if (name && !typed) {
    const ws = words(textOf(ex, name)).map((w) => w.replace(/\./g, ""));
    const last = ws.at(-1)!;
    const prev = ws.at(-2);
    // Lettered avenues ("Avnu D", Brooklyn's "Av L") are names; other type words before the
    // letter are part of the name ("Beach R", "Mallard Creek R").
    if (prev !== undefined && TRUNCATED_LETTERS.has(last) && /^\p{L}{2,}$/u.test(prev)) {
      const avenue = ws.length === 2 && /^av/.test(prev) && typeLike(prev);
      if (!avenue) return { reject: "road:truncated-to-letter", notes };
    }
    if (
      prev !== undefined &&
      /^\p{L}[\p{L}-]{3,}$/u.test(last) &&
      !STREET_SUFFIXES.has(last) &&
      !NOT_MISSPELLED.has(last) &&
      LONG_SUFFIXES.some((s) => s[0] === last[0] && oneEditApart(last, s)) &&
      index.mostlyFinal(last)
    ) {
      notes.push("road:misspelled-type");
      const typeStart = ex.text.lastIndexOf(" ", name.end - 1) + 1;
      const end = ex.text.slice(name.start, typeStart).trimEnd().length + name.start;
      spans = ex.spans.flatMap((s) =>
        s === name
          ? [
              { ...s, end },
              { start: typeStart, end: s.end, label: "StreetNamePostType" as const },
            ]
          : [s],
      );
    }
  }
  const city = ex.spans.find((s) => s.label === "PlaceName");
  const area = cityArea(ex);
  if (city && area && index.expandCity(area, cityText(textOf(ex, city)))) {
    notes.push("city:abbreviated");
  }
  return spans ? { spans, notes } : { notes };
}

/** One line of `overrides/gold.jsonl`. */
export interface GoldOverride {
  /** `lineKey` of the raw libpostal line. */
  key: string;
  /** The refined text the override was written against; a mismatch makes it stale. */
  text: string;
  /** Each span's text and label, in order. */
  spans?: [string, Label][];
  /** Why the line is dropped instead. */
  reject?: string;
  /** Why the labels differ from what refine produces. */
  why?: string;
}

/**
 * Spans for `[text, label]` pairs, each found at the earliest word-aligned position after the
 * previous one.
 */
export function resolveSpans(text: string, pairs: readonly (readonly [string, Label])[]): Span[] {
  const spans: Span[] = [];
  const wordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  let from = 0;
  for (const [piece, label] of pairs) {
    let start = text.indexOf(piece, from);
    while (
      start !== -1 &&
      ((wordChar(piece[0]) && wordChar(text[start - 1])) ||
        (wordChar(piece.at(-1)) && wordChar(text[start + piece.length])))
    ) {
      start = text.indexOf(piece, start + 1);
    }
    if (!piece || start === -1) throw new Error(`span ${JSON.stringify(piece)} not found in order`);
    spans.push({ start, end: start + piece.length, label });
    from = start + piece.length;
  }
  return spans;
}

/** Parses and validates `overrides/gold.jsonl`, keyed by line key. */
export function parseOverrides(src: string, file = GOLD_OVERRIDES_PATH): Map<string, GoldOverride> {
  const out = new Map<string, GoldOverride>();
  const texts = new Set<string>();
  src.split("\n").forEach((line, n) => {
    if (!line.trim()) return;
    const where = `${file}:${n + 1}`;
    let o: GoldOverride;
    try {
      o = JSON.parse(line) as GoldOverride;
    } catch (e) {
      throw new Error(`${where}: ${(e as Error).message}`);
    }
    if (!/^[0-9a-f]{16}$/.test(o.key)) throw new Error(`${where}: key must be 16 hex digits`);
    if (out.has(o.key)) throw new Error(`${where}: duplicate key ${o.key}`);
    if (texts.has(o.text)) throw new Error(`${where}: duplicate text ${JSON.stringify(o.text)}`);
    texts.add(o.text);
    if (typeof o.text !== "string") throw new Error(`${where}: text missing`);
    if ((o.spans === undefined) === (o.reject === undefined)) {
      throw new Error(`${where}: needs exactly one of spans or reject`);
    }
    if (o.spans) {
      for (const [, label] of o.spans) {
        if (!isLabel(label)) throw new Error(`${where}: unknown label ${label}`);
      }
      let spans: Span[];
      try {
        spans = resolveSpans(o.text, o.spans);
      } catch (e) {
        throw new Error(`${where}: ${(e as Error).message}`);
      }
      const covered = new Array<boolean>(o.text.length).fill(false);
      for (const sp of spans) covered.fill(true, sp.start, sp.end);
      const gap = [...o.text].findIndex((c, i) => /[\p{L}\p{N}]/u.test(c) && !covered[i]);
      if (gap !== -1)
        throw new Error(`${where}: no span covers ${JSON.stringify(o.text[gap])} at ${gap}`);
    }
    out.set(o.key, o);
  });
  return out;
}

export function loadOverrides(): Map<string, GoldOverride> {
  return parseOverrides(readFileSync(GOLD_OVERRIDES_PATH, "utf8"));
}

/** An override line for `ex` with its current labels, to edit by hand. */
export function overrideTemplate(key: string, ex: Labeled): GoldOverride {
  return { key, text: ex.text, spans: ex.spans.map((s) => [textOf(ex, s), s.label]) };
}

/** Distinct notes in first-seen order, or undefined when there are none. */
export function noteList(notes: readonly string[]): string[] | undefined {
  return notes.length ? [...new Set(notes)] : undefined;
}
