/**
 * Hand-labeled datasets (`datasets/<name>.jsonl`) and the label checks every added dataset goes
 * through. One JSON object per line:
 *
 *   {"text": "PO Box 12, Kenai, AK 99611", "spans": [["PO Box", "USPSBoxType"], ["12", "USPSBoxID"],
 *     ["Kenai", "PlaceName"], ["AK", "StateName"], ["99611", "ZipCode"]]}
 *
 * `spans` lists `[text, label]` pairs in order, as in overrides/gold.jsonl: each is found in
 * `text` after the previous one, at word boundaries. `{"start", "end", "label"}` objects work too.
 * Text in no span is unlabeled. `id` is optional and defaults to `<dataset>:<line number>`.
 */
import { isLabel } from "../labels.ts";
import type { Example, Span } from "../types.ts";
import { fromParts, type Part } from "./datasets.ts";
import { resolveSpans } from "./gold.ts";

/** Throws unless the spans are sorted, disjoint, non-empty, trimmed and use known labels. */
export function checkSpans(text: string, spans: readonly Span[]): void {
  let end = 0;
  for (const s of spans) {
    const what = `span ${JSON.stringify(text.slice(s.start, s.end))} (${s.label})`;
    if (!isLabel(s.label)) throw new Error(`${what}: unknown label`);
    if (!(Number.isInteger(s.start) && Number.isInteger(s.end) && s.start < s.end)) {
      throw new Error(`${what}: bad range [${s.start}, ${s.end})`);
    }
    if (s.start < end) throw new Error(`${what}: overlaps or precedes the span before it`);
    if (s.end > text.length) throw new Error(`${what}: ends past the text`);
    if (/^\s|\s$/.test(text.slice(s.start, s.end))) {
      throw new Error(`${what}: starts or ends with whitespace`);
    }
    end = s.end;
  }
}

/** Parts as text and spans, checked. */
export function checked(parts: readonly Part[]): { text: string; spans: Span[] } {
  const out = fromParts(parts);
  if (!out.text.trim()) throw new Error("empty text");
  checkSpans(out.text, out.spans);
  return out;
}

interface LabeledLine {
  id?: string;
  text: string;
  spans: ([string, string] | Span)[];
}

/** Examples of a `datasets/<name>.jsonl` file; throws on the first bad line, naming it. */
export function parseLabeled(src: string, dataset: string, file = `${dataset}.jsonl`): Example[] {
  const out: Example[] = [];
  src.split("\n").forEach((raw, n) => {
    if (!raw.trim()) return;
    const where = `${file}:${n + 1}`;
    try {
      const o = JSON.parse(raw) as LabeledLine;
      if (typeof o.text !== "string" || !Array.isArray(o.spans)) {
        throw new Error(`expected {"text": string, "spans": [...]}`);
      }
      const pairs = o.spans.filter(Array.isArray) as [string, string][];
      let spans: Span[];
      if (pairs.length === o.spans.length) {
        for (const [piece, label] of pairs) {
          if (!isLabel(label)) throw new Error(`${JSON.stringify(piece)}: unknown label ${label}`);
        }
        spans = resolveSpans(o.text, pairs as [string, never][]);
      } else if (pairs.length === 0) {
        spans = o.spans as Span[];
      } else {
        throw new Error("spans mix [text, label] pairs and {start, end, label} objects");
      }
      checkSpans(o.text, spans);
      out.push({ id: o.id ?? `${dataset}:${n + 1}`, text: o.text, spans, source: dataset });
    } catch (e) {
      throw new Error(`${where}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return out;
}
