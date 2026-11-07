/** Builders for test examples and spans. Not a test file itself (no `.test.ts`). */
import assert from "node:assert/strict";
import type { Label } from "../src/labels.ts";
import type { Example, Span } from "../src/types.ts";

/** Spans from `[substring, label]` pairs, each found in `text` after the previous one. */
export function locate(text: string, parts: [string, Label][]): Span[] {
  let from = 0;
  return parts.map(([s, label]) => {
    const start = text.indexOf(s, from);
    assert.ok(start >= 0, `${s} not in ${text}`);
    from = start + s.length;
    return { start, end: from, label };
  });
}

/** An example whose spans are `parts` located in `text`. */
export function example(text: string, parts: [string, Label][], source = "test"): Example {
  return { id: text, text, spans: locate(text, parts), source };
}

/** Each span's `[text, label]`, for readable assertions. */
export const pairs = (text: string, spans: readonly Span[]) =>
  spans.map((s) => [text.slice(s.start, s.end), s.label]);
