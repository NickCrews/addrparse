/**
 * Reference: usaddress (https://github.com/datamade/usaddress), a CRF trained on hand-labeled
 * US addresses, run in Python via `uv` (versions pinned in predict.py and predict.py.lock).
 *
 * Our label set follows usaddress's, so most labels map to themselves. The rest:
 *
 * | usaddress                                   | here                                       |
 * | ------------------------------------------- | ------------------------------------------ |
 * | AddressNumberPrefix                         | AddressNumber                              |
 * | SubaddressType, SubaddressIdentifier        | OccupancyType, OccupancyIdentifier         |
 * | USPSBoxGroupType, USPSBoxGroupID            | USPSBoxType, USPSBoxID ("RR 2" of "RR 2 Box 5") |
 * | "#" tagged an identifier (Occupancy, Subaddress, USPSBox) | the matching type, as our gold labels "#" |
 * | BuildingName, LandmarkName, CornerOf,       | no label                                   |
 * | IntersectionSeparator, Recipient            |                                            |
 *
 * Tokens come back as strings ("Washington,"); spansFromPieces finds them in the text.
 */
import { isLabel, type Label } from "../../src/labels.ts";
import { join } from "node:path";
import {
  collectPredictions,
  lockedVersions,
  runJsonLines,
  spansFromPieces,
} from "../../src/eval/reference.ts";
import type { ReferenceImpl } from "../../src/types.ts";

const MAP: Record<string, Label | undefined> = {
  AddressNumberPrefix: "AddressNumber",
  SubaddressType: "OccupancyType",
  SubaddressIdentifier: "OccupancyIdentifier",
  USPSBoxGroupType: "USPSBoxType",
  USPSBoxGroupID: "USPSBoxID",
  BuildingName: undefined,
  LandmarkName: undefined,
  CornerOf: undefined,
  IntersectionSeparator: undefined,
  Recipient: undefined,
};

export function mapLabel(label: string, token: string): Label | undefined {
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
  async predict(texts, ctx) {
    ctx.log(`  usaddress: parsing ${texts.length.toLocaleString("en-US")} texts in Python`);
    const out = await runJsonLines(
      "uv",
      ["run", "--quiet", "--locked", "--script", "predict.py"],
      texts,
      {
        cwd: import.meta.dirname,
      },
    );
    const { unaligned, ...prediction } = collectPredictions(texts, out, toSpans);
    const versions = lockedVersions(join(import.meta.dirname, "predict.py.lock"));
    return { ...prediction, info: { ...versions, unaligned } };
  },
};
export default impl;
