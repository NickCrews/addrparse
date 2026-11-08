/**
 * Reference: usaddress (https://github.com/datamade/usaddress), a CRF trained on hand-labeled
 * US addresses, run in Python via `uv` (versions pinned in predict.py and predict.py.lock).
 *
 * Our label set follows usaddress's, so most labels map to themselves. The rest:
 *
 * | usaddress                                   | here                                       |
 * | ------------------------------------------- | ------------------------------------------ |
 * | SubaddressType, SubaddressIdentifier        | OccupancyType, OccupancyIdentifier         |
 * | "#" tagged an identifier (Occupancy, Subaddress, USPSBox) | the matching type, as our gold labels "#" |
 * | BuildingName, LandmarkName                  | LandmarkName                               |
 * | CornerOf, IntersectionSeparator             | no label                                   |
 *
 * Tokens come back as strings ("Washington,"); spansFromPieces finds them in the text.
 */
import { isLabel, type Label } from "../../src/labels.ts";
import { predictWithUv, spansFromPieces } from "../../src/eval/reference.ts";
import type { ReferenceImpl } from "../../src/types.ts";

const MAP: Record<string, Label | undefined> = {
  SubaddressType: "OccupancyType",
  SubaddressIdentifier: "OccupancyIdentifier",
  BuildingName: "LandmarkName",
  CornerOf: undefined,
  IntersectionSeparator: undefined,
};

function mapLabel(label: string, token: string): Label | undefined {
  const mapped = Object.hasOwn(MAP, label) ? MAP[label] : isLabel(label) ? label : undefined;
  if (token === "#" && mapped === "OccupancyIdentifier") return "OccupancyType";
  if (token === "#" && mapped === "USPSBoxID") return "USPSBoxType";
  return mapped;
}

/** Spans of one usaddress.parse result. */
export function toSpans(text: string, tokens: readonly [string, string][]) {
  return spansFromPieces(text, tokens, mapLabel);
}

const impl: ReferenceImpl = {
  predict: (texts, ctx) => predictWithUv("usaddress", import.meta.dirname, texts, ctx, toSpans),
};
export default impl;
