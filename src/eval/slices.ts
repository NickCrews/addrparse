/**
 * Subsets of the eval set that accuracy is also reported on. Add a slice by appending here;
 * every run reports every slice, so slices also show where a change helped or hurt.
 */
import { listDatasets } from "../data/datasets.ts";
import { NOISE_NAMES } from "../data/noise.ts";
import type { Example } from "../types.ts";

export interface Slice {
  name: string;
  test(ex: Example): boolean;
}

const has = (label: string) => (ex: Example) => ex.spans.some((s) => s.label === label);
/** Every gold span is NotAddress: a parser should abstain on the whole text. */
export const isJunkOnly = (ex: Example) =>
  ex.spans.length > 0 && ex.spans.every((s) => s.label === "NotAddress");
const tokenCount = (ex: Example) => ex.text.split(/\s+/).filter(Boolean).length;
/**
 * True when the gold labels rest on a heuristic or flagged noise (`Example.notes`). Notes that a
 * field was dropped, or that the labels were checked by hand, don't count.
 */
const heuristicGold = (ex: Example) =>
  (ex.notes ?? []).some((n) => !n.startsWith("dropped:") && n !== "override");

export const SLICES: readonly Slice[] = [
  // One per dataset; junk and embedded have the junk-only and embedded slices below.
  ...listDatasets()
    .filter((d) => d.kind !== "not-address")
    .map((d) => ({ name: `source=${d.name}`, test: (ex: Example) => ex.source === d.name })),
  { name: "street-address", test: has("AddressNumber") },
  { name: "no-street", test: (ex) => !has("StreetName")(ex) && !has("USPSBoxID")(ex) },
  { name: "unit", test: has("OccupancyIdentifier") },
  { name: "po-box", test: has("USPSBoxID") },
  { name: "box-route", test: has("USPSBoxGroupType") },
  { name: "general-delivery", test: (ex) => has("USPSBoxType")(ex) && !has("USPSBoxID")(ex) },
  { name: "milepost", test: has("AddressNumberPrefix") },
  { name: "pre-type", test: has("StreetNamePreType") },
  { name: "post-directional", test: has("StreetNamePostDirectional") },
  { name: "not-address", test: has("NotAddress") },
  { name: "junk-only", test: isJunkOnly },
  { name: "embedded", test: (ex) => ex.source === "embedded" },
  { name: "no-commas", test: (ex) => !ex.text.includes(",") },
  { name: "all-caps", test: (ex) => /\p{L}/u.test(ex.text) && ex.text === ex.text.toUpperCase() },
  { name: "tokens<=3", test: (ex) => tokenCount(ex) <= 3 },
  { name: "tokens>=10", test: (ex) => tokenCount(ex) >= 10 },
  { name: "gold=clean", test: (ex) => !heuristicGold(ex) },
  { name: "gold=heuristic", test: heuristicGold },
  { name: "noise=none", test: (ex) => !ex.noise?.length },
  ...NOISE_NAMES.map((n) => ({
    name: `noise=${n}`,
    test: (ex: Example) => !!ex.noise?.includes(n),
  })),
];
