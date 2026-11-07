/**
 * Subsets of the eval set that accuracy is also reported on. Add a slice by appending here;
 * every run reports every slice, so slices also show where a change helped or hurt.
 */
import type { Example } from "../types.ts";

export interface Slice {
  name: string;
  test(ex: Example): boolean;
}

const has = (label: string) => (ex: Example) => ex.spans.some((s) => s.label === label);
const tokenCount = (ex: Example) => ex.text.split(/\s+/).filter(Boolean).length;

export const SLICES: readonly Slice[] = [
  { name: "source=openaddresses", test: (ex) => ex.source === "openaddresses" },
  { name: "source=osm", test: (ex) => ex.source === "osm" },
  { name: "street-address", test: has("AddressNumber") },
  { name: "no-street", test: (ex) => !has("StreetName")(ex) && !has("USPSBoxID")(ex) },
  { name: "unit", test: has("OccupancyIdentifier") },
  { name: "po-box", test: has("USPSBoxID") },
  { name: "pre-type", test: has("StreetNamePreType") },
  { name: "post-directional", test: has("StreetNamePostDirectional") },
  { name: "not-address", test: has("NotAddress") },
  { name: "no-commas", test: (ex) => !ex.text.includes(",") },
  { name: "all-caps", test: (ex) => /\p{L}/u.test(ex.text) && ex.text === ex.text.toUpperCase() },
  { name: "tokens<=3", test: (ex) => tokenCount(ex) <= 3 },
  { name: "tokens>=10", test: (ex) => tokenCount(ex) >= 10 },
];
