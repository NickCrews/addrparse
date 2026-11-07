/**
 * Converts one libpostal-tagged line into an Example's `text` and fine-grained `spans`.
 *
 * libpostal's labels are coarse (the whole street is `road`), so each libpostal field is split
 * into usaddress-style labels with the rules below. The rules are heuristics: every rule that
 * makes a judgment call records a note, and `pnpm data:build` reports how often each fired, so
 * the share of examples whose gold labels rest on a guess is visible.
 *
 * | libpostal            | here                                                              |
 * | -------------------- | ----------------------------------------------------------------- |
 * | house_number         | AddressNumber, AddressNumberSuffix                                |
 * | road                 | StreetNamePreModifier, StreetNamePre/PostDirectional,             |
 * |                      | StreetNamePre/PostType, StreetName                                |
 * | unit, level          | OccupancyType, OccupancyIdentifier                                |
 * | po_box               | USPSBoxType, USPSBoxID                                            |
 * | city                 | PlaceName                                                         |
 * | state                | StateName                                                         |
 * | postcode             | ZipCode                                                           |
 * | country              | CountryName                                                       |
 * | category, near       | NotAddress ("cafes near me", "restaurants in Portland")           |
 * | everything else      | field removed from the text (suburb, county, venue name, ...)     |
 *
 * A line is rejected when its road is a data-entry placeholder ("UNKNOWN", "NO SITUS",
 * "Unnamed Road"), when its city is a venue name (`VENUE_CITY`), or when a kept field is in a
 * non-Latin script (libpostal's translations of state and country names into Japanese,
 * Russian, ...).
 *
 * Road policies where the split is ambiguous:
 * - A compound directional split in two ("S E Main St", "Sth Wst 28th St") is the directional,
 *   so "S West Temple St" gets West as a directional too. libpostal's noise writes Portland's
 *   "SE Division St" as "S East Division St" ~4x as often as a literal "S West Temple St"
 *   occurs; `road:split-directional` counts both.
 * - A road of two directionals ("E North") is a pre-directional and a name.
 * - "Old" before a pre-typed road is StreetNamePreModifier ("Old Hwy 9"); elsewhere it's part
 *   of the name ("Old Mill Rd").
 * - A pre-type followed by a word rather than a number or letter is part of the name
 *   ("Avenue of the Americas", "Calle Real"); `road:leading-type-in-name` counts them.
 * - Of stacked types, only the last is the post-type ("Village Green Dr", "Bay St Ext");
 *   `road:stacked-type` counts them.
 *
 * Unit policies: "2 / F" and "G / F" (Hong Kong floor notation) are identifier "2" and type
 * "/ F". Levels with no number ("Basement", "Upstairs", "Gf") are OccupancyType. Two unit
 * fields whose same-label tokens would touch with only a space between ("4th Fl Apt 3") are
 * rendered with ", " between them, so they stay two spans a tokenizer can tell apart.
 *
 * libpostal abbreviates and truncates words on purpose as noise ("Wst" for West, "Roa" for
 * Road, "Aprt" for Apartment); the rules accept those spellings.
 */
import type { Label } from "../labels.ts";
import type { Span } from "../types.ts";
import type { LpToken } from "./libpostal.ts";
import { STREET_SUFFIXES } from "./street-suffixes.ts";

export const DIRECTIONALS: ReadonlySet<string> = new Set([
  ...["n", "s", "e", "w", "ne", "nw", "se", "sw"],
  ...["north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"],
]);

/**
 * libpostal's nonstandard directional spellings ("So", "Sth", "Wst", "Nrth") and compounds of
 * them ("Sowst", "Northwst"), minus English words the compounding produces.
 */
const NORTH_SOUTH: ReadonlySet<string> = new Set([
  "n",
  "no",
  "nth",
  "nrth",
  "nrt",
  "nort",
  "norh",
  "north",
  "s",
  "so",
  "sth",
  "sou",
  "south",
]);
const EAST_WEST: ReadonlySet<string> = new Set(["e", "east", "w", "wst", "west"]);
export const ABBREVIATED_DIRECTIONALS: ReadonlySet<string> = (() => {
  const out = new Set([...NORTH_SOUTH, ...EAST_WEST]);
  for (const a of NORTH_SOUTH) for (const b of EAST_WEST) out.add(a + b);
  for (const word of ["now", "sow", "noe", "soe", "norte"]) out.delete(word);
  for (const d of DIRECTIONALS) out.delete(d);
  return out;
})();

export const OCCUPANCY_TYPES: ReadonlySet<string> = new Set([
  ...["#", "apt", "apartment", "unit", "ste", "suite", "rm", "room", "fl", "floor", "flr"],
  ...["bldg", "building", "lot", "trlr", "trailer", "spc", "space", "sp", "no", "number"],
  ...["ph", "penthouse", "dept", "department", "ofc", "office", "bsmt", "basement", "frnt"],
  ...["front", "rear", "lowr", "lower", "uppr", "upper", "side", "hngr", "hangar", "pier"],
  ...["slip", "stop", "lbby", "lobby", "level", "lvl"],
  // libpostal's abbreviations and translations
  ...["ap", "aprt", "aptmnt", "apto", "apartamento", "u", "un", "unt", "flt", "flat", "door"],
  ...["offc", "nbr", "nmbr", "num", "nr", "№", "nº", "lev", "levl", "lvel", "story", "piso"],
  // Levels written as one word with no number are the type, like "Basement": "Ug", "Gf",
  // "Tf", "Lg" (upper ground, ground, top, lower ground floor), "Pb", "Bajos" (planta baja).
  // Written as two words they split into identifier and type ("Ground Floor", "G / F").
  ...["upstairs", "downstairs", "cellar", "mezzanine", "mezz", "ug", "ugf", "ugfl", "gf"],
  ...["gdfl", "tf", "lg", "pb", "bajo", "bajos", "bjs", "sótano", "sotano"],
]);

/** Words that can follow a level's identifier ("3rd Floor", "2 Lvl"). */
const LEVEL_TYPES: ReadonlySet<string> = new Set([
  ...["fl", "floor", "flr", "level", "lvl", "lev", "levl", "lvel", "story", "piso"],
  ...["platform", "pf"],
]);

/** Words after "/" in Hong Kong floor notation ("2 / F", "G / F", "5 / L"). */
const SLASH_LEVEL_TYPES: ReadonlySet<string> = new Set(["f", "fl", "flr", "floor", "l", "lvl"]);

/** Designators that name a level when followed by more level name ("Upper Ground Floor"). */
const LEVEL_QUALIFIERS: ReadonlySet<string> = new Set(["upper", "uppr", "lower", "lowr"]);

/** Two-letter codes of the states, DC and the inhabited territories. */
export const STATE_CODES: ReadonlySet<string> = new Set([
  ...["al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia"],
  ...["ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj"],
  ...["nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt"],
  ...["va", "wa", "wv", "wi", "wy", "dc", "pr", "gu", "vi", "as", "mp"],
]);

const STATE_NAMES: ReadonlySet<string> = new Set([
  ...["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut"],
  ...["delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa"],
  ...["kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan"],
  ...["minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire"],
  ...["new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio"],
  ...["oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota"],
  ...["tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia"],
  ...["wisconsin", "wyoming", "district of columbia", "puerto rico", "guam"],
]);

const COUNTRY_NAMES: ReadonlySet<string> = new Set([
  ...["us", "usa", "u s", "u s a", "united states", "united states of america", "america"],
  ...["united-states-of-america", "the states"],
]);

/**
 * Street types that come before the name ("County Road 1147", "Highway 9", "Avenue J"): a
 * qualifier followed by a core word, or a standalone word. Matched on words, so "C.R." and
 * "CO.RD" are two words each.
 */
const PRE_TYPE_QUALIFIERS: readonly (readonly string[])[] = [
  ["farm", "to", "market"],
  ["ranch", "to", "market"],
  ["u", "s"],
  ...["county", "co", "cty", "c", "state", "st", "us", "private", "pvt", "twp", "township"].map(
    (w) => [w],
  ),
];
const PRE_TYPE_CORES: ReadonlySet<string> = new Set([
  ...["road", "rd", "route", "rte", "rt", "highway", "hwy", "hywy", "interstate"],
]);
/** Qualifiers after which "R" is a core word too ("C R 9", "CTY R 9"). */
const COUNTY_QUALIFIERS: ReadonlySet<string> = new Set(["county", "co", "cty", "c"]);
/** Multi-word pre-types that need no core word: "I H 35" (Interstate Highway), "U S 9". */
const MULTIWORD_PRE_TYPES: readonly (readonly string[])[] = [
  ["i", "h"],
  ["u", "s"],
];
const STANDALONE_PRE_TYPES: ReadonlySet<string> = new Set([
  ...["highway", "hwy", "hywy", "route", "rte", "rt", "interstate", "i", "ih", "avenue", "ave"],
  ...["av"],
  ...["road", "rd", "loop", "spur", "us"],
  // Spanish (Puerto Rico, the Southwest): "Calle 9", "Carr 2"
  ...["calle", "avenida", "carretera", "carr", "camino"],
  // Texas farm/ranch-to-market roads; county, state, township, private and ranch roads;
  // Wisconsin county, state and US trunk highways
  ...["fm", "rm", "cr", "sr", "sh", "tr", "pr", "rr", "cth", "sth", "ush"],
]);

/** Pre-type words that start roads whose name is a word ("Avenue of the Americas"). */
const LEADING_TYPE_WORDS: ReadonlySet<string> = new Set([
  ...["avenue", "ave", "av", "highway", "hwy", "route", "rte", "calle", "avenida", "camino"],
  ...["carretera", "paseo", "via"],
]);

/**
 * Street types that are rarely a word of a name, so a road with one before its post-type has
 * stacked types ("Bay St Ext", "Eastern Parkway Extension"). Words like "Creek" and "Hill" are
 * types too but are usually the name ("Mill Creek Rd").
 */
const THOROUGHFARE_TYPES: ReadonlySet<string> = new Set([
  ...["st", "street", "rd", "road", "ave", "avenue", "av", "dr", "drive", "ln", "lane", "blvd"],
  ...["boulevard", "ct", "court", "pl", "place", "pkwy", "parkway", "hwy", "highway", "cir"],
  ...["circle", "ter", "terrace", "way"],
]);

/** Roads that are data-entry placeholders, matched against the road's normalized words. */
const PLACEHOLDER_ROAD =
  /\b(unknown|unassigned|undetermined|situs|cama data|to be assigned|no address|address assigned)\b|^(vacant|vacant land|building|unnamed|unnamed (road|rd|st|street)|no name)$/;

/** Truncations of street suffixes that are more often whole words in street names. */
const NOT_TRUNCATED_SUFFIXES: ReadonlySet<string> = new Set([
  ...["bay", "gate", "high", "cross", "sky", "fe", "ann", "villa", "mead", "can", "comm", "par"],
  ...["valle"],
]);

/**
 * City fields that are an OSM venue name rather than a place, matched against the field's
 * normalized words. "Comfort Inn Fruita" is one OSM hotel's addr:city, on ~500 lines of
 * libpostal's sample. City fields that start with venue words (Inn, Mall, Church, ...) or equal
 * a venue name elsewhere in the sample are otherwise real places ("Fountain Inn", "Falls
 * Church"), so no general rule is applied.
 */
const VENUE_CITY = /^comfort inn\b/;

/** Fields whose tokens are removed from the rendered text. */
const DROPPED = new Set([
  "suburb",
  "city_district",
  "state_district",
  "island",
  "country_region",
  "world_region",
  "house",
  "building",
  "staircase",
  "entrance",
  "metro_station",
  "phone",
  "website",
]);

const SIMPLE: Record<string, Label> = {
  city: "PlaceName",
  state: "StateName",
  postcode: "ZipCode",
  country: "CountryName",
  category: "NotAddress",
  near: "NotAddress",
};

const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

export interface RefineOptions {
  /** How an FSEP field boundary is rendered, e.g. ", " or " ". */
  fieldSeparator: string;
}

export type RefineResult =
  | { ok: true; text: string; spans: Span[]; notes: string[] }
  | { ok: false; reason: string; notes: string[] };

/** Lowercase and strip surrounding punctuation, so "St." and "ST" compare equal. */
export function norm(token: string): string {
  return token.toLowerCase().replace(/^[^\p{L}\p{N}#№]+|[^\p{L}\p{N}#№]+$/gu, "");
}

function isIdLike(token: string): boolean {
  return /^(\d+[a-z]?|[a-z]\d+[a-z]?|[a-z]|\d+-\d+)$/i.test(norm(token));
}

/** "std" for a standard directional, "abbrev" for one of libpostal's spellings. */
function directional(normed: string): "std" | "abbrev" | undefined {
  const t = normed.replace(/\./g, "");
  if (DIRECTIONALS.has(t)) return "std";
  if (ABBREVIATED_DIRECTIONALS.has(t)) return "abbrev";
  return undefined;
}

/**
 * Number of tokens in the pre-type phrase starting at token `start`, or 0. The phrase must end
 * on a token boundary.
 */
function preTypeLength(t: readonly string[], start: number): number {
  const words: { word: string; token: number }[] = [];
  for (let k = start; k < t.length && k < start + 4; k++) {
    for (const word of t[k]!.split(".")) if (word) words.push({ word, token: k });
  }
  const endsToken = (w: number) =>
    w > 0 && w <= words.length && (w === words.length || words[w]!.token !== words[w - 1]!.token);
  const tokensTo = (w: number) => words[w - 1]!.token + 1 - start;
  const first = words[0]?.word;
  if (first === undefined) return 0;

  for (const q of PRE_TYPE_QUALIFIERS) {
    if (!q.every((w, k) => words[k]?.word === w)) continue;
    const core = words[q.length]?.word;
    if (core === undefined) continue;
    const countyR = core === "r" && q.length === 1 && COUNTY_QUALIFIERS.has(q[0]!);
    if ((PRE_TYPE_CORES.has(core) || countyR) && endsToken(q.length + 1)) {
      return tokensTo(q.length + 1);
    }
  }
  for (const q of MULTIWORD_PRE_TYPES) {
    if (q.every((w, k) => words[k]?.word === w) && endsToken(q.length)) return tokensTo(q.length);
  }
  // "NE" is Nebraska's code but in a road it's the directional.
  const stateCode = STATE_CODES.has(first) && !directional(first) && endsToken(1);
  // State code before a pre-type: "VT Route 9", "LA HWY 9"
  if (stateCode && start + 1 < t.length && !STATE_CODES.has(t[start + 1]!)) {
    const rest = preTypeLength(t, start + 1);
    if (rest > 0) return rest + 1;
  }
  if (endsToken(1) && (STANDALONE_PRE_TYPES.has(first) || stateCode)) return 1;
  return 0;
}

/**
 * Labels a road whose type comes first: [PreDirectional] [PreModifier] PreType Name [PostType]
 * [PostDirectional], where Name is one or two ID-like tokens ("9", "1147 A", "J") and
 * PreModifier is "Old". Returns undefined when the road isn't of that form.
 */
function refinePreTypeRoad(tokens: readonly string[], t: readonly string[]): Label[] | undefined {
  const n = tokens.length;
  for (const dirEnd of directional(t[0]!) && n >= 3 ? [0, 1] : [0]) {
    const modified = t[dirEnd] === "old";
    const start = dirEnd + (modified ? 1 : 0);
    const len = preTypeLength(t, start);
    if (len === 0) continue;
    const labels: Label[] = new Array(n).fill("StreetName");
    let end = n;
    if (end - (start + len) >= 2 && directional(t[end - 1]!)) {
      labels[--end] = "StreetNamePostDirectional";
    }
    if (end - (start + len) >= 2 && !isIdLike(tokens[end - 1]!) && isSuffix(t[end - 1]!, [])) {
      labels[--end] = "StreetNamePostType";
    }
    const name = end - (start + len);
    const nameTokens = tokens.slice(start + len, end);
    if (name < 1 || name > 2 || !nameTokens.every(isIdLike)) continue;
    // "Sth" is Wisconsin's numbered state trunk highway, or libpostal's "South" ("Sth W Dr").
    if (len === 1 && directional(t[start]!) && !nameTokens.some((tok) => /\d/.test(tok))) continue;
    if (dirEnd === 1) labels[0] = "StreetNamePreDirectional";
    if (modified) labels[dirEnd] = "StreetNamePreModifier";
    for (let k = start; k < start + len; k++) labels[k] = "StreetNamePreType";
    return labels;
  }
  return undefined;
}

export function refineRoad(tokens: readonly string[], notes: string[]): Label[] {
  const n = tokens.length;
  const t = tokens.map(norm);
  if (tokens.some((tok) => /[()]/.test(tok))) notes.push("road:parenthetical");

  const noteDirectional = (labels: readonly Label[]) => {
    const abbrev = labels.some(
      (l, k) => l.endsWith("Directional") && directional(t[k]!) === "abbrev",
    );
    if (abbrev) notes.push("road:abbreviated-directional");
  };

  const preTyped = refinePreTypeRoad(tokens, t);
  if (preTyped) {
    notes.push("road:pre-type");
    const k = preTyped.indexOf("StreetNamePreType");
    const bare = preTyped[k + 1] !== "StreetNamePreType";
    if (bare && (STATE_CODES.has(t[k]!) || t[k] === "us" || t[k] === "u"))
      notes.push("road:state-route");
    noteDirectional(preTyped);
    return preTyped;
  }

  if (n === 2 && directional(t[0]!) && directional(t[1]!)) {
    notes.push("road:directional-or-name");
    const labels: Label[] = ["StreetNamePreDirectional", "StreetName"];
    noteDirectional(labels);
    return labels;
  }

  const labels: Label[] = new Array(n).fill("StreetName");
  let i = 0;
  let j = n;
  // A compound directional split in two ("Nrth Wst", "South West"). Before the name this is
  // a guess; see the policy in the header ("S West Temple St").
  const split = (k: number) =>
    NORTH_SOUTH.has(t[k]!.replace(/\./g, "")) && EAST_WEST.has(t[k + 1]!.replace(/\./g, ""));
  if (j - i >= 3 && split(j - 2)) {
    labels[j - 2] = labels[j - 1] = "StreetNamePostDirectional";
    j -= 2;
    notes.push("road:split-directional");
  } else if (j - i >= 2 && directional(t[j - 1]!)) {
    labels[j - 1] = "StreetNamePostDirectional";
    j--;
  }
  if (j - i >= 2 && isSuffix(t[j - 1]!, notes)) {
    labels[j - 1] = "StreetNamePostType";
    j--;
  }
  if (j - i >= 3 && split(i)) {
    labels[i] = labels[i + 1] = "StreetNamePreDirectional";
    i += 2;
    notes.push("road:split-directional");
  } else if (j - i >= 2 && directional(t[i]!)) {
    labels[i] = "StreetNamePreDirectional";
    i++;
  }
  if (n === 1 && (directional(t[0]!) || STREET_SUFFIXES.has(t[0]!))) {
    notes.push("road:lone-type-or-directional");
  }
  if (j - i >= 2 && LEADING_TYPE_WORDS.has(t[i]!)) notes.push("road:leading-type-in-name");
  if (
    j < n &&
    labels[j] === "StreetNamePostType" &&
    j - i >= 2 &&
    THOROUGHFARE_TYPES.has(t[j - 1]!)
  ) {
    notes.push("road:stacked-type");
  }
  noteDirectional(labels);
  return labels;
}

/**
 * True for a known suffix spelling, or for a truncation of a suffix of 4+ letters
 * ("Ro" → road, "Stre" → street). libpostal truncates words on purpose as noise.
 */
function isSuffix(token: string, notes: string[]): boolean {
  if (STREET_SUFFIXES.has(token)) return true;
  if (token.length < 2 || /\d/.test(token) || NOT_TRUNCATED_SUFFIXES.has(token)) return false;
  for (const s of STREET_SUFFIXES) {
    if (s.length >= 4 && s.length > token.length && s.startsWith(token)) {
      notes.push("road:truncated-suffix");
      return true;
    }
  }
  return false;
}

/**
 * Leading designator words are OccupancyType and the rest OccupancyIdentifier ("Apt # 4B").
 * An unknown word counts as a designator when it is alphabetic, longer than one letter, and
 * followed by something other than level words ("Apto 9", "Door # 12", but "Ground Floor").
 * A level word after the identifier is OccupancyType too ("3rd Floor", "Ninth Fl"), and
 * "Upper"/"Lower" before more level name is part of the identifier ("Upper Ground Floor").
 * "2 / F" is identifier "2" and type "/ F".
 */
export function refineOccupancy(tokens: readonly string[], notes: string[]): Label[] {
  const labels: Label[] = tokens.map(() => "OccupancyIdentifier");
  const t = tokens.map(norm);
  const last = tokens.length - 1;
  if (tokens.length === 3 && tokens[1] === "/" && SLASH_LEVEL_TYPES.has(t[2]!)) {
    notes.push("unit:slash-level");
    return ["OccupancyIdentifier", "OccupancyType", "OccupancyType"];
  }
  let k = 0;
  while (k <= last) {
    if (LEVEL_QUALIFIERS.has(t[k]!) && k < last - 1 && LEVEL_TYPES.has(t[last]!)) {
      break;
    } else if (OCCUPANCY_TYPES.has(t[k]!)) {
      labels[k++] = "OccupancyType";
    } else if (
      k < last &&
      /^\p{L}{2,}$/u.test(t[k]!) &&
      !t.slice(k + 1).every((w) => LEVEL_TYPES.has(w))
    ) {
      labels[k++] = "OccupancyType";
      notes.push("unit:inferred-type");
    } else break;
  }
  if (k < last && LEVEL_TYPES.has(t[last]!)) {
    labels[last] = "OccupancyType";
    notes.push("unit:trailing-type");
  } else if (k === 0) {
    notes.push("unit:no-type");
  }
  return labels;
}

/**
 * A letter or fraction written as its own word after a numeric house number is
 * AddressNumberSuffix ("1833 B", "5157 1 / 2", "12 ½", "1203 C2"). N, S, E or W there is the
 * road's pre-directional that libpostal put in the number field ("680 E", then "Oakwood Ave").
 * Everything else is AddressNumber.
 */
export function refineHouseNumber(tokens: readonly string[], notes: string[]): Label[] {
  const labels: Label[] = tokens.map(() => "AddressNumber");
  const rest = tokens.slice(1).join(" ");
  if (!/^\d+$/.test(tokens[0]!)) return labels;
  if (/^[nsew]$/i.test(rest)) {
    notes.push("house_number:directional");
    labels[1] = "StreetNamePreDirectional";
  } else if (/^(\p{L}\d?|\d \/ \d|\d\/\d|[¼½¾])$/u.test(rest)) {
    labels.fill("AddressNumberSuffix", 1);
  }
  return labels;
}

/**
 * Tokens before the first one containing a digit are USPSBoxType and the rest USPSBoxID
 * ("P.O. Box # 12 B"). Without a digit, a final single letter is the ID ("P O B A").
 */
export function refinePoBox(tokens: readonly string[], notes: string[]): Label[] {
  let k = tokens.findIndex((tok) => /\d/.test(tok));
  if (k === -1) {
    k = tokens.length;
    if (tokens.length >= 2 && /^\p{L}$/u.test(norm(tokens.at(-1)!))) k--;
  }
  if (k === tokens.length) notes.push("po_box:no-id");
  return tokens.map((_, n) => (n < k ? "USPSBoxType" : "USPSBoxID"));
}

/** Notes for single-label fields whose text isn't what a US address would hold. */
function noteSimpleField(field: string, texts: readonly string[], notes: string[]): void {
  const words = texts.map(norm).filter(Boolean);
  if (field === "house_number") {
    // "Número 51", "2243 Unit 12", "1180 South"; a single letter is a number suffix ("12 B")
    if (words.some((w) => !/\d/.test(w) && /^[\p{L}#№]{2,}/u.test(w))) {
      notes.push("house_number:has-word");
    }
  } else if (field === "postcode") {
    // "Cp 90275", "Codigo Postal 85622"
    if (words.some((w) => /\p{L}/u.test(w))) notes.push("postcode:has-word");
  } else if (field === "state" || field === "country") {
    const joined = words.join(" ").replace(/\./g, " ").replace(/\s+/g, " ").trim();
    const known =
      field === "state"
        ? STATE_NAMES.has(joined.replace(/ state$/, "")) ||
          STATE_CODES.has(joined.replace(/ /g, ""))
        : COUNTRY_NAMES.has(joined);
    // libpostal's translations: "Kalifornien", "Nueva York", "Estados Unidos"
    if (!known) notes.push(`${field}:non-english`);
  }
}

type Item = { kind: "token"; text: string; label: Label } | { kind: "sep"; text: string };

export function refine(lpTokens: readonly LpToken[], options: RefineOptions): RefineResult {
  const notes: string[] = [];
  const items: Item[] = [];

  let k = 0;
  while (k < lpTokens.length) {
    const tok = lpTokens[k]!;
    if (tok.label === "SEP" || tok.label === "FSEP") {
      items.push({ kind: "sep", text: tok.label === "FSEP" ? "FSEP" : tok.text });
      k++;
      continue;
    }
    let end = k;
    while (end < lpTokens.length && lpTokens[end]!.label === tok.label) end++;
    const texts = lpTokens.slice(k, end).map((t) => t.text);
    k = end;

    if (DROPPED.has(tok.label)) {
      notes.push(`dropped:${tok.label}`);
      continue;
    }
    if (texts.some((text) => NON_LATIN.test(text))) {
      return { ok: false, reason: "non-latin-script", notes };
    }
    let labels: Label[];
    const simple = SIMPLE[tok.label];
    if (simple) {
      if (tok.label === "city" && VENUE_CITY.test(texts.map(norm).filter(Boolean).join(" "))) {
        return { ok: false, reason: "venue-as-city", notes };
      }
      labels = texts.map(() => simple);
      noteSimpleField(tok.label, texts, notes);
    } else if (tok.label === "house_number") {
      labels = refineHouseNumber(texts, notes);
      noteSimpleField(tok.label, texts, notes);
    } else if (tok.label === "road") {
      if (PLACEHOLDER_ROAD.test(texts.map(norm).filter(Boolean).join(" "))) {
        return { ok: false, reason: "placeholder-road", notes };
      }
      labels = refineRoad(texts, notes);
    } else if (tok.label === "unit" || tok.label === "level") {
      labels = refineOccupancy(texts, notes);
    } else if (tok.label === "po_box") {
      labels = refinePoBox(texts, notes);
    } else return { ok: false, reason: `unknown-label:${tok.label}`, notes };

    texts.forEach((text, n) => items.push({ kind: "token", text, label: labels[n]! }));
  }

  return render(items, options, notes);
}

function render(items: readonly Item[], options: RefineOptions, notes: string[]): RefineResult {
  let text = "";
  const spans: Span[] = [];
  // Separator owed before the next token. Literal punctuation (SEP) wins over a field break,
  // and separators before the first token or after the last are never rendered, which also
  // cleans up after dropped fields.
  let pending: string | undefined;

  for (const item of items) {
    if (item.kind === "sep") {
      if (!text) continue;
      if (item.text !== "FSEP") pending = item.text;
      else pending ??= "FSEP";
      continue;
    }
    // Adjacent same-label tokens merge into one span unless a separator sits between them,
    // the same rule spansFromTokens applies, so a field boundary with no separator (e.g.
    // category "cafes" then near "in") is invisible in the spans too.
    const merge = text.length > 0 && pending === undefined;
    const last = spans.at(-1);
    if (pending === "FSEP" && last?.label === item.label && /^\s*$/.test(options.fieldSeparator)) {
      // Two fields whose same-label tokens would touch with only a space between ("4th Fl
      // Apt 3"): a comma keeps them two spans that a tokenizer can tell apart.
      text += ", ";
      notes.push("render:comma-between-fields");
    } else if (pending === "FSEP") text += options.fieldSeparator;
    else if (pending === "-") text += " - ";
    else if (pending !== undefined) text += `${pending} `;
    else if (text) text += " ";
    pending = undefined;

    const start = text.length;
    text += item.text;
    if (merge && last?.label === item.label) last.end = text.length;
    else spans.push({ start, end: text.length, label: item.label });
  }

  if (spans.length === 0) return { ok: false, reason: "empty", notes };
  return { ok: true, text, spans, notes };
}
