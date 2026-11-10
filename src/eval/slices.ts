/**
 * Subsets of the eval set that accuracy is also reported on: one `<dimension>=<value>` slice per
 * value of each dimension (`dimensions.ts`), then a few that cut across them. Every run reports
 * every slice, so slices also show where a change helped or hurt.
 */
import type { Example } from "../types.ts";
import { DIMENSIONS, isJunkOnly } from "./dimensions.ts";

export { isJunkOnly };

export interface Slice {
  name: string;
  test(ex: Example): boolean;
}

const has = (label: string) => (ex: Example) => ex.spans.some((s) => s.label === label);
const tokenCount = (ex: Example) => ex.text.split(/\s+/).filter(Boolean).length;

export const sliceName = (dimension: string, value: string) => `${dimension}=${value}`;

export const SLICES: readonly Slice[] = [
  ...DIMENSIONS.flatMap((d) =>
    d.values.map((v) => ({
      name: sliceName(d.name, v),
      test: (ex: Example) => d.of(ex).includes(v),
    })),
  ),
  { name: "unit", test: has("OccupancyIdentifier") },
  { name: "pre-type", test: has("StreetNamePreType") },
  { name: "post-directional", test: has("StreetNamePostDirectional") },
  { name: "embedded", test: (ex) => ex.source === "embedded" },
  { name: "no-commas", test: (ex) => !ex.text.includes(",") },
  { name: "all-caps", test: (ex) => /\p{L}/u.test(ex.text) && ex.text === ex.text.toUpperCase() },
  { name: "tokens<=3", test: (ex) => tokenCount(ex) <= 3 },
  { name: "tokens>=10", test: (ex) => tokenCount(ex) >= 10 },
];

const OTHER = SLICES.slice(DIMENSIONS.reduce((n, d) => n + d.values.length, 0));

/** Names of the slices `ex` is in; the same as testing each of SLICES, computed once per dimension. */
export function slicesOf(ex: Example): string[] {
  return [
    ...DIMENSIONS.flatMap((d) => d.of(ex).map((v) => sliceName(d.name, v))),
    ...OTHER.filter((s) => s.test(ex)).map((s) => s.name),
  ];
}
