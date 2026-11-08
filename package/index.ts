/**
 * Entry point of the `nerdress` npm package: the CRF parser in impls/crf with a trained model
 * that package/build.ts embeds as base64 in place of `__NERDRESS_MODEL__`. The model is decoded
 * on the first `parse` call, so importing the package is cheap.
 *
 * The public types are declared here, not imported, so the emitted index.d.ts stands alone.
 */
import { load } from "../impls/crf/load.ts";
import { LABELS as LABEL_DESCRIPTIONS, type Label as InternalLabel } from "../src/labels.ts";
import { asScoredParse, type Parser } from "../src/types.ts";

declare const __NERDRESS_MODEL__: string;

/** Names follow usaddress and the FGDC US address standard; `LABELS` describes each one. */
export type Label =
  | "AddressNumberPrefix"
  | "AddressNumber"
  | "AddressNumberSuffix"
  | "StreetNamePreModifier"
  | "StreetNamePreDirectional"
  | "StreetNamePreType"
  | "StreetName"
  | "StreetNamePostType"
  | "StreetNamePostDirectional"
  | "OccupancyType"
  | "OccupancyIdentifier"
  | "USPSBoxGroupType"
  | "USPSBoxGroupID"
  | "USPSBoxType"
  | "USPSBoxID"
  | "PlaceName"
  | "StateName"
  | "ZipCode"
  | "CountryName"
  | "NotAddress";

// Fails to typecheck when `Label` and src/labels.ts disagree.
const labelsMatch: [Label] extends [InternalLabel]
  ? [InternalLabel] extends [Label]
    ? true
    : never
  : never = true;
void labelsMatch;

/** A labeled character range `[start, end)` of the input; `text` is `input.slice(start, end)`. */
export interface Span {
  start: number;
  end: number;
  label: Label;
  text: string;
}

export interface ParseResult {
  /** Sorted by `start`, never overlapping. Text that is not part of an address is `NotAddress`. */
  spans: Span[];
  /** The model's probability, in [0, 1], that every span is exactly right. */
  confidence: number;
}

/** A one-line description of each label, with examples. */
export const LABELS: Readonly<Record<Label, string>> = LABEL_DESCRIPTIONS;

let parser: Parser | undefined;

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Splits a US address, or text containing one, into labeled spans. */
export function parse(text: string): ParseResult {
  if (typeof text !== "string") throw new TypeError("parse() takes a string");
  parser ??= load(fromBase64(__NERDRESS_MODEL__));
  const result = asScoredParse(parser.parse(text));
  return {
    spans: result.spans.map((s) => ({ ...s, text: text.slice(s.start, s.end) })),
    confidence: result.confidence ?? 1,
  };
}
