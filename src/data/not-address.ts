/**
 * Synthetic NotAddress examples, so a parser can learn to abstain:
 *
 * - junk: a whole text that is not an address: placeholders ("N/A", "same as above"), emails,
 *   phone numbers, person names and runs of ordinary words. Every token is NotAddress.
 * - embedded: a real address example wrapped in surrounding text ("Mail to 12 Main St, thanks").
 *   The address keeps its spans, shifted; the surrounding text is NotAddress.
 *
 * NotAddress spans are built with `spansFromTokens`, so they break at `,`/`;` exactly where a
 * token-level model's would. Every choice comes from a PRNG seeded by the seed and the id of the
 * address example that triggered it (its source and raw line number), so output is deterministic
 * for given raw files. Names are random pairs from lists of common US first and last names, emails use
 * example.com/org/net, and phone numbers use the fictional 555-01xx range.
 */
import { createHash } from "node:crypto";
import { spansFromTokens, tokenize } from "../tokens.ts";
import type { Example, Span } from "../types.ts";

export interface NotAddressOptions {
  /**
   * Probability that an address example is followed by a whole-junk example. Repeated junk
   * texts are dropped by the build's dedupe, so fewer end up in the data.
   */
  junkRate: number;
  /** Probability that an address example also appears embedded in surrounding text. */
  embeddedRate: number;
  seed: number;
}

export const NOT_ADDRESS_DEFAULTS: NotAddressOptions = {
  junkRate: 0.02,
  embeddedRate: 0.02,
  seed: 1,
};

type Rng = () => number;

/** mulberry32 seeded from a sha1 of `key`. */
export function rngFor(key: string): Rng {
  let a = createHash("sha1").update(key).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const digits = (rng: Rng, n: number) =>
  Array.from({ length: n }, () => Math.floor(rng() * 10)).join("");

const PLACEHOLDERS = [
  "N/A",
  "NA",
  "n/a",
  "none",
  "unknown",
  "same as above",
  "same",
  "see above",
  "same as mailing",
  "same as home address",
  "TBD",
  "-",
  "--",
  "?",
  "x",
  "xxx",
  "no address",
  "no address given",
  "not provided",
  "declined",
  "refused",
  "none given",
  "null",
  "not applicable",
  "nothing",
  "test",
  "asdf",
  "moved",
  "moved, no forwarding",
  "deceased",
  "returned mail",
  "bad address",
  "address unknown",
  "homeless",
  "on file",
  "see notes",
  "will provide later",
  "ask",
];

const FIRST_NAMES = [
  "James",
  "Mary",
  "Robert",
  "Patricia",
  "John",
  "Jennifer",
  "Michael",
  "Linda",
  "David",
  "Elizabeth",
  "William",
  "Barbara",
  "Richard",
  "Susan",
  "Joseph",
  "Jessica",
  "Thomas",
  "Sarah",
  "Charles",
  "Karen",
  "Daniel",
  "Lisa",
  "Matthew",
  "Nancy",
  "Anthony",
  "Betty",
  "Mark",
  "Sandra",
  "Steven",
  "Ashley",
  "Paul",
  "Emily",
  "Andrew",
  "Michelle",
  "Joshua",
  "Amanda",
  "Kevin",
  "Melissa",
  "Brian",
  "Stephanie",
  "Maria",
  "Jose",
  "Luis",
  "Ana",
  "Wei",
  "Mei",
  "Nguyen",
  "Aisha",
];

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
  "Harris",
  "Sanchez",
  "Clark",
  "Ramirez",
  "Lewis",
  "Robinson",
  "Walker",
  "Young",
  "Allen",
  "King",
  "Wright",
  "Scott",
  "Torres",
  "Nguyen",
  "Hill",
  "Flores",
  "Green",
  "Adams",
  "Nelson",
  "Baker",
  "Hall",
  "Rivera",
  "Campbell",
  "Mitchell",
];

const WORDS = [
  "thanks",
  "please",
  "call",
  "before",
  "after",
  "delivery",
  "leave",
  "package",
  "with",
  "neighbor",
  "back",
  "door",
  "gate",
  "code",
  "blue",
  "house",
  "dog",
  "friendly",
  "ring",
  "bell",
  "weekends",
  "only",
  "evening",
  "morning",
  "no",
  "answer",
  "voicemail",
  "left",
  "message",
  "follow",
  "up",
  "volunteer",
  "donor",
  "event",
  "signup",
  "interested",
  "maybe",
  "later",
  "contact",
  "info",
  "update",
  "needed",
  "duplicate",
  "record",
  "check",
  "spelling",
  "wrong",
  "number",
  "office",
  "hours",
];

const EMAIL_DOMAINS = ["example.com", "example.org", "example.net", "mail.example.com"];
const AREA_CODES = ["907", "206", "212", "312", "415", "503", "602", "713", "808", "919"];

/** Upper-, lower- or as-is case, weighted toward as-is. */
function recase(rng: Rng, s: string): string {
  const r = rng();
  return r < 0.15 ? s.toUpperCase() : r < 0.3 ? s.toLowerCase() : s;
}

function personName(rng: Rng): string {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  const r = rng();
  if (r < 0.2) return `${first} ${String.fromCharCode(65 + Math.floor(rng() * 26))}. ${last}`;
  if (r < 0.3) return `${last}, ${first}`;
  return `${first} ${last}`;
}

function phone(rng: Rng): string {
  const area = pick(rng, AREA_CODES);
  const line = `01${digits(rng, 2)}`;
  return pick(rng, [
    `(${area}) 555-${line}`,
    `${area}-555-${line}`,
    `${area}.555.${line}`,
    `${area}555${line}`,
    `+1 ${area} 555 ${line}`,
    `555-${line}`,
  ]);
}

function email(rng: Rng): string {
  const first = pick(rng, FIRST_NAMES).toLowerCase();
  const last = pick(rng, LAST_NAMES).toLowerCase();
  const local = pick(rng, [
    `${first}.${last}`,
    `${first[0]}${last}`,
    `${first}${last}${digits(rng, 2)}`,
    `${first}_${last}`,
  ]);
  return `${local}@${pick(rng, EMAIL_DOMAINS)}`;
}

function words(rng: Rng): string {
  const n = 1 + Math.floor(rng() * 4);
  const out = Array.from({ length: n }, () => pick(rng, WORDS)).join(" ");
  return rng() < 0.3 ? out[0]!.toUpperCase() + out.slice(1) : out;
}

/**
 * What decides a junk text's split: its lowercased words of two or more letters, sorted, plus
 * the last 10 digits. Variants of one name, phone number or placeholder ("Sandra Baker" /
 * "Baker, Sandra", "212.555.0173" / "212-555-0173") share a key, so they never straddle splits.
 */
export function junkSplitKey(text: string): string {
  const words = (text.toLowerCase().match(/\p{L}{2,}/gu) ?? []).sort();
  const digits = text.replace(/\D/g, "").slice(-10);
  return `${words.join(" ")}|${digits}`;
}

/** A whole-junk text. */
export function junkText(rng: Rng): string {
  const r = rng();
  if (r < 0.2) return recase(rng, pick(rng, PLACEHOLDERS));
  if (r < 0.35) return email(rng);
  if (r < 0.5) return phone(rng);
  if (r < 0.7) return recase(rng, personName(rng));
  if (r < 0.8) return `${personName(rng)}${pick(rng, [", ", " ", " - "])}${phone(rng)}`;
  return words(rng);
}

/** NotAddress spans over `text[from, to)`, offset into the whole text. */
function notAddressSpans(text: string, from: number, to: number): Span[] {
  const tokens = tokenize(text.slice(from, to)).map((t) => ({
    start: t.start + from,
    end: t.end + from,
    coreStart: t.coreStart + from,
    coreEnd: t.coreEnd + from,
  }));
  return spansFromTokens(
    tokens,
    tokens.map(() => "NotAddress"),
  );
}

const PREFIXES: readonly ((rng: Rng) => string)[] = [
  () => "Mail to ",
  () => "Ship to: ",
  () => "Address: ",
  () => "Addr: ",
  () => "Please send to ",
  () => "Send it to ",
  () => "My address is ",
  () => "Deliver to ",
  () => "Mailing address: ",
  () => "Home: ",
  () => "Lives at ",
  () => "New address ",
  (rng) => `${personName(rng)}, `,
  (rng) => `${personName(rng)} `,
];

/**
 * Suffixes start with a space or a separator (`,` `;`), so the address's last token keeps the
 * same core text it has unembedded.
 */
const SUFFIXES: readonly ((rng: Rng) => string)[] = [
  () => ", thanks",
  () => ", thank you!",
  () => " - leave at back door",
  (rng) => ` (gate code ${digits(rng, 4)})`,
  () => " (old address)",
  () => "; ring bell",
  (rng) => `, call ${phone(rng)} on arrival`,
  (rng) => ` Phone: ${phone(rng)}`,
  (rng) => ` ${email(rng)}`,
  (rng) => ` ${phone(rng)}`,
];

/** `ex` wrapped in a prefix, a suffix or both. */
export function embed(ex: Example, rng: Rng): Example {
  const r = rng();
  let prefix = r < 0.75 ? pick(rng, PREFIXES)(rng) : "";
  let suffix = r >= 0.45 ? pick(rng, SUFFIXES)(rng) : "";
  if (/\p{L}/u.test(ex.text) && ex.text === ex.text.toUpperCase()) {
    prefix = prefix.toUpperCase();
    suffix = suffix.toUpperCase();
  }
  const text = prefix + ex.text + suffix;
  const end = prefix.length + ex.text.length;
  const spans = [
    ...notAddressSpans(text, 0, prefix.length),
    ...ex.spans.map((s) => ({ ...s, start: s.start + prefix.length, end: s.end + prefix.length })),
    ...notAddressSpans(text, end, text.length),
  ];
  return { id: `embedded:${ex.id}`, text, spans, source: "embedded" };
}

/**
 * The NotAddress examples to mix in after address example `ex`: possibly one whole-junk
 * example and possibly `ex` embedded in surrounding text. Examples with fewer than two spans
 * (a bare ZIP or city is ambiguous next to a phone number) or that already contain NotAddress
 * (libpostal's "cafes near me" queries) are never embedded.
 */
export function notAddressExamples(ex: Example, opts: NotAddressOptions): Example[] {
  const rng = rngFor(`${opts.seed}:${ex.id}`);
  const out: Example[] = [];
  if (rng() < opts.junkRate) {
    const text = junkText(rng);
    out.push({
      id: `junk:${ex.id}`,
      text,
      spans: notAddressSpans(text, 0, text.length),
      source: "junk",
    });
  }
  const embeddable = ex.spans.length >= 2 && ex.spans.every((s) => s.label !== "NotAddress");
  if (rng() < opts.embeddedRate && embeddable) {
    out.push(embed(ex, rng));
  }
  return out;
}
