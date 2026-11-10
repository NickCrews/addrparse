/**
 * Dimensions that describe an example: its address type, state, error types and so on. Each
 * dimension maps an example to its values, read from the gold labels, `source`, `noise` and
 * `notes`. The same functions describe the training mix (`countMix`) and split accuracy (each
 * value is a `<dimension>=<value>` slice in `slices.ts`), so the two line up row for row.
 *
 * A dimension is `exclusive` when every example has exactly one value, so its shares sum to 100%.
 * Otherwise an example can have several values (a typo and a missing ZIP), and each share is the
 * fraction of examples with that value.
 *
 * Add a dimension by appending to DIMENSIONS. `pnpm slices` recomputes every dimension from the
 * data and saved predictions, so a new one can be read on past runs without rerunning them.
 */
import { listDatasets } from "../data/datasets.ts";
import { blendedLines } from "../data/load.ts";
import type { Split } from "../data/paths.ts";
import { NOISE_NAMES } from "../data/noise.ts";
import type { Label } from "../labels.ts";
import type { Example } from "../types.ts";

export interface Dimension {
  name: string;
  /** A heading for its tables: "By address type". */
  title: string;
  /** One line for tables and the docs. */
  description: string;
  /** What a value means, where its name doesn't say. */
  notes?: Readonly<Record<string, string>>;
  /** Every value, in display order. */
  values: readonly string[];
  exclusive: boolean;
  /** Values of one example; exactly one when `exclusive`. */
  of(ex: Example): string[];
}

const has = (ex: Example, label: Label) => ex.spans.some((s) => s.label === label);
const textOf = (ex: Example, label: Label) => {
  const s = ex.spans.find((s) => s.label === label);
  return s ? ex.text.slice(s.start, s.end) : undefined;
};

/** Every gold span is NotAddress: a parser should abstain on the whole text. */
export const isJunkOnly = (ex: Example) =>
  ex.spans.length > 0 && ex.spans.every((s) => s.label === "NotAddress");

// ---------------------------------------------------------------------------------------------
// Address type

const MILITARY_GROUP = /^(?:psc|cmr|unit)$/i;
const HIGHWAY_CONTRACT =
  /^(?:h\.?\s*c\.?\s*r?\.?|highway\s+contract(?:\s+route)?|star\s+(?:route|rt\.?))$/i;

/** First match wins, in this order. */
const KINDS: readonly [string, (ex: Example) => boolean][] = [
  ["junk", isJunkOnly],
  [
    "military",
    (ex) =>
      MILITARY_GROUP.test(textOf(ex, "USPSBoxGroupType") ?? "") ||
      /^(?:apo|fpo|dpo)$/i.test(textOf(ex, "PlaceName") ?? ""),
  ],
  ["highway-contract", (ex) => HIGHWAY_CONTRACT.test(textOf(ex, "USPSBoxGroupType") ?? "")],
  ["rural-route", (ex) => has(ex, "USPSBoxGroupType")],
  ["general-delivery", (ex) => has(ex, "USPSBoxType") && !has(ex, "USPSBoxID")],
  ["po-box", (ex) => has(ex, "USPSBoxID")],
  ["milepost", (ex) => has(ex, "AddressNumberPrefix")],
  ["street", (ex) => has(ex, "AddressNumber")],
  ["street-no-number", (ex) => has(ex, "StreetName")],
  ["landmark", (ex) => has(ex, "LandmarkName")],
  [
    "place-only",
    (ex) =>
      has(ex, "PlaceName") || has(ex, "StateName") || has(ex, "ZipCode") || has(ex, "CountryName"),
  ],
  ["other", () => true],
];

export function kindOf(ex: Example): string {
  return KINDS.find(([, test]) => test(ex))![0];
}

// ---------------------------------------------------------------------------------------------
// Location

export const STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
  VI: "Virgin Islands",
  GU: "Guam",
  AS: "American Samoa",
  MP: "Northern Mariana Islands",
  AA: "Armed Forces Americas",
  AE: "Armed Forces Europe",
  AP: "Armed Forces Pacific",
};

const STATE_BY_NAME = new Map<string, string>([
  ...Object.entries(STATES).map(([code, name]) => [name.toUpperCase(), code] as const),
  ...Object.keys(STATES).map((code) => [code, code] as const),
]);

/**
 * The first three digits of a ZIP and the state they belong to, as [first, last, state] ranges
 * of USPS's 3-digit ZIP prefixes. Prefixes that cross states are given to the main one.
 */
const ZIP3: readonly [number, number, string][] = [
  [5, 5, "NY"],
  [6, 7, "PR"],
  [8, 8, "VI"],
  [9, 9, "PR"],
  [10, 27, "MA"],
  [28, 29, "RI"],
  [30, 38, "NH"],
  [39, 49, "ME"],
  [50, 54, "VT"],
  [55, 55, "MA"],
  [56, 59, "VT"],
  [60, 69, "CT"],
  [70, 89, "NJ"],
  [90, 99, "AE"],
  [100, 149, "NY"],
  [150, 196, "PA"],
  [197, 199, "DE"],
  [200, 200, "DC"],
  [201, 201, "VA"],
  [202, 205, "DC"],
  [206, 219, "MD"],
  [220, 246, "VA"],
  [247, 268, "WV"],
  [270, 289, "NC"],
  [290, 299, "SC"],
  [300, 319, "GA"],
  [320, 339, "FL"],
  [340, 340, "AA"],
  [341, 349, "FL"],
  [350, 369, "AL"],
  [370, 385, "TN"],
  [386, 397, "MS"],
  [398, 399, "GA"],
  [400, 427, "KY"],
  [430, 459, "OH"],
  [460, 479, "IN"],
  [480, 499, "MI"],
  [500, 528, "IA"],
  [530, 549, "WI"],
  [550, 567, "MN"],
  [569, 569, "DC"],
  [570, 577, "SD"],
  [580, 588, "ND"],
  [590, 599, "MT"],
  [600, 629, "IL"],
  [630, 658, "MO"],
  [660, 679, "KS"],
  [680, 693, "NE"],
  [700, 714, "LA"],
  [716, 729, "AR"],
  [730, 732, "OK"],
  [733, 733, "TX"],
  [734, 749, "OK"],
  [750, 799, "TX"],
  [800, 816, "CO"],
  [820, 831, "WY"],
  [832, 838, "ID"],
  [840, 847, "UT"],
  [850, 865, "AZ"],
  [870, 884, "NM"],
  [885, 885, "TX"],
  [889, 898, "NV"],
  [900, 961, "CA"],
  [962, 966, "AP"],
  [967, 968, "HI"],
  [969, 969, "GU"],
  [970, 979, "OR"],
  [980, 994, "WA"],
  [995, 999, "AK"],
];

export function stateOfZip(zip: string): string | undefined {
  const m = /^\D*(\d{5})/.exec(zip);
  if (!m) return undefined;
  const p = Number(m[1]!.slice(0, 3));
  return ZIP3.find(([lo, hi]) => p >= lo && p <= hi)?.[2];
}

/** The two-letter code of the gold StateName, or else of the gold ZIP's prefix. */
export function stateOf(ex: Example): string | undefined {
  const name = textOf(ex, "StateName");
  if (name !== undefined) {
    const key = name.replace(/\./g, "").replace(/\s+/g, " ").trim().toUpperCase();
    const code = STATE_BY_NAME.get(key);
    if (code) return code;
  }
  const zip = textOf(ex, "ZipCode");
  return zip === undefined ? undefined : stateOfZip(zip);
}

/** Census regions, with Alaska on its own as the place the most varied data is from. */
const REGIONS: Record<string, readonly string[]> = {
  alaska: ["AK"],
  west: ["WA", "OR", "CA", "NV", "ID", "MT", "WY", "UT", "CO", "AZ", "NM", "HI"],
  midwest: ["ND", "SD", "NE", "KS", "MN", "IA", "MO", "WI", "IL", "IN", "MI", "OH"],
  south: [
    ...["TX", "OK", "AR", "LA", "MS", "AL", "TN", "KY", "WV", "VA", "MD", "DE", "DC"],
    ...["NC", "SC", "GA", "FL"],
  ],
  northeast: ["PA", "NJ", "NY", "CT", "RI", "MA", "VT", "NH", "ME"],
  territory: ["PR", "VI", "GU", "AS", "MP"],
  military: ["AA", "AE", "AP"],
};
const REGION_OF = new Map(
  Object.entries(REGIONS).flatMap(([region, states]) => states.map((s) => [s, region] as const)),
);

// ---------------------------------------------------------------------------------------------
// Errors

/**
 * Noise transforms (`src/data/noise.ts`) grouped into the kind of mistake they imitate. Every
 * noise name is in exactly one family.
 */
export const NOISE_FAMILIES: Record<string, readonly string[]> = {
  typo: ["typo"],
  order: ["unit-first", "zip-before-state"],
  joined: ["unit-joined", "box-joined", "state-zip-joined", "dot-joined", "comma-joined"],
  "line-break": ["newline"],
  punctuation: ["extra-punct"],
  case: ["lowercase", "uppercase"],
  "missing-state": ["drop-state"],
  "missing-zip": ["drop-zip"],
};

/** Gold notes that mark a misspelt or truncated word in the source data itself. */
const TYPO_NOTES = new Set([
  "road:truncated-suffix",
  "road:truncated-to-letter",
  "road:misspelled-type",
]);

/** Kinds that are an address line, so a missing city, state or ZIP is something left off. */
const HAS_LINE = new Set([
  "military",
  "highway-contract",
  "rural-route",
  "general-delivery",
  "po-box",
  "milepost",
  "street",
  "street-no-number",
  "landmark",
]);

function errorsOf(ex: Example): string[] {
  const out = new Set<string>();
  for (const [family, names] of Object.entries(NOISE_FAMILIES)) {
    if (names.some((n) => ex.noise?.includes(n))) out.add(family);
  }
  if (ex.notes?.some((n) => TYPO_NOTES.has(n))) out.add("typo");
  if (HAS_LINE.has(kindOf(ex))) {
    if (!has(ex, "PlaceName")) out.add("missing-city");
    if (!has(ex, "StateName")) out.add("missing-state");
    if (!has(ex, "ZipCode")) out.add("missing-zip");
  }
  return out.size ? ERROR_VALUES.filter((v) => out.has(v)) : ["none"];
}

const ERROR_VALUES = [
  "none",
  "typo",
  "order",
  "joined",
  "line-break",
  "punctuation",
  "case",
  "missing-city",
  "missing-state",
  "missing-zip",
];

// ---------------------------------------------------------------------------------------------

/** True when the gold labels rest on a heuristic (`Example.notes`), other than a dropped field. */
export const heuristicGold = (ex: Example) =>
  (ex.notes ?? []).some((n) => !n.startsWith("dropped:") && n !== "override");

export const DIMENSIONS: readonly Dimension[] = [
  {
    name: "kind",
    title: "By address type",
    notes: {
      junk: "no address at all",
      military: "PSC 1234 Box 5, APO AE 09204",
      "highway-contract": "HC 60 Box 4321",
      "rural-route": "RR 2 Box 123",
      "general-delivery": "General Delivery, Kenai, AK",
      "po-box": "PO Box 123",
      milepost: "Mile 14.5 Parks Hwy",
      street: "123 Main St",
      "street-no-number": "Main St, a village street, an intersection",
      landmark: "Teacher Housing, directions to the place",
      "place-only": "a city, state, ZIP or country alone",
      other: "none of the above",
    },
    description:
      "Address type, from the gold labels: the first that applies of junk (no address), military, highway contract, rural route, general delivery, PO box, milepost, street with a number, street without one, landmark, city/state/ZIP/country alone",
    values: KINDS.map(([k]) => k),
    exclusive: true,
    of: (ex) => [kindOf(ex)],
  },
  {
    name: "error",
    title: "By error type",
    notes: {
      none: "none of these",
      typo: "a misspelt or truncated word (vermn, Plac)",
      order: "unit before the house number, ZIP before the state",
      joined: "missing space: Apt4, PO Box55, AK99611, St.Apt",
      "line-break": "a line break before the city",
      punctuation: "extra periods: St. N.",
      case: "all lowercase or all uppercase",
      "missing-city": "an address line with no city",
      "missing-state": "an address line with no state",
      "missing-zip": "an address line with no ZIP",
    },
    description:
      "Mistakes in the text: formatting noise by family (typo also counts misspellings libpostal's data has), and a city, state or ZIP left off an address line",
    values: ERROR_VALUES,
    exclusive: false,
    of: errorsOf,
  },
  {
    name: "extra",
    title: "By text besides the address",
    notes: {
      none: "the address alone",
      recipient: "a name or C/O line (Recipient)",
      "other-text": "other text around the address (NotAddress)",
      "only-other-text": "no address at all",
    },
    description:
      "Text besides the address: a recipient, other non-address text, or nothing but non-address text",
    values: ["none", "recipient", "other-text", "only-other-text"],
    exclusive: false,
    of: (ex) => {
      if (isJunkOnly(ex)) return ["only-other-text"];
      const out: string[] = [];
      if (has(ex, "Recipient")) out.push("recipient");
      if (has(ex, "NotAddress")) out.push("other-text");
      return out.length ? out : ["none"];
    },
  },
  {
    name: "region",
    title: "By region",
    notes: {
      alaska: "AK",
      west: "Census West, without AK",
      midwest: "Census Midwest",
      south: "Census South, with DC",
      northeast: "Census Northeast",
      territory: "PR, VI, GU, AS, MP",
      military: "AA, AE, AP",
      none: "no state or ZIP in the text",
    },
    description:
      "Census region of the state (from the gold state, else the ZIP), with Alaska on its own; none when the text has neither",
    values: [...Object.keys(REGIONS), "none"],
    exclusive: true,
    of: (ex) => {
      const s = stateOf(ex);
      return [(s && REGION_OF.get(s)) ?? "none"];
    },
  },
  {
    name: "state",
    title: "By state",
    description: "State, from the gold state, else the ZIP; none when the text has neither",
    values: [...Object.keys(STATES), "none"],
    exclusive: true,
    of: (ex) => [stateOf(ex) ?? "none"],
  },
  {
    name: "source",
    title: "By dataset",
    description: "Dataset the example came from",
    values: listDatasets().map((d) => d.name),
    exclusive: true,
    of: (ex) => [ex.source],
  },
  {
    name: "noise",
    title: "By formatting noise",
    description: "Formatting noise transforms applied (src/data/noise.ts)",
    values: ["none", ...NOISE_NAMES],
    exclusive: false,
    of: (ex) => (ex.noise?.length ? ex.noise : ["none"]),
  },
  {
    name: "gold",
    title: "By gold label quality",
    description: "Whether the gold labels rest on a labeling heuristic",
    values: ["clean", "heuristic"],
    exclusive: true,
    of: (ex) => [heuristicGold(ex) ? "heuristic" : "clean"],
  },
];

export function dimension(name: string): Dimension {
  const d = DIMENSIONS.find((d) => d.name === name);
  if (!d) {
    throw new Error(
      `unknown dimension ${name}; dimensions: ${DIMENSIONS.map((d) => d.name).join(", ")}`,
    );
  }
  return d;
}

/** Number of examples with each value of each dimension, out of `examples`. */
export interface Mix {
  examples: number;
  counts: Record<string, Record<string, number>>;
}

export function emptyMix(): Mix {
  return { examples: 0, counts: Object.fromEntries(DIMENSIONS.map((d) => [d.name, {}])) };
}

export function addToMix(mix: Mix, ex: Example): void {
  mix.examples++;
  for (const d of DIMENSIONS) {
    const counts = (mix.counts[d.name] ??= {});
    for (const v of d.of(ex)) counts[v] = (counts[v] ?? 0) + 1;
  }
}

export function countMix(examples: Iterable<Example>): Mix {
  const mix = emptyMix();
  for (const ex of examples) addToMix(mix, ex);
  return mix;
}

/**
 * Values seen in `counts` in the dimension's order, then any it doesn't list (a dataset added
 * since, an unknown source).
 */
export function orderedValues(d: Dimension, ...seen: readonly Record<string, unknown>[]): string[] {
  const all = new Set(seen.flatMap((s) => Object.keys(s)));
  return [...d.values.filter((v) => all.has(v)), ...[...all].filter((v) => !d.values.includes(v))];
}

/** The mix of the first `n` examples of a split blended by `weights`, read one line at a time. */
export async function mixOfSplit(
  split: Split,
  n: number,
  weights?: Readonly<Record<string, number>>,
): Promise<Mix> {
  const mix = emptyMix();
  for (const { line } of await blendedLines(split, n, weights)) {
    addToMix(mix, JSON.parse(line) as Example);
  }
  return mix;
}
