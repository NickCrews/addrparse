/**
 * Whitespace tokenization shared by scoring and by implementations that want it.
 * Implementations may tokenize however they like; scoring only sees the spans they return.
 */
import type { Label } from "./labels.ts";
import type { Example, Span } from "./types.ts";

export interface Token {
  /** Offsets of the whole whitespace-delimited token. */
  start: number;
  end: number;
  /** Offsets with leading/trailing separator punctuation (`,` `;`) removed. */
  coreStart: number;
  coreEnd: number;
}

const EDGE_PUNCT = /[,;]/;

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const start = m.index;
    const end = start + m[0].length;
    let coreStart = start;
    let coreEnd = end;
    while (coreStart < coreEnd && EDGE_PUNCT.test(text[coreStart]!)) coreStart++;
    while (coreEnd > coreStart && EDGE_PUNCT.test(text[coreEnd - 1]!)) coreEnd--;
    if (coreStart === coreEnd) continue;
    out.push({ start, end, coreStart, coreEnd });
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
