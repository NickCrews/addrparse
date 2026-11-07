/**
 * Tokenization shared by scoring and by implementations that want it. Implementations may
 * tokenize however they like; scoring only sees the spans they return.
 *
 * Tokens are whitespace-delimited words, further split where real input often leaves out a
 * space between two fields (`breakBefore`): "Apt303", "St,Anchorage", "N.Main", "St/Apt".
 * Gold spans can then begin and end inside a word, and token-level models can still label each
 * part separately.
 */
import type { Label } from "./labels.ts";
import type { Example, Span } from "./types.ts";

export interface Token {
  /** Offsets of the token including leading/trailing separator punctuation (`,` `;`). */
  start: number;
  end: number;
  /** Offsets with leading/trailing separator punctuation removed. */
  coreStart: number;
  coreEnd: number;
}

const COMMA = 44;
const SEMICOLON = 59;
const PERIOD = 46;
const SLASH = 47;
const HYPHEN = 45;
const HASH = 35;

const isSep = (c: number) => c === COMMA || c === SEMICOLON;
const isDigit = (c: number) => c >= 48 && c <= 57;
/** ASCII letters and every non-ASCII character (the caller has already excluded whitespace). */
const isLetter = (c: number) => ((c | 32) >= 97 && (c | 32) <= 122) || c > 127;
const isAlnum = (c: number) => isDigit(c) || isLetter(c);

/**
 * Whether a token boundary falls between `text[k - 1]` and `text[k]`, two non-whitespace
 * characters of one word:
 *
 * - after `,`/`;` ("St,Anchorage"), except between digits ("1,096")
 * - from a letter to a digit ("Apt303", "Box55", "RR2", "AK99501"). Not from a digit to a letter,
 *   so "123B", "4th" and "12A" stay whole.
 * - before `#` after a letter, digit or `.` ("Apt#303", "Apt.#4"); "#303" itself stays whole
 * - after `.` followed by a digit ("Ste.100", "No.1"), except between digits ("14.5"), or by 2+
 *   letters or digits ("N.Main", "St.Apt"), so "P.O.", "N.W." and "St.E" stay whole
 * - around `/` ("St/Apt"), except between digits ("1/2")
 * - around `-` from a letter to a digit ("Unit-4", "I-95"); "45-29" and "Winston-Salem" stay
 *   whole
 */
export function breakBefore(text: string, k: number): boolean {
  const a = text.charCodeAt(k - 1);
  const b = text.charCodeAt(k);
  if (isSep(b)) return false;
  if (isSep(a)) return !(isDigit(text.charCodeAt(k - 2)) && isDigit(b));
  if (isLetter(a) && isDigit(b)) return true;
  if (b === HASH) return isAlnum(a) || a === PERIOD;
  if (a === PERIOD) {
    const before = text.charCodeAt(k - 2);
    if (isDigit(b)) return !isDigit(before);
    return isLetter(b) && isAlnum(text.charCodeAt(k + 1));
  }
  if (b === SLASH) return !(isDigit(a) && isDigit(text.charCodeAt(k + 1)));
  if (a === SLASH) return !(isDigit(text.charCodeAt(k - 2)) && isDigit(b));
  if (b === HYPHEN) return isLetter(a) && isDigit(text.charCodeAt(k + 1));
  if (a === HYPHEN) return isLetter(text.charCodeAt(k - 2)) && isDigit(b);
  return false;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  /** Adds the token, or returns false if it is all separators (it then joins the next one). */
  const push = (start: number, end: number) => {
    let coreStart = start;
    let coreEnd = end;
    while (coreStart < coreEnd && isSep(text.charCodeAt(coreStart))) coreStart++;
    while (coreEnd > coreStart && isSep(text.charCodeAt(coreEnd - 1))) coreEnd--;
    if (coreStart === coreEnd) return false;
    out.push({ start, end, coreStart, coreEnd });
    return true;
  };
  for (const m of text.matchAll(/\S+/g)) {
    const end = m.index + m[0].length;
    let start = m.index;
    for (let k = start + 1; k < end; k++) {
      if (breakBefore(text, k) && push(start, k)) start = k;
    }
    push(start, end);
  }
  return out;
}

/** Label of the span covering a token's first core character, or undefined. */
export function labelAt(spans: readonly Span[], token: Token): Label | undefined {
  for (const s of spans) if (s.start <= token.coreStart && token.coreStart < s.end) return s.label;
  return undefined;
}

/** Tokens of an example with their gold labels (undefined for unlabeled tokens). */
export function labeledTokens(ex: Example): { token: Token; text: string; label?: Label }[] {
  return tokenize(ex.text).map((token) => ({
    token,
    text: ex.text.slice(token.coreStart, token.coreEnd),
    label: labelAt(ex.spans, token),
  }));
}

/**
 * Turns per-token labels into spans. Adjacent tokens with the same label merge unless
 * separator punctuation sits between them ("Anchorage, AK" never merges across the comma).
 */
export function spansFromTokens(
  tokens: readonly Token[],
  labels: readonly (Label | undefined)[],
): Span[] {
  const spans: Span[] = [];
  let prev: Token | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const label = labels[i];
    if (label === undefined) {
      prev = undefined;
      continue;
    }
    const last = spans.at(-1);
    const separated =
      prev === undefined || prev.coreEnd !== prev.end || token.coreStart !== token.start;
    if (last && !separated && last.label === label && last.end === prev!.coreEnd) {
      last.end = token.coreEnd;
    } else {
      spans.push({ start: token.coreStart, end: token.coreEnd, label });
    }
    prev = token;
  }
  return spans;
}
