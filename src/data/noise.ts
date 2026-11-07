/**
 * Formatting noise applied to rendered examples, so robustness to messy input is measured
 * separately from clean-input accuracy. Each transform rewrites an example's text and spans
 * together and is named in `Example.noise` when applied; `src/eval/slices.ts` has one slice per
 * name plus a `noise=none` slice.
 *
 * Transforms run in `NOISE_NAMES` order. Each fires with probability `NOISE_RATES[name]` among
 * examples it applies to (e.g. `unit-joined` only to examples with a unit), and a transform that
 * would leave the example unchanged is not recorded.
 *
 * The example is edited as alternating pieces `gap, span, gap, span, …, gap`, where gaps are the
 * unlabeled text between spans. Transforms edit, move or remove pieces, and spans are recomputed
 * from the pieces, so offsets stay exact however much text changes length.
 */
import { createHash } from "node:crypto";
import type { Label } from "../labels.ts";
import type { Example, Span } from "../types.ts";

export const NOISE_NAMES = [
  /** "Apt 4, 123 Main St": the unit moves before the house number. */
  "unit-first",
  /** "Apt4", "#4": no space between unit type and identifier. */
  "unit-joined",
  /** "Kenai, AK" from "Kenai, AK 99611". */
  "drop-zip",
  /** "Kenai 99611" from "Kenai, AK 99611". */
  "drop-state",
  /** "Kenai, 99611 AK". */
  "zip-before-state",
  /** "123 Main St\nKenai, AK": a line break before the city (or state/ZIP if no city). */
  "newline",
  /** "St." "N." "Apt.": a period after abbreviated directionals, street and unit types. */
  "extra-punct",
  /** One deleted, transposed, doubled or keyboard-adjacent letter in a street, city or unit word. */
  "typo",
  /** The whole text lowercased. */
  "lowercase",
  /** The whole text uppercased. Not applied when the text is already uppercase. */
  "uppercase",
] as const;

export type NoiseName = (typeof NOISE_NAMES)[number];

/**
 * Probability each transform fires on an example it applies to. About three quarters of examples
 * stay clean, so clean-input accuracy remains the bulk of the headline numbers, while each noise
 * slice has roughly 100-200 examples in the quick suite's 5,000 dev examples. Transforms that apply
 * to few examples (units: 15%) get higher rates so their slices aren't too small to read.
 */
export const NOISE_RATES: Readonly<Record<NoiseName, number>> = {
  "unit-first": 0.15,
  "unit-joined": 0.25,
  "drop-zip": 0.04,
  "drop-state": 0.03,
  "zip-before-state": 0.03,
  newline: 0.05,
  "extra-punct": 0.05,
  typo: 0.04,
  lowercase: 0.04,
  uppercase: 0.03,
};

/** Text with labeled pieces at odd indices and gaps (possibly empty) at even indices. */
type Pieces = { text: string; label?: Label }[];
type Rng = () => number;
type Transform = (pieces: Pieces, rng: Rng) => Pieces | undefined;

export function toPieces(text: string, spans: readonly Span[]): Pieces {
  const pieces: Pieces = [];
  let at = 0;
  for (const s of spans) {
    pieces.push(
      { text: text.slice(at, s.start) },
      { text: text.slice(s.start, s.end), label: s.label },
    );
    at = s.end;
  }
  pieces.push({ text: text.slice(at) });
  return pieces;
}

/**
 * Concatenates pieces into text and spans, one span per non-empty labeled piece. Spans are never
 * merged: the clean example's span boundaries (e.g. two OccupancyType fields "Basement Lot" that
 * refine keeps apart) carry over unchanged.
 */
export function fromPieces(pieces: Pieces): { text: string; spans: Span[] } {
  let text = "";
  const spans: Span[] = [];
  for (const p of pieces) {
    text += p.text;
    if (p.label !== undefined && p.text !== "") {
      spans.push({ start: text.length - p.text.length, end: text.length, label: p.label });
    }
  }
  return { text, spans };
}

const labeledIndices = (pieces: Pieces, test: (label: Label) => boolean) =>
  pieces.flatMap((p, i) => (p.label !== undefined && test(p.label) ? [i] : []));

/** Removes the labeled piece at `i` with the gap before it (or after it, if it's first). */
function removeAt(pieces: Pieces, i: number): void {
  if (i > 1) pieces.splice(i - 1, 2);
  else pieces.splice(i, 2);
}

const isOccupancy = (l: Label) => l === "OccupancyType" || l === "OccupancyIdentifier";

const unitFirst: Transform = (pieces, rng) => {
  const number = labeledIndices(pieces, (l) => l === "AddressNumber")[0];
  const unit = labeledIndices(pieces, isOccupancy);
  if (number === undefined || unit.length === 0) return undefined;
  const first = unit[0]!;
  // One contiguous unit after the house number.
  let last = first;
  while (pieces[last + 2]?.label !== undefined && isOccupancy(pieces[last + 2]!.label!)) last += 2;
  if (first < number || unit.length !== (last - first) / 2 + 1) return undefined;
  const moved = pieces.slice(first, last + 1);
  pieces.splice(first - 1, last - first + 2);
  pieces.splice(number, 0, ...moved, { text: rng() < 0.5 ? ", " : " " });
  return pieces;
};

/** Unit types commonly written flush against their identifier. */
const JOINABLE_UNIT_TYPE = /(?:^|\s)(?:#|apt|ap|unit|ste|no|rm)$/i;

/**
 * A `#` joined to its identifier becomes part of the identifier, following usaddress: "#4" is
 * OccupancyIdentifier, and "Floor # 1" becomes OccupancyType "Floor" + OccupancyIdentifier "#1",
 * so span boundaries stay on whitespace. A joined letter type ("Apt4", "Unit139") keeps its
 * type and identifier as two spans inside one whitespace token.
 */
const unitJoined: Transform = (pieces) => {
  let changed = false;
  for (let i = 1; i + 2 < pieces.length; i += 2) {
    const type = pieces[i]!;
    const id = pieces[i + 2]!;
    if (type.label !== "OccupancyType" || id.label !== "OccupancyIdentifier") continue;
    if (!/^\s+$/.test(pieces[i + 1]!.text) || !JOINABLE_UNIT_TYPE.test(type.text)) continue;
    // "AptB" reads as one word; only join a letter type to a numeric identifier.
    if (/\p{L}$/u.test(type.text) && !/^\p{N}/u.test(id.text)) continue;
    const hash = /^(.*?)(\s*)#$/su.exec(type.text);
    if (hash) {
      // An empty type piece ("#" alone) produces no span; see fromPieces.
      pieces[i] = { ...type, text: hash[1]! };
      pieces[i + 1] = { text: hash[2]! };
      pieces[i + 2] = { ...id, text: `#${id.text}` };
    } else pieces[i + 1] = { text: "" };
    changed = true;
  }
  return changed ? pieces : undefined;
};

const drop =
  (label: Label): Transform =>
  (pieces) => {
    const at = labeledIndices(pieces, (l) => l === label);
    if (at.length === 0 || labeledIndices(pieces, () => true).length === at.length)
      return undefined;
    for (const i of at.reverse()) removeAt(pieces, i);
    return pieces;
  };

const zipBeforeState: Transform = (pieces) => {
  const state = labeledIndices(pieces, (l) => l === "StateName")[0];
  if (state === undefined || pieces[state + 2]?.label !== "ZipCode") return undefined;
  [pieces[state], pieces[state + 2]] = [pieces[state + 2]!, pieces[state]!];
  return pieces;
};

const newline: Transform = (pieces) => {
  const firstOf = (label: Label) => labeledIndices(pieces, (l) => l === label)[0];
  const at = firstOf("PlaceName") ?? firstOf("StateName") ?? firstOf("ZipCode");
  if (at === undefined || at < 3 || !/^[\s,]+$/.test(pieces[at - 1]!.text)) return undefined;
  pieces[at - 1] = { text: "\n" };
  return pieces;
};

const ABBREVIATED: ReadonlySet<Label> = new Set([
  "StreetNamePreDirectional",
  "StreetNamePostDirectional",
  "StreetNamePostType",
  "OccupancyType",
]);

/** Short words that are whole words, not abbreviations. */
const SHORT_WORDS: ReadonlySet<string> = new Set([
  ...["way", "lot", "run", "row", "rue", "bay", "key", "end", "gap", "inn", "ice"],
]);

/** "St", "Apt", "N", "Blvd", "Pkwy": up to three letters, or any length without a vowel. */
function isAbbreviation(word: string): boolean {
  if (!/^\p{L}+$/u.test(word)) return false;
  const w = word.toLowerCase();
  return (w.length <= 3 && !SHORT_WORDS.has(w)) || !/[aeiouy]/.test(w);
}

const extraPunct: Transform = (pieces, rng) => {
  const eligible = labeledIndices(pieces, (l) => ABBREVIATED.has(l)).filter((i) =>
    isAbbreviation(pieces[i]!.text),
  );
  if (eligible.length === 0) return undefined;
  // Each abbreviation gets a period with probability 1/2, and at least one does.
  const chosen = eligible.filter(() => rng() < 0.5);
  if (chosen.length === 0) chosen.push(eligible[Math.floor(rng() * eligible.length)]!);
  for (const i of chosen) pieces[i] = { ...pieces[i]!, text: pieces[i]!.text + "." };
  return pieces;
};

const TYPO_LABELS: ReadonlySet<Label> = new Set([
  "StreetName",
  "StreetNamePostType",
  "PlaceName",
  "OccupancyType",
]);

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function keyboardNeighbor(ch: string, rng: Rng): string {
  const lower = ch.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    const k = row.indexOf(lower);
    if (k < 0) continue;
    const options = [row[k - 1], row[k + 1]].filter((c): c is string => c !== undefined);
    const pick = options[Math.floor(rng() * options.length)]!;
    return ch === lower ? pick : pick.toUpperCase();
  }
  throw new Error(`not an ASCII letter: ${ch}`);
}

const typo: Transform = (pieces, rng) => {
  // Whole words of 4+ ASCII letters, as [piece index, word start, word end].
  const words: [number, number, number][] = [];
  for (const i of labeledIndices(pieces, (l) => TYPO_LABELS.has(l))) {
    for (const m of pieces[i]!.text.matchAll(/(?<!\p{L})[A-Za-z]{4,}(?!\p{L})/gu)) {
      words.push([i, m.index, m.index + m[0].length]);
    }
  }
  if (words.length === 0) return undefined;
  const [i, start, end] = words[Math.floor(rng() * words.length)]!;
  const s = pieces[i]!.text;
  const op = Math.floor(rng() * 4);
  // Not the first letter: people rarely get that wrong. A transposition needs a next letter.
  const k = start + 1 + Math.floor(rng() * (end - start - (op === 1 ? 2 : 1)));
  let out: string;
  if (op === 1 && s[k] !== s[k + 1]) out = s.slice(0, k) + s[k + 1] + s[k] + s.slice(k + 2);
  else if (op === 0 || op === 1) out = s.slice(0, k) + s.slice(k + 1);
  else if (op === 2) out = s.slice(0, k) + s[k] + s.slice(k);
  else out = s.slice(0, k) + keyboardNeighbor(s[k]!, rng) + s.slice(k + 1);
  if (out === s) return undefined;
  pieces[i] = { ...pieces[i]!, text: out };
  return pieces;
};

const recase =
  (f: (s: string) => string): Transform =>
  (pieces) => {
    const out = pieces.map((p) => ({ ...p, text: f(p.text) }));
    return out.some((p, i) => p.text !== pieces[i]!.text) ? out : undefined;
  };

const TRANSFORMS: Record<NoiseName, Transform> = {
  "unit-first": unitFirst,
  "unit-joined": unitJoined,
  "drop-zip": drop("ZipCode"),
  "drop-state": drop("StateName"),
  "zip-before-state": zipBeforeState,
  newline,
  "extra-punct": extraPunct,
  typo,
  lowercase: recase((s) => s.toLowerCase()),
  uppercase: recase((s) => s.toUpperCase()),
};

/** Transforms that cancel each other out; only the first one that fires is applied. */
const EXCLUSIVE: readonly (readonly NoiseName[])[] = [["lowercase", "uppercase"]];

/** Applies a single transform regardless of rate, or returns undefined if it doesn't apply. */
export function applyNoise(
  ex: Example,
  name: NoiseName,
  rng: Rng,
): { text: string; spans: Span[] } | undefined {
  const out = TRANSFORMS[name](toPieces(ex.text, ex.spans), rng);
  return out && fromPieces(out);
}

/** The example with noise added; `noise` lists the transforms applied, and is absent if none. */
export function addNoise(
  ex: Example,
  rng: Rng,
  rates: Readonly<Record<NoiseName, number>> = NOISE_RATES,
): Example {
  let pieces = toPieces(ex.text, ex.spans);
  const applied: NoiseName[] = [];
  for (const name of NOISE_NAMES) {
    if (rng() >= rates[name]) continue;
    if (EXCLUSIVE.some((g) => g.includes(name) && g.some((n) => applied.includes(n)))) continue;
    const out = TRANSFORMS[name](
      pieces.map((p) => ({ ...p })),
      rng,
    );
    if (!out) continue;
    pieces = out;
    applied.push(name);
  }
  if (applied.length === 0) return ex;
  return { ...ex, ...fromPieces(pieces), noise: applied };
}

/** Deterministic PRNG (mulberry32) seeded by a hash of `key`. */
export function seededRng(key: string): Rng {
  let a = createHash("sha1").update(key).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
