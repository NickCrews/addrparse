/**
 * Rule labels for APOC's address fields. Each function labels one field, or returns undefined
 * when its text has a shape the rules don't cover; `build.ts` sends those to hand labeling.
 *
 * The address line is read as comma-separated segments, each a street with an optional unit, a
 * unit alone, a PO box, or a rural or highway contract route. The street, unit and box words are
 * split by `src/data/refine.ts`, the same rules that label the libpostal data.
 */
import type { Label } from "../../src/labels.ts";
import type { Part } from "../../src/data/datasets.ts";
import {
  norm,
  OCCUPANCY_TYPES,
  refineHouseNumber,
  refinePoBox,
  refineRoad,
  STATE_CODES,
} from "../../src/data/refine.ts";
import { STREET_SUFFIXES } from "../../src/data/street-suffixes.ts";
import { oneEditApart } from "../../src/data/gold.ts";
import { tokenize } from "../../src/tokens.ts";

export interface Word {
  text: string;
  /** Lowercase, surrounding punctuation stripped (`norm`). */
  n: string;
  start: number;
  end: number;
  /** A comma or semicolon follows the word. */
  sep: boolean;
}

/**
 * The tokenizer's tokens (`src/tokens.ts`), except that a single letter glued to the digits
 * after it is one word, an ID ("B9", "c12", "#S-300").
 */
export function words(text: string): Word[] {
  const out: Word[] = [];
  for (const t of tokenize(text)) {
    const prev = out.at(-1)!;
    const word = text.slice(t.coreStart, t.coreEnd);
    const glued = prev && !prev.sep && prev.end === t.start;
    if (
      glued &&
      /^#?\p{L}-?\d*$/u.test(prev.text) &&
      /^#?\p{L}-?\d*\p{L}?$/u.test(prev.text + word)
    ) {
      prev.text += word;
      prev.n = norm(prev.text);
      prev.end = t.coreEnd;
      prev.sep = t.end > t.coreEnd;
      continue;
    }
    out.push({
      text: word,
      n: norm(word),
      start: t.coreStart,
      end: t.coreEnd,
      sep: t.end > t.coreEnd,
    });
  }
  return out;
}

/** Parts covering `text`, with each word's label and the text between words unlabeled. */
export function toWordParts(text: string, ws: readonly Word[], labels: readonly Label[]): Part[] {
  const parts: Part[] = [];
  let at = 0;
  let k = 0;
  while (k < ws.length) {
    // Same-label words with only a space between them form one span.
    let j = k;
    while (
      j + 1 < ws.length &&
      labels[j + 1] === labels[k] &&
      !ws[j]!.sep &&
      /^ *$/.test(text.slice(ws[j]!.end, ws[j + 1]!.start))
    ) {
      j++;
    }
    if (ws[k]!.start > at) parts.push(text.slice(at, ws[k]!.start));
    parts.push([text.slice(ws[k]!.start, ws[j]!.end), labels[k]!]);
    at = ws[j]!.end;
    k = j + 1;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

export const STATE_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    alabama: "al",
    alaska: "ak",
    arizona: "az",
    arkansas: "ar",
    california: "ca",
    colorado: "co",
    connecticut: "ct",
    delaware: "de",
    "district of columbia": "dc",
    florida: "fl",
    georgia: "ga",
    hawaii: "hi",
    idaho: "id",
    illinois: "il",
    indiana: "in",
    iowa: "ia",
    kansas: "ks",
    kentucky: "ky",
    louisiana: "la",
    maine: "me",
    maryland: "md",
    massachusetts: "ma",
    michigan: "mi",
    minnesota: "mn",
    mississippi: "ms",
    missouri: "mo",
    montana: "mt",
    nebraska: "ne",
    nevada: "nv",
    "new hampshire": "nh",
    "new jersey": "nj",
    "new mexico": "nm",
    "new york": "ny",
    "north carolina": "nc",
    "north dakota": "nd",
    ohio: "oh",
    oklahoma: "ok",
    oregon: "or",
    pennsylvania: "pa",
    "rhode island": "ri",
    "south carolina": "sc",
    "south dakota": "sd",
    tennessee: "tn",
    texas: "tx",
    utah: "ut",
    vermont: "vt",
    virginia: "va",
    washington: "wa",
    "west virginia": "wv",
    wisconsin: "wi",
    wyoming: "wy",
    "puerto rico": "pr",
    guam: "gu",
    "virgin islands": "vi",
    "american samoa": "as",
  }),
);

/** States whose ZIP codes start with 0, so a ZIP read as a number loses a digit. */
const ZERO_ZIP_STATES: ReadonlySet<string> = new Set([
  ...["ct", "ma", "me", "nh", "nj", "ri", "vt", "pr", "vi"],
]);

/** Field values that say there is no value. */
const NO_VALUE =
  /^(n\/?a|no|none|unknown|unk|not provided|not available|not applicable|same|same as above|\?+|-+|0|x+|tbd|#n\/a|null|requested|info requested|refused)$/i;

export const isNoValue = (s: string) => NO_VALUE.test(s.trim().replace(/\.$/, ""));

const ZIP = /^\d{5}(-?\d{4})?$/;

/** The ZIP field: a ZIP code, a ZIP missing its leading 0, "USA", or a placeholder. */
export function labelZip(zip: string, state: string | undefined): Label | undefined {
  if (ZIP.test(zip)) return "ZipCode";
  if (/^\d{4}(-\d{4})?$/.test(zip) && state && ZERO_ZIP_STATES.has(stateCode(state) ?? "")) {
    return "ZipCode";
  }
  if (/^(usa|us|united states)$/i.test(zip)) return "CountryName";
  // A mistyped ZIP is still the ZIP: "9080", "995203", "99501`", "99,501.00".
  if (/^[\d,.`'-]+$/.test(zip) && (zip.match(/\d/g)?.length ?? 0) >= 3 && /^\d/.test(zip)) {
    return "ZipCode";
  }
  if (isNoValue(zip) || /^\$[\d,.]+$/.test(zip)) return "NotAddress";
  return undefined;
}

export function stateCode(s: string): string | undefined {
  const n = s.toLowerCase().replace(/\./g, "").trim();
  if (STATE_CODES.has(n)) return n;
  return STATE_NAMES.get(n);
}

/** A place name: letters, with spaces, periods, apostrophes and hyphens between words. */
const PLACE = /^\p{L}[\p{L}'’.]*(?:[ -]+\p{L}[\p{L}'’.]*)*\.?$/u;

/**
 * The city field: a place name, or a place followed by its state and maybe ZIP ("SEWARD, AK
 * 99664", "Wasilla ak"), as parts. Undefined for anything else.
 */
export function labelCity(city: string, state: string): Part[] | undefined {
  if (isNoValue(city)) return [[city, "NotAddress"]];
  // The state written after the city: its code, or the name of the state in the state field.
  const code = stateCode(state);
  const st = /^(.+\p{L}\.?)(,? +)(\p{L}[\p{L} .]*)$/u.exec(city);
  if (code && st && PLACE.test(st[1]!) && stateCode(st[3]!) === code) {
    return [[st[1]!, "PlaceName"], st[2]!, [st[3]!, "StateName"]];
  }
  // A state name is a city too ("New York", "Washington"); a state code isn't.
  if (PLACE.test(city) && !/^\p{L}{2}$/u.test(city)) return [[city, "PlaceName"]];
  const m = /^(.*?\p{L}\.?)(,? +)(\p{L}[\p{L} .]*?)(?:(,? +)(\d{5}(?:-\d{4})?))?$/u.exec(city);
  if (!m) return undefined;
  const [, place, sep, written, sep2, zip] = m;
  if (!PLACE.test(place!) || !stateCode(written!)) return undefined;
  const parts: Part[] = [[place!, "PlaceName"], sep!, [written!, "StateName"]];
  if (zip) parts.push(sep2!, [zip, "ZipCode"]);
  return parts;
}

/** Occupancy designators that rarely start anything else on an address line. */
const UNIT_WORDS: ReadonlySet<string> = new Set(
  [...OCCUPANCY_TYPES].filter(
    (w) =>
      ![
        ...["no", "number", "side", "front", "rear", "upper", "lower", "uppr", "lowr", "stop"],
        ...["pier", "slip", "level", "lvl", "lev", "levl", "lvel", "story", "piso", "u", "un"],
        ...["door", "flat", "flt", "ap", "dept", "department", "office", "ofc", "offc", "lobby"],
        ...["lbby", "upstairs", "downstairs", "cellar", "mezzanine", "mezz", "ug", "ugf", "ugfl"],
        ...["gf", "gdfl", "tf", "lg", "pb", "bajo", "bajos", "bjs", "sótano", "sotano", "nr"],
        ...["nbr", "nmbr", "num", "№", "nº", "platform", "pf", "hangar", "hngr", "ph"],
      ].includes(w),
  ),
);

const PO_WORDS: ReadonlySet<string> = new Set(["p", "o", "po", "p.o", "p o", "post", "office"]);
const BOX_WORDS: ReadonlySet<string> = new Set(["box", "bx", "pob", "drawer"]);
const ROUTE_WORDS: ReadonlySet<string> = new Set(["hc", "hcr", "rr", "psc", "cmr"]);

const isId = (w: string) => /^#?(\d+[a-z]?|[a-z]\d*|\d+-\d+|[a-z]-?\d+|\d+-?[a-z])$/i.test(w);
const isUnitId = (w: string) => isId(w) && w.length <= 6;
/** A word of a street name: letters, or an ordinal ("4th", "33rd"). */
const isNameWord = (w: string) =>
  /^\p{L}[\p{L}'’.-]*$/u.test(w) || /^\d+(st|nd|rd|th)\.?$/i.test(w);

/** Words that mean the line has more than a street, unit and box. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  ...["and", "&", "c/o", "co", "attn", "attention", "care", "of", "mile", "mi", "mp", "milepost"],
  ...["block", "blk", "tract", "subdivision", "subd", "general", "delivery", "pmb", "box", "po"],
  ...["corner", "between", "near", "across", "behind", "off", "at", "the", "inc", "llc", "corp"],
]);

/**
 * Labels for one PO box segment ("PO Box 12", "P.O. Box #4", "Drawer H"), or undefined. Box
 * words come first, then one ID.
 */
function poBox(ws: readonly Word[]): Label[] | undefined {
  const k = ws.findIndex((w) => !PO_WORDS.has(w.n) && !BOX_WORDS.has(w.n) && w.n !== "#");
  if (k < 1 || k !== ws.length - 1) return undefined;
  if (!ws.slice(0, k).some((w) => BOX_WORDS.has(w.n) || w.n === "pob")) return undefined;
  if (!isId(ws[k]!.n) && !(/^[a-z]{1,3}$/.test(ws[k]!.n) && !STREET_SUFFIXES.has(ws[k]!.n))) {
    return undefined;
  }
  return ws.map((_, j) => (j < k ? "USPSBoxType" : "USPSBoxID"));
}

/** "HC 60 Box 12", "RR 2 Box 5", "HC 60" (its box in the next segment), or undefined. */
function route(ws: readonly Word[]): Label[] | undefined {
  if (!ROUTE_WORDS.has(ws[0]?.n ?? "") || !/^\d+$/.test(ws[1]?.n ?? "")) return undefined;
  if (ws.length === 2) return ["USPSBoxGroupType", "USPSBoxGroupID"];
  const rest = poBox(ws.slice(2));
  return rest && ["USPSBoxGroupType", "USPSBoxGroupID", ...rest];
}

/**
 * A unit ("Apt 4B", "Ste. 100", "#12", "Ste 3 # 133"): designators then an ID, repeated.
 * Designators are OccupancyType and IDs OccupancyIdentifier. Undefined unless every designator is
 * a known one and every ID is short.
 */
function unit(ws: readonly Word[]): Label[] | undefined {
  if (ws.length === 0 || ws.length > 5) return undefined;
  const labels: Label[] = [];
  let k = 0;
  while (k < ws.length) {
    const start = k;
    while (k < ws.length && (UNIT_WORDS.has(ws[k]!.n) || ws[k]!.n === "#")) {
      labels.push("OccupancyType");
      k++;
    }
    if (k === ws.length || (k === start && !ws[k]!.n.startsWith("#"))) return undefined;
    if (!isUnitId(ws[k]!.n)) return undefined;
    labels.push("OccupancyIdentifier");
    k++;
    // A letter and a number written apart are one ID ("Apt E 22").
    if (/^[a-z]$/.test(ws[k - 1]!.n) && /^\d+$/.test(ws[k]?.n ?? "")) {
      labels.push("OccupancyIdentifier");
      k++;
    }
  }
  return labels;
}

/** Notes from `refineRoad` on roads too ambiguous to label by rule. */
const REJECT_NOTES: ReadonlySet<string> = new Set([
  ...["road:lone-type-or-directional", "road:parenthetical", "road:directional-or-name"],
  ...["road:stacked-type", "road:split-directional"],
]);

/** Street types that are rarely a word of a name: one before the last word means two roads. */
const THOROUGHFARE_TYPES: ReadonlySet<string> = new Set([
  ...["st", "street", "rd", "road", "ave", "avenue", "av", "dr", "drive", "ln", "lane", "blvd"],
  ...["boulevard", "ct", "pl", "pkwy", "parkway", "hwy", "highway", "cir", "circle", "ter"],
]);

/** Spelled-out street types of 4+ letters: "spng" is too short a pattern to misspell. */
const LONG_SUFFIXES = [...STREET_SUFFIXES].filter(
  (s) => s.length >= 4 && /[aeiouy]/.test(s.slice(1)),
);

/**
 * Relabels the road's last name word as its type when it is one edit from a street type of 4+
 * letters with the same first letter ("Strreet", "Drivew", "Rosd"), as `src/data/gold.ts` does,
 * or a type with an "s" or a doubled letter ("Hwys", "Avve", "Rdd").
 */
function misspelledType(ws: readonly Word[], road: Label[]): void {
  if (hasType(road)) return;
  let j = road.length - 1;
  if (road[j] === "StreetNamePostDirectional") j--;
  if (j < 1 || road[j] !== "StreetName" || road[j - 1] !== "StreetName") return;
  const w = ws[j]!.n.replace(/\W+$/, "");
  if (w.length < 3 || !/^\p{L}+$/u.test(w)) return;
  const plural = /^(st|rd|ave|dr|ln|ct|hwy|blvd|cir|pl)s$/.test(w);
  const doubled = [...w].some(
    (c, i) => c === w[i - 1] && STREET_SUFFIXES.has(w.slice(0, i) + w.slice(i + 1)),
  );
  if (plural || doubled || LONG_SUFFIXES.some((s) => s[0] === w[0] && oneEditApart(w, s))) {
    road[j] = "StreetNamePostType";
  }
}

/**
 * Street types that are rarely the last word of a name. Other USPS suffixes ("Tree", "Park",
 * "Ridge", "View") end names that leave out their type often enough ("Lone Tree", "Wood Hall")
 * that a road ending in one goes to hand labeling.
 */
const COMMON_TYPES: ReadonlySet<string> = new Set([
  ...["st", "street", "str", "rd", "road", "ave", "avenue", "av", "dr", "drive", "ln", "lane"],
  ...["blvd", "boulevard", "blv", "ct", "court", "crt", "pl", "place", "pkwy", "parkway", "pky"],
  ...["hwy", "highway", "hw", "cir", "circle", "cr", "ci", "circ", "way", "wy", "loop", "lp"],
  ...["trl", "trail", "tr", "ter", "terrace", "terr", "run", "cove", "cv", "spur", "alley", "aly"],
  ...["path", "plaza", "plz", "sq", "square", "pike", "expy", "expressway", "freeway", "fwy"],
  ...["tpke", "turnpike", "ext", "extension", "xing", "crossing", "row", "bend", "mall", "walk"],
]);
const LONG_COMMON_TYPES = [...COMMON_TYPES].filter((s) => s.length >= 4);

/** A common type, or a misspelling or truncation of one ("Stree", "Circel", "Rdd", "Hwys"). */
function commonTypeLike(w: string): boolean {
  if (COMMON_TYPES.has(w)) return true;
  if (/^(st|rd|ave|dr|ln|ct|hwy|blvd|cir|pl)s$/.test(w)) return true;
  if ([...w].some((c, i) => c === w[i - 1] && COMMON_TYPES.has(w.slice(0, i) + w.slice(i + 1)))) {
    return true;
  }
  if (STREET_SUFFIXES.has(w) || REAL_WORDS.has(w)) return false;
  // Same-length typos of 4 letters are often words ("Lake", "Line", "Look" for Lane and Loop).
  const typo = (s: string) => oneEditApart(w, s) && (w.length >= 5 || w.length !== s.length);
  return LONG_COMMON_TYPES.some(
    (s) => s[0] === w[0] && (typo(s) || (w.length >= 3 && s.startsWith(w))),
  );
}

/** Words one edit from a common type that end street names as themselves. */
const REAL_WORDS: ReadonlySet<string> = new Set([
  ...["lance", "patch", "drove", "cover", "rod", "plane", "placer", "palace", "playa", "plata"],
  ...["mail", "wall", "read", "dive", "trial", "roar", "rider", "driver", "pie", "cone", "coury"],
]);

/** One edit from any street type, or a truncation of one. */
function typeLike(w: string): boolean {
  for (const s of STREET_SUFFIXES) {
    if (s.length >= 3 && (oneEditApart(w, s) || (s.startsWith(w) && w.length >= 3))) return true;
  }
  return false;
}

/** Whether the road has a street type, before or after its name. */
function hasType(road: readonly Label[]): boolean {
  return road.includes("StreetNamePostType") || road.includes("StreetNamePreType");
}

/**
 * A street segment: house number, road, then an optional unit ("123 N Main St Apt 4", "500 L St
 * 2B"). The road must end in a street type (with a directional after it) or be one or two name
 * words with nothing after them ("170 North Birch", "2867 Alderberry").
 */
function street(ws: readonly Word[]): Label[] | undefined {
  if (ws.length < 2) return undefined;
  let k = 0;
  const house: Word[] = [];
  if (/^\d+[a-z]?$|^\d+-\d+$/.test(ws[0]!.n)) {
    house.push(ws[0]!);
    k = 1;
    if (/^\d\/\d$|^[¼½¾]$/.test(ws[1]?.n ?? "")) house.push(ws[k++]!);
  } else {
    return undefined;
  }
  // A letter between the number and a street name with a type is the number's suffix ("619 A
  // Hillcrest Dr"); right before the type it is the name ("1600 A St").
  let suffix = false;
  if (/^[a-z]$/.test(ws[k]?.n ?? "") && !"nsew".includes(ws[k]!.n) && /^\d+$/.test(house[0]!.n)) {
    const after = ws.slice(k + 1).findIndex((w) => STREET_SUFFIXES.has(w.n) || UNIT_WORDS.has(w.n));
    if (after > 0 && isNameWord(ws[k + 1]!.n)) {
      house.push(ws[k++]!);
      suffix = true;
    }
  }
  // The unit starts at the first designator after the road.
  let u = ws.findIndex((w, j) => j > k + 1 && (UNIT_WORDS.has(w.n) || w.text.startsWith("#")));
  if (u === -1) u = ws.length;
  const roadWords = ws.slice(k, u);
  let unitWords = ws.slice(u);
  if (roadWords.some((w) => STOP_WORDS.has(w.n))) return undefined;
  if (roadWords.length === 0) return undefined;
  const notes: string[] = [];
  let road = refineRoad(
    roadWords.map((w) => w.text),
    notes,
  );
  if (notes.some((n) => REJECT_NOTES.has(n))) return undefined;
  // Anchorage's Northern Lights Blvd, written without its type: "Lights" is the name.
  const nl = roadWords.findIndex((w, j) => w.n === "lights" && roadWords[j - 1]?.n === "northern");
  if (nl > 0 && road[nl] === "StreetNamePostType") road[nl] = "StreetName";
  misspelledType(roadWords, road);
  if (!hasType(road) && unitWords.length === 0 && roadWords.length >= 2) {
    // A bare ID after the type is the unit ("Jamestown Drive B", "Sapphire Loop 12B").
    const last = roadWords.at(-1)!;
    const before = roadWords.slice(0, -1);
    const shorter = refineRoad(
      before.map((w) => w.text),
      [],
    );
    if (isUnitId(last.n) && /\d|^[a-z]$/.test(last.n) && hasType(shorter)) {
      road = shorter;
      unitWords = [last];
      roadWords.pop();
    }
  }
  // A type inside the name means two roads or a road and a place ("Wood Hall Drive Rabbit
  // Creek"); "St" first is Saint ("St Andrews Ct").
  const first = road.indexOf("StreetName");
  const typeInName = (w: Word, j: number) =>
    j < roadWords.length - 1 &&
    road[j] === "StreetName" &&
    THOROUGHFARE_TYPES.has(w.n) &&
    !(j === first && w.n === "st");
  if (roadWords.some(typeInName)) return undefined;
  // "No." is North or a number sign.
  if (roadWords.some((w) => w.n === "no")) return undefined;
  if (roadWords.some((w, j) => road[j] === "StreetName" && UNIT_WORDS.has(w.n))) return undefined;
  const post = road.indexOf("StreetNamePostType");
  if (post >= 0 && !commonTypeLike(roadWords[post]!.n.replace(/\W+$/, ""))) return undefined;
  const nameWords = roadWords.filter((_, j) => road[j] === "StreetName");
  if (nameWords.length === 0) return undefined;
  if (nameWords.length === 1 && /^[nsew]$/.test(nameWords[0]!.n)) return undefined;
  // A misspelt directional ("Wwest", "Noth") before the name.
  if (road[0] === "StreetName" && road.length > 2 && /^\p{L}{4,}$/u.test(roadWords[0]!.n)) {
    if (["north", "south", "east", "west"].some((d) => oneEditApart(roadWords[0]!.n, d))) {
      road[0] = "StreetNamePreDirectional";
    }
  }
  if (road.includes("StreetNamePreType") && nameWords.length > 1) return undefined;
  if (!hasType(road)) {
    if (nameWords.length > 2 || roadWords.length > 3) return undefined;
    // A short or type-like last word may be a misspelt type ("Tony Dir", "Hialeah Dt.").
    const last = nameWords.at(-1)!.n;
    if (nameWords.length > 1 && (last.length <= 4 || typeLike(last))) return undefined;
    if (!nameWords.every((w) => /^\p{L}+$/u.test(w.n) || /^\d+(st|nd|rd|th)$/.test(w.n))) {
      return undefined;
    }
  } else if (
    !roadWords.every((w, j) => road[j] === "StreetNamePreType" || isNameWord(w.n) || isId(w.n))
  ) {
    return undefined;
  } else if (road.includes("StreetNamePreType")) {
    // Pre-typed roads have an ID-like name ("Hwy 3", "County Road 12"), checked by refine.
  } else if (!nameWords.every((w) => isNameWord(w.n))) {
    return undefined;
  }
  const unitLabels: Label[] =
    unitWords.length === 1 && !UNIT_WORDS.has(unitWords[0]!.n)
      ? isUnitId(unitWords[0]!.n)
        ? ["OccupancyIdentifier"]
        : []
      : (unit(unitWords) ?? []);
  if (unitLabels.length !== unitWords.length) return undefined;
  const houseLabels: Label[] = suffix
    ? ["AddressNumber", "AddressNumberSuffix"]
    : refineHouseNumber(
        house.map((w) => w.text),
        [],
      );
  return [...houseLabels, ...road, ...unitLabels];
}

/** Labels for one comma-separated segment of the address line, or undefined. */
function segment(ws: readonly Word[]): Label[] | undefined {
  return poBox(ws) ?? route(ws) ?? street(ws) ?? unit(ws) ?? streetThenBox(ws);
}

/** A street with a PO box after it and no comma between ("123 Main St PO Box 4"). */
function streetThenBox(ws: readonly Word[]): Label[] | undefined {
  const k = ws.findIndex((w, j) => j > 0 && (PO_WORDS.has(w.n) || BOX_WORDS.has(w.n)));
  if (k < 2) return undefined;
  const a = street(ws.slice(0, k)) ?? unit(ws.slice(0, k));
  const b = poBox(ws.slice(k));
  return a && b && [...a, ...b];
}

/** Labels for every word of the address line, or undefined. */
export function labelAddress(ws: readonly Word[]): Label[] | undefined {
  if (ws.some((w) => /[()[\]@]/.test(w.text))) return undefined;
  const out: Label[] = [];
  let start = 0;
  for (let k = 0; k < ws.length; k++) {
    if (!ws[k]!.sep && k < ws.length - 1) continue;
    const seg = ws.slice(start, k + 1);
    // An ID alone after the street is its unit ("4109 Lynn Drive, 118").
    const bareUnit = start > 0 && seg.length === 1 && isUnitId(seg[0]!.n) && /\d/.test(seg[0]!.n);
    const labels: Label[] | undefined = bareUnit ? ["OccupancyIdentifier"] : segment(seg);
    if (!labels) return undefined;
    out.push(...labels);
    start = k + 1;
  }
  return out;
}

/**
 * Labels for an address line that ends with its own locality, as the city, state and ZIP fields
 * give it ("PO Box 178 McGrath, AK 99627", "3705 Arctic Blvd Anchorage"), or undefined.
 */
export function labelWithLocality(
  ws: readonly Word[],
  city: string,
  state: string,
): Label[] | undefined {
  const tail: Label[] = [];
  let j = ws.length;
  if (j > 0 && /^\d{5}(-?\d{4})?$/.test(ws[j - 1]!.n)) {
    tail.unshift("ZipCode");
    j--;
  }
  const code = stateCode(state);
  for (let len = 3; len >= 1; len--) {
    if (j - len < 1) continue;
    const text = ws
      .slice(j - len, j)
      .map((w) => w.n)
      .join(" ");
    if (stateCode(text) && (!code || stateCode(text) === code)) {
      tail.unshift(...new Array<Label>(len).fill("StateName"));
      j -= len;
      break;
    }
  }
  const cityWords = words(city).map((w) => w.n);
  const n = cityWords.length;
  if (n > 0 && j - n >= 1 && ws.slice(j - n, j).every((w, i) => w.n === cityWords[i])) {
    tail.unshift(...new Array<Label>(n).fill("PlaceName"));
    j -= n;
  }
  if (tail.length === 0 || j === 0) return undefined;
  const head = labelAddress(ws.slice(0, j));
  return head && [...head, ...tail];
}
