/**
 * Tokenization and feature extraction shared by training and inference.
 *
 * Features are 32-bit hashes built from character codes, so extracting them allocates no
 * strings. Each feature is `mix(template, value)`, where `value` is a hash of a token property
 * (lowercased word, shape, prefix, ...). Training and inference call the same `extract`.
 */
import { STREET_SUFFIXES } from "../../src/data/street-suffixes.ts";
import {
  ABBREVIATED_DIRECTIONALS,
  DIRECTIONALS,
  OCCUPANCY_TYPES,
  STATE_CODES,
} from "../../src/data/refine.ts";
import { FeatureTable } from "./table.ts";

// ---------------------------------------------------------------------------------------------
// Hashing

const FNV_OFFSET = 0x811c9dc5;
const fnv = (h: number, c: number) => Math.imul(h ^ c, 0x01000193);

/**
 * murmur3 finalizer over a template id and a value hash, as an int32 (V8 keeps int32s unboxed).
 * Never returns 0, the empty slot of a FeatureTable.
 */
export function mix(template: number, value: number): number {
  let h = (value ^ Math.imul(template + 1, 0x9e3779b1)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0 || 1;
}

function lowerCode(c: number): number {
  if (c < 128) return c >= 65 && c <= 90 ? c + 32 : c;
  return String.fromCharCode(c).toLowerCase().charCodeAt(0);
}

/** Hash of a lowercase string with '.' removed: the lexicon key `extract` computes per token. */
function lexKey(s: string): number {
  let h = FNV_OFFSET;
  for (let k = 0; k < s.length; k++) {
    const c = lowerCode(s.charCodeAt(k));
    if (c !== 46) h = fnv(h, c);
  }
  return h | 0;
}

// ---------------------------------------------------------------------------------------------
// Lexicons

const LEX_DIRECTIONAL = 1;
const LEX_ABBREV_DIRECTIONAL = 2;
const LEX_SUFFIX = 4;
/** A 2+ letter prefix of a 4+ letter suffix ("ro", "stre"): libpostal truncates suffixes. */
const LEX_TRUNCATED_SUFFIX = 8;
const LEX_OCCUPANCY = 16;
const LEX_STATE_CODE = 32;
const LEX_STATE_WORD = 64;
const LEX_PRE_TYPE = 128;
const LEX_PO_BOX = 256;
const LEX_COUNTRY = 512;
const LEX_BITS = 10;

const STATE_WORDS = [
  ...["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut"],
  ...["delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa"],
  ...["kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan"],
  ...["minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "hampshire"],
  ...["jersey", "mexico", "york", "carolina", "dakota", "ohio", "oklahoma", "oregon"],
  ...["pennsylvania", "rhode", "island", "tennessee", "texas", "utah", "vermont", "virginia"],
  ...["washington", "wisconsin", "wyoming", "district", "columbia", "puerto", "rico", "guam"],
];
const PRE_TYPE_WORDS = [
  ...["highway", "hwy", "hywy", "route", "rte", "rt", "interstate", "ih", "fm", "rm", "cr"],
  ...["sr", "sh", "cth", "sth", "ush", "county", "co", "cty", "state", "us", "road", "rd"],
];
const PO_BOX_WORDS = ["po", "p", "o", "box", "pob", "pobox", "post", "office", "bx", "drawer"];
const COUNTRY_WORDS = ["us", "usa", "united", "states", "america", "of"];

/** Lexicon bits by `lexKey`. */
const LEXICON: FeatureTable = (() => {
  const m = new FeatureTable(4096);
  const add = (words: Iterable<string>, bit: number) => {
    for (const w of words) {
      const s = m.slot(lexKey(w) || 1, 0);
      m.values[s]! |= bit;
    }
  };
  add(DIRECTIONALS, LEX_DIRECTIONAL);
  add(ABBREVIATED_DIRECTIONALS, LEX_ABBREV_DIRECTIONAL);
  add(STREET_SUFFIXES, LEX_SUFFIX);
  const truncated = new Set<string>();
  for (const s of STREET_SUFFIXES) {
    if (s.length < 4) continue;
    for (let k = 2; k < s.length; k++) {
      const p = s.slice(0, k);
      if (!STREET_SUFFIXES.has(p)) truncated.add(p);
    }
  }
  add(truncated, LEX_TRUNCATED_SUFFIX);
  add(OCCUPANCY_TYPES, LEX_OCCUPANCY);
  add(STATE_CODES, LEX_STATE_CODE);
  add(STATE_WORDS, LEX_STATE_WORD);
  add(PRE_TYPE_WORDS, LEX_PRE_TYPE);
  add(PO_BOX_WORDS, LEX_PO_BOX);
  add(COUNTRY_WORDS, LEX_COUNTRY);
  return m;
})();

// ---------------------------------------------------------------------------------------------
// Tokenization

/** Same whitespace set as the regex `\s`. */
function isSpace(c: number): boolean {
  if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
  if (c < 160) return false;
  return (
    c === 160 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

const isEdgePunct = (c: number) => c === 44 || c === 59;

/**
 * Whitespace tokens of a text, as typed arrays. Matches `tokenize` in src/tokens.ts: tokens are
 * `\S+` runs, the core excludes edge `,`/`;`, and tokens that are all edge punctuation are skipped.
 */
export class Tokens {
  n = 0;
  start = new Int32Array(64);
  end = new Int32Array(64);
  coreStart = new Int32Array(64);
  coreEnd = new Int32Array(64);

  tokenize(text: string): void {
    let n = 0;
    const len = text.length;
    let i = 0;
    while (i < len) {
      while (i < len && isSpace(text.charCodeAt(i))) i++;
      if (i >= len) break;
      const s = i;
      while (i < len && !isSpace(text.charCodeAt(i))) i++;
      let cs = s;
      let ce = i;
      while (cs < ce && isEdgePunct(text.charCodeAt(cs))) cs++;
      while (ce > cs && isEdgePunct(text.charCodeAt(ce - 1))) ce--;
      if (cs === ce) continue;
      if (n === this.start.length) this.grow();
      this.start[n] = s;
      this.end[n] = i;
      this.coreStart[n] = cs;
      this.coreEnd[n] = ce;
      n++;
    }
    this.n = n;
  }

  private grow(): void {
    const g = (a: Int32Array) => {
      const b = new Int32Array(a.length * 2);
      b.set(a);
      return b;
    };
    this.start = g(this.start);
    this.end = g(this.end);
    this.coreStart = g(this.coreStart);
    this.coreEnd = g(this.coreEnd);
  }
}

// ---------------------------------------------------------------------------------------------
// Feature extraction

// Template ids. Neighbour templates add `NEIGHBOUR_STRIDE * slot` for slots -2, -1, +1, +2.
const T_WORD = 1;
const T_NORM = 2;
const T_SHAPE = 3;
const T_CSHAPE = 4;
const T_PREFIX2 = 5;
const T_PREFIX3 = 6;
const T_SUFFIX2 = 7;
const T_SUFFIX3 = 8;
const T_LEN = 9;
const T_LEX = 10;
const T_LEX_BIT = 11;
/** Separators around the token and its distance from either end of the text. */
const T_EDGES = 12;
/** Index of the comma-separated field from either end, and the token's place in it. */
const T_FIELD = 13;
/** Token and field counts. */
const T_SIZE = 14;
const T_BIGRAM_PREV = 20;
const T_BIGRAM_NEXT = 21;
/** Lexicon class and shape of the previous, current and next token together. */
const T_CLASS_TRIGRAM = 22;
const T_NB_WORD = 30;
const T_NB_CSHAPE = 31;
const T_NB_LEX = 32;
const T_NB_BOUNDARY = 33;
const NEIGHBOUR_STRIDE = 10;
const NEIGHBOURS = [-2, -1, 1, 2];

const CLS_DIGIT = 100;
const CLS_UPPER = 101;
const CLS_LOWER = 102;

/** Per-token properties and the extracted features, reused across calls. */
export class Features {
  readonly tokens = new Tokens();
  /** Features of token i are `feats[offs[i]] .. feats[offs[i + 1]]`. */
  feats = new Int32Array(1024);
  offs = new Int32Array(65);

  private word = new Int32Array(64);
  private normH = new Int32Array(64);
  private hasPeriod = new Uint8Array(64);
  private shape = new Int32Array(64);
  private cshape = new Int32Array(64);
  private prefix2 = new Int32Array(64);
  private prefix3 = new Int32Array(64);
  private suffix2 = new Int32Array(64);
  private suffix3 = new Int32Array(64);
  private len = new Uint8Array(64);
  private lex = new Int32Array(64);
  private sepAfter = new Uint8Array(64);
  private field = new Uint8Array(64);
  private fieldStart = new Int32Array(64);
  private fieldEnd = new Int32Array(64);

  /** Tokenizes `text` and fills `feats`/`offs`. Returns the token count. */
  extract(text: string): number {
    const t = this.tokens;
    t.tokenize(text);
    const n = t.n;
    if (this.word.length < n) this.growTokens(n);
    if (this.offs.length < n + 1) this.offs = new Int32Array(2 * n + 1);
    if (this.feats.length < n * 64) this.feats = new Int32Array(n * 128);

    // Per-token properties.
    let field = 0;
    for (let i = 0; i < n; i++) {
      const s = t.coreStart[i]!;
      const e = t.coreEnd[i]!;
      let w = FNV_OFFSET;
      let nh = FNV_OFFSET;
      let sh = FNV_OFFSET;
      let csh = FNV_OFFSET;
      let p2 = 0;
      let p3 = 0;
      let prevCls = -1;
      let period = 0;
      for (let k = s; k < e; k++) {
        const c = text.charCodeAt(k);
        const lc = lowerCode(c);
        w = fnv(w, lc);
        if (c === 46) period = 1;
        else nh = fnv(nh, lc);
        const cls =
          c >= 48 && c <= 57
            ? CLS_DIGIT
            : lc !== c
              ? CLS_UPPER
              : lc >= 97 && lc <= 122
                ? CLS_LOWER
                : c > 127
                  ? CLS_LOWER
                  : c;
        if (k - s < 8) sh = fnv(sh, cls);
        if (cls !== prevCls) csh = fnv(csh, cls);
        prevCls = cls;
        if (k - s === 1) p2 = w;
        if (k - s === 2) p3 = w;
      }
      let s2 = FNV_OFFSET;
      let s3 = FNV_OFFSET;
      for (let k = Math.max(s, e - 3); k < e; k++) {
        const lc = lowerCode(text.charCodeAt(k));
        s3 = fnv(s3, lc);
        if (k >= e - 2) s2 = fnv(s2, lc);
      }
      this.word[i] = w | 0;
      this.normH[i] = nh | 0;
      this.hasPeriod[i] = period;
      this.shape[i] = sh | 0;
      this.cshape[i] = csh | 0;
      this.prefix2[i] = p2 | 0;
      this.prefix3[i] = p3 | 0;
      this.suffix2[i] = e - s >= 3 ? s2 | 0 : 0;
      this.suffix3[i] = e - s >= 4 ? s3 | 0 : 0;
      this.len[i] = Math.min(e - s, 12);
      this.lex[i] = Math.max(0, LEXICON.get(nh | 0 || 1));
      const sep = t.coreEnd[i] !== t.end[i] ? 1 : 0;
      this.sepAfter[i] = sep;
      this.field[i] = field;
      if (sep) field++;
    }
    const nFields = n > 0 ? this.field[n - 1]! + 1 : 0;
    for (let i = 0; i < n; i++) {
      this.fieldStart[i] =
        i > 0 && this.field[i - 1] === this.field[i] ? this.fieldStart[i - 1]! : i;
    }
    for (let i = n - 1; i >= 0; i--) {
      this.fieldEnd[i] =
        i < n - 1 && this.field[i + 1] === this.field[i] ? this.fieldEnd[i + 1]! : i;
    }

    // Features.
    const f = this.feats;
    let p = 0;
    for (let i = 0; i < n; i++) {
      this.offs[i] = p;
      const lex = this.lex[i]!;
      f[p++] = mix(T_WORD, this.word[i]!);
      if (this.hasPeriod[i]) f[p++] = mix(T_NORM, this.normH[i]!);
      f[p++] = mix(T_SHAPE, this.shape[i]!);
      f[p++] = mix(T_CSHAPE, this.cshape[i]!);
      if (this.prefix2[i]) f[p++] = mix(T_PREFIX2, this.prefix2[i]!);
      if (this.prefix3[i]) f[p++] = mix(T_PREFIX3, this.prefix3[i]!);
      if (this.suffix2[i]) f[p++] = mix(T_SUFFIX2, this.suffix2[i]!);
      if (this.suffix3[i]) f[p++] = mix(T_SUFFIX3, this.suffix3[i]!);
      f[p++] = mix(T_LEN, this.len[i]!);
      f[p++] = mix(T_LEX, lex);
      for (let b = 0; b < LEX_BITS; b++) if (lex & (1 << b)) f[p++] = mix(T_LEX_BIT, b);
      const sepBefore = i > 0 ? this.sepAfter[i - 1]! : 2;
      const fieldPos = this.field[i]!;
      f[p++] = mix(
        T_EDGES,
        sepBefore |
          (this.sepAfter[i]! << 2) |
          (Math.min(i, 3) << 4) |
          (Math.min(n - 1 - i, 3) << 6),
      );
      f[p++] = mix(
        T_FIELD,
        Math.min(fieldPos, 4) |
          (Math.min(nFields - 1 - fieldPos, 4) << 4) |
          (Math.min(i - this.fieldStart[i]!, 3) << 8) |
          (Math.min(this.fieldEnd[i]! - i, 3) << 12),
      );
      f[p++] = mix(T_SIZE, Math.min(n, 12) | (Math.min(nFields, 6) << 4));
      f[p++] = mix(T_BIGRAM_PREV, i > 0 ? mix(this.word[i - 1]!, this.word[i]!) : this.word[i]!);
      f[p++] = mix(
        T_BIGRAM_NEXT,
        i < n - 1 ? mix(this.word[i]!, this.word[i + 1]!) : this.word[i]!,
      );
      f[p++] = mix(
        T_CLASS_TRIGRAM,
        mix(mix(i > 0 ? this.cls(i - 1) : 1, this.cls(i)), i < n - 1 ? this.cls(i + 1) : 1),
      );
      for (let d = 0; d < NEIGHBOURS.length; d++) {
        const j = i + NEIGHBOURS[d]!;
        const base = NEIGHBOUR_STRIDE * (d + 1);
        if (j < 0 || j >= n) {
          f[p++] = mix(T_NB_BOUNDARY + base, 1);
          continue;
        }
        f[p++] = mix(T_NB_WORD + base, this.word[j]!);
        f[p++] = mix(T_NB_CSHAPE + base, this.cshape[j]!);
        f[p++] = mix(T_NB_LEX + base, this.lex[j]! | (this.sepAfter[j]! << LEX_BITS));
      }
    }
    this.offs[n] = p;
    return n;
  }

  /** Lexicon bits, separator and collapsed shape of token i as one hash. */
  private cls(i: number): number {
    return mix(this.lex[i]! | (this.sepAfter[i]! << LEX_BITS), this.cshape[i]!);
  }

  private growTokens(n: number): void {
    const m = 2 * n;
    this.word = new Int32Array(m);
    this.normH = new Int32Array(m);
    this.hasPeriod = new Uint8Array(m);
    this.shape = new Int32Array(m);
    this.cshape = new Int32Array(m);
    this.prefix2 = new Int32Array(m);
    this.prefix3 = new Int32Array(m);
    this.suffix2 = new Int32Array(m);
    this.suffix3 = new Int32Array(m);
    this.len = new Uint8Array(m);
    this.lex = new Int32Array(m);
    this.sepAfter = new Uint8Array(m);
    this.field = new Uint8Array(m);
    this.fieldStart = new Int32Array(m);
    this.fieldEnd = new Int32Array(m);
  }
}
