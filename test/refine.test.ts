import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLine } from "../src/data/libpostal.ts";
import {
  refine,
  refineHouseNumber,
  refineOccupancy,
  refinePoBox,
  refineRoad,
  type RefineResult,
} from "../src/data/refine.ts";
import type { Label } from "../src/labels.ts";
import { labeledTokens, spansFromTokens, tokenize } from "../src/tokens.ts";

type Refiner = (tokens: readonly string[], notes: string[]) => Label[];
/** A refiner applied to space-separated tokens, returning their labels. */
const labelsOf = (refiner: Refiner) => (s: string) => refiner(s.split(" "), []);
const road = labelsOf(refineRoad);
const house = labelsOf(refineHouseNumber);
const unit = labelsOf(refineOccupancy);
const box = labelsOf(refinePoBox);
const notesOf = (refiner: Refiner, s: string) => {
  const notes: string[] = [];
  refiner(s.split(" "), notes);
  return notes;
};

/** Refines a libpostal tagged string, e.g. "12/house_number Main/road |/FSEP Kenai/city". */
function run(tagged: string, fieldSeparator = ", "): RefineResult {
  const line = parseLine(`en\tus\t${tagged}`);
  assert.ok(line);
  return refine(line.tokens, { fieldSeparator });
}

function ok(tagged: string, fieldSeparator = ", ") {
  const r = run(tagged, fieldSeparator);
  assert.ok(r.ok, `rejected: ${r.ok ? "" : r.reason}`);
  return r;
}

/** Why `tagged` is rejected, or undefined when it is accepted. */
function rejected(tagged: string) {
  const r = run(tagged);
  return r.ok ? undefined : r.reason;
}

/** Each span's text and label. */
function spans(tagged: string, fieldSeparator = ", "): [string, Label][] {
  const r = ok(tagged, fieldSeparator);
  return r.spans.map((s) => [r.text.slice(s.start, s.end), s.label]);
}

describe("refineRoad", () => {
  it("labels a pre-directional, name and post-type", () => {
    assert.deepEqual(road("N Main St"), [
      "StreetNamePreDirectional",
      "StreetName",
      "StreetNamePostType",
    ]);
  });

  it("labels a post-directional after the post-type", () => {
    assert.deepEqual(road("Main St NE"), [
      "StreetName",
      "StreetNamePostType",
      "StreetNamePostDirectional",
    ]);
  });

  it("keeps a directional as the name when only a type follows it", () => {
    assert.deepEqual(road("North Rd"), ["StreetName", "StreetNamePostType"]);
  });

  it("labels a qualified pre-type before a number", () => {
    assert.deepEqual(road("County Road 1147"), [
      "StreetNamePreType",
      "StreetNamePreType",
      "StreetName",
    ]);
  });

  it("labels a standalone pre-type before a number", () => {
    assert.deepEqual(road("Highway 9"), ["StreetNamePreType", "StreetName"]);
  });

  it("labels dotted county-road abbreviations as one pre-type", () => {
    assert.deepEqual(road("C.R. 265"), ["StreetNamePreType", "StreetName"]);
    assert.deepEqual(road("CO.RD 446"), ["StreetNamePreType", "StreetName"]);
  });

  it("labels a state code before a pre-type as part of it", () => {
    assert.deepEqual(road("VT ROUTE 12"), ["StreetNamePreType", "StreetNamePreType", "StreetName"]);
  });

  it("labels a pre-type road's directionals and post-type", () => {
    assert.deepEqual(road("N Highway 9 W"), [
      "StreetNamePreDirectional",
      "StreetNamePreType",
      "StreetName",
      "StreetNamePostDirectional",
    ]);
    assert.deepEqual(road("FM 1960 Rd"), ["StreetNamePreType", "StreetName", "StreetNamePostType"]);
  });

  it("labels the letter after a pre-type as the name even when it is a directional", () => {
    assert.deepEqual(road("Avenue N"), ["StreetNamePreType", "StreetName"]);
    assert.deepEqual(road("W Avenue S"), [
      "StreetNamePreDirectional",
      "StreetNamePreType",
      "StreetName",
    ]);
  });

  it("treats NE before a number as a directional, not Nebraska", () => {
    assert.deepEqual(road("NE 23"), ["StreetNamePreDirectional", "StreetName"]);
  });

  it("does not treat a pre-type word followed by a name as a pre-type", () => {
    assert.deepEqual(road("Park Ave"), ["StreetName", "StreetNamePostType"]);
    assert.deepEqual(road("Avenue of the Americas"), new Array(4).fill("StreetName"));
  });

  it("labels a truncated suffix as the post-type and notes it", () => {
    assert.deepEqual(road("West Morris Hill Ro"), [
      "StreetNamePreDirectional",
      "StreetName",
      "StreetName",
      "StreetNamePostType",
    ]);
    assert.ok(notesOf(refineRoad, "West Morris Hill Ro").includes("road:truncated-suffix"));
  });

  it("keeps whole words that prefix a suffix as the name", () => {
    assert.deepEqual(road("N Green Bay"), ["StreetNamePreDirectional", "StreetName", "StreetName"]);
  });

  it("labels a lone word as the name and notes when it is a type or directional", () => {
    assert.deepEqual(road("Broadway"), ["StreetName"]);
    assert.deepEqual(notesOf(refineRoad, "Broadway"), []);
    assert.deepEqual(road("Boulevard"), ["StreetName"]);
    assert.deepEqual(notesOf(refineRoad, "Boulevard"), ["road:lone-type-or-directional"]);
  });

  it("labels libpostal's abbreviated directionals and notes them", () => {
    assert.deepEqual(road("Wst Higgins Av"), [
      "StreetNamePreDirectional",
      "StreetName",
      "StreetNamePostType",
    ]);
    assert.ok(notesOf(refineRoad, "Wst Higgins Av").includes("road:abbreviated-directional"));
    assert.deepEqual(road("14th Street Nthwst"), [
      "StreetName",
      "StreetNamePostType",
      "StreetNamePostDirectional",
    ]);
  });

  it("labels a compound directional split into two tokens", () => {
    assert.deepEqual(road("Observatory Pl Nrth W"), [
      "StreetName",
      "StreetNamePostType",
      "StreetNamePostDirectional",
      "StreetNamePostDirectional",
    ]);
  });
});

describe("refineRoad: ambiguous splits", () => {
  it("labels a split compound directional before a word name as the directional", () => {
    assert.deepEqual(road("S West Temple St"), [
      "StreetNamePreDirectional",
      "StreetNamePreDirectional",
      "StreetName",
      "StreetNamePostType",
    ]);
    assert.ok(notesOf(refineRoad, "S West Temple St").includes("road:split-directional"));
  });

  it("labels a road of two directionals as a pre-directional and a name, and notes it", () => {
    assert.deepEqual(road("E NRTH"), ["StreetNamePreDirectional", "StreetName"]);
    assert.ok(notesOf(refineRoad, "E North").includes("road:directional-or-name"));
  });

  it("labels Old before a pre-typed road as the pre-modifier", () => {
    assert.deepEqual(road("Old Hwy 9"), [
      "StreetNamePreModifier",
      "StreetNamePreType",
      "StreetName",
    ]);
    assert.deepEqual(road("OLD STATE RD 56"), [
      "StreetNamePreModifier",
      "StreetNamePreType",
      "StreetNamePreType",
      "StreetName",
    ]);
    assert.deepEqual(road("N Old Hwy 9 S"), [
      "StreetNamePreDirectional",
      "StreetNamePreModifier",
      "StreetNamePreType",
      "StreetName",
      "StreetNamePostDirectional",
    ]);
  });

  it("keeps Old in the name when no pre-typed road follows", () => {
    assert.deepEqual(road("Old Mill Rd"), ["StreetName", "StreetName", "StreetNamePostType"]);
    assert.deepEqual(road("Old Hwy"), ["StreetName", "StreetNamePostType"]);
  });

  it("labels Spanish pre-types before a number", () => {
    assert.deepEqual(road("Calle 9"), ["StreetNamePreType", "StreetName"]);
    assert.deepEqual(road("Carr 2"), ["StreetNamePreType", "StreetName"]);
  });

  it("keeps a leading type in the name before a word and notes it", () => {
    assert.deepEqual(road("Calle Real"), ["StreetName", "StreetName"]);
    assert.ok(notesOf(refineRoad, "Calle Real").includes("road:leading-type-in-name"));
    assert.ok(notesOf(refineRoad, "Avenue of the Americas").includes("road:leading-type-in-name"));
  });

  it("labels a letter-digit route number as the name", () => {
    assert.deepEqual(road("Highway A1A"), ["StreetNamePreType", "StreetName"]);
  });

  it("labels I H and U S as one pre-type", () => {
    assert.deepEqual(road("S I H 20"), [
      "StreetNamePreDirectional",
      "StreetNamePreType",
      "StreetNamePreType",
      "StreetName",
    ]);
    assert.deepEqual(road("U S 9"), ["StreetNamePreType", "StreetNamePreType", "StreetName"]);
    assert.deepEqual(road("U S Hwy 9"), [
      "StreetNamePreType",
      "StreetNamePreType",
      "StreetNamePreType",
      "StreetName",
    ]);
  });

  it("labels only the last of stacked types as the post-type", () => {
    assert.deepEqual(road("Village Gn Dr"), ["StreetName", "StreetName", "StreetNamePostType"]);
    assert.deepEqual(road("Bay St Ext"), ["StreetName", "StreetName", "StreetNamePostType"]);
    assert.ok(notesOf(refineRoad, "Bay St Ext").includes("road:stacked-type"));
    assert.ok(!notesOf(refineRoad, "Mill Creek Rd").includes("road:stacked-type"));
  });

  it("labels a directional after stacked types as the post-directional", () => {
    assert.deepEqual(road("Main Street Sth"), [
      "StreetName",
      "StreetNamePostType",
      "StreetNamePostDirectional",
    ]);
  });
});

describe("refineHouseNumber", () => {
  it("labels a separate letter or fraction after the number as the suffix", () => {
    assert.deepEqual(house("1833 B"), ["AddressNumber", "AddressNumberSuffix"]);
    assert.deepEqual(house("5157 1 / 2"), [
      "AddressNumber",
      "AddressNumberSuffix",
      "AddressNumberSuffix",
      "AddressNumberSuffix",
    ]);
    assert.deepEqual(house("1203 C2"), ["AddressNumber", "AddressNumberSuffix"]);
  });

  it("labels a unicode fraction as the suffix", () => {
    assert.deepEqual(house("5218 ½"), ["AddressNumber", "AddressNumberSuffix"]);
  });

  it("labels N, S, E or W after the number as the road's pre-directional, and notes it", () => {
    assert.deepEqual(house("680 E"), ["AddressNumber", "StreetNamePreDirectional"]);
    assert.deepEqual(notesOf(refineHouseNumber, "680 E"), ["house_number:directional"]);
  });

  it("keeps attached suffixes, ranges and words in the number", () => {
    assert.deepEqual(house("193E"), ["AddressNumber"]);
    assert.deepEqual(house("125 / 127"), new Array(3).fill("AddressNumber"));
    assert.deepEqual(house("Nº 3033"), ["AddressNumber", "AddressNumber"]);
    assert.deepEqual(house("404 Rear"), ["AddressNumber", "AddressNumber"]);
  });
});

describe("refineOccupancy", () => {
  it("labels leading designators as type and the rest as identifier", () => {
    assert.deepEqual(unit("Apt # 4B"), ["OccupancyType", "OccupancyType", "OccupancyIdentifier"]);
  });

  it("accepts libpostal's abbreviations as designators", () => {
    assert.deepEqual(unit("Aptmnt 12"), ["OccupancyType", "OccupancyIdentifier"]);
  });

  it("infers an unknown leading word as a designator and notes it", () => {
    assert.deepEqual(unit("Casa 9"), ["OccupancyType", "OccupancyIdentifier"]);
    assert.deepEqual(notesOf(refineOccupancy, "Casa 9"), ["unit:inferred-type"]);
  });

  it("labels a level word after the identifier as type", () => {
    assert.deepEqual(unit("3rd Floor"), ["OccupancyIdentifier", "OccupancyType"]);
    assert.deepEqual(unit("Ground Floor"), ["OccupancyIdentifier", "OccupancyType"]);
  });

  it("splits Hong Kong floor notation into identifier and type, and notes it", () => {
    assert.deepEqual(unit("9 / F"), ["OccupancyIdentifier", "OccupancyType", "OccupancyType"]);
    assert.deepEqual(notesOf(refineOccupancy, "9 / F"), ["unit:slash-level"]);
    assert.deepEqual(unit("G / F"), ["OccupancyIdentifier", "OccupancyType", "OccupancyType"]);
    assert.deepEqual(unit("Gd / Fl"), ["OccupancyIdentifier", "OccupancyType", "OccupancyType"]);
  });

  it("labels levels that take no number as type", () => {
    for (const s of ["Basement", "Upstairs", "Cellar", "Gf", "Ug", "Ugfl", "Lg", "Tf", "Bajos"]) {
      assert.deepEqual(unit(s), ["OccupancyType"], s);
    }
    assert.deepEqual(unit("Sub Basement"), ["OccupancyType", "OccupancyType"]);
  });

  it("labels a platform after its number as the type", () => {
    assert.deepEqual(unit("4th Platform"), ["OccupancyIdentifier", "OccupancyType"]);
  });

  it("labels Upper or Lower before a level name as part of the identifier", () => {
    assert.deepEqual(unit("Upper Ground Floor"), [
      "OccupancyIdentifier",
      "OccupancyIdentifier",
      "OccupancyType",
    ]);
    assert.deepEqual(unit("Lower Level"), ["OccupancyType", "OccupancyType"]);
  });

  it("notes a unit with no designator", () => {
    assert.deepEqual(unit("12"), ["OccupancyIdentifier"]);
    assert.deepEqual(notesOf(refineOccupancy, "12"), ["unit:no-type"]);
  });
});

describe("refinePoBox", () => {
  it("splits the designator from the number", () => {
    assert.deepEqual(box("P.O. Box # 12 B"), [
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxID",
      "USPSBoxID",
    ]);
  });

  it("keeps single-letter designator words as type", () => {
    assert.deepEqual(box("P O B 889"), ["USPSBoxType", "USPSBoxType", "USPSBoxType", "USPSBoxID"]);
  });

  it("takes a final letter as the ID when there is no number", () => {
    assert.deepEqual(box("P O B A"), ["USPSBoxType", "USPSBoxType", "USPSBoxType", "USPSBoxID"]);
  });

  it("splits a box on a route into route and box", () => {
    assert.deepEqual(box("RR 2 Box 5A"), [
      "USPSBoxGroupType",
      "USPSBoxGroupID",
      "USPSBoxType",
      "USPSBoxID",
    ]);
    assert.deepEqual(box("Rural Route 2, Box # 5"), [
      "USPSBoxGroupType",
      "USPSBoxGroupType",
      "USPSBoxGroupID",
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxID",
    ]);
  });

  it("notes a box with no ID", () => {
    assert.deepEqual(box("P.O. Box"), ["USPSBoxType", "USPSBoxType"]);
    assert.deepEqual(notesOf(refinePoBox, "P.O. Box"), ["po_box:no-id"]);
  });
});

describe("refine", () => {
  it("renders field breaks with the field separator and literal separators as written", () => {
    const tagged =
      "12/house_number Main/road St/road |/FSEP Kenai/city ,/SEP AK/state 99611/postcode";
    assert.equal(ok(tagged).text, "12 Main St, Kenai, AK 99611");
    assert.equal(ok(tagged, " ").text, "12 Main St Kenai, AK 99611");
  });

  it("produces spans whose offsets select their tokens", () => {
    assert.deepEqual(
      spans("12/house_number N/road Main/road St/road |/FSEP Kenai/city ,/SEP AK/state"),
      [
        ["12", "AddressNumber"],
        ["N", "StreetNamePreDirectional"],
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
        ["Kenai", "PlaceName"],
        ["AK", "StateName"],
      ],
    );
  });

  it("merges a multi-token field into one span", () => {
    assert.deepEqual(spans("San/city Diego/city ,/SEP CA/state"), [
      ["San Diego", "PlaceName"],
      ["CA", "StateName"],
    ]);
  });

  it("does not merge same-label tokens across a separator", () => {
    assert.deepEqual(spans("Kansas/city |/FSEP City/city", " "), [
      ["Kansas", "PlaceName"],
      ["City", "PlaceName"],
    ]);
  });

  it("renders a comma between fields whose same-label tokens would touch", () => {
    const tagged = "4th/level Fl/level |/FSEP Apt/unit 3/unit |/FSEP Kenai/city";
    const r = ok(tagged, " ");
    assert.equal(r.text, "4th Fl, Apt 3 Kenai");
    assert.ok(r.notes.includes("render:comma-between-fields"));
    assert.deepEqual(spans(tagged, " ").slice(0, 4), [
      ["4th", "OccupancyIdentifier"],
      ["Fl", "OccupancyType"],
      ["Apt", "OccupancyType"],
      ["3", "OccupancyIdentifier"],
    ]);
    assert.equal(ok("Fl/level 7/level |/FSEP Apt/unit 3/unit", " ").text, "Fl 7 Apt 3");
    assert.equal(ok(tagged).text, "4th Fl, Apt 3, Kenai");
    assert.equal(ok("4th/level Fl/level ;/SEP Apt/unit 3/unit", " ").text, "4th Fl; Apt 3");
  });

  it("produces gold spans that per-token labels reproduce", () => {
    const lines = [
      "4th/level Fl/level |/FSEP Apt/unit 3/unit |/FSEP Kenai/city",
      "Upper/level Ground/level Floor/level |/FSEP Basement/unit |/FSEP Kenai/city",
      "1833/house_number B/house_number Old/road Hwy/road 9/road |/FSEP Kenai/city",
      "680/house_number E/house_number E/road Main/road St/road",
      "2/level //level F/level |/FSEP #/unit 3/unit",
    ];
    for (const sep of [", ", " "]) {
      for (const tagged of lines) {
        const r = ok(tagged, sep);
        const ex = { id: "", text: r.text, spans: r.spans, source: "" };
        const labels = labeledTokens(ex).map((t) => t.label);
        assert.deepEqual(spansFromTokens(tokenize(r.text), labels), r.spans, r.text);
      }
    }
  });

  it("labels house number suffixes", () => {
    assert.deepEqual(spans("1833/house_number B/house_number Main/road St/road"), [
      ["1833", "AddressNumber"],
      ["B", "AddressNumberSuffix"],
      ["Main", "StreetName"],
      ["St", "StreetNamePostType"],
    ]);
  });

  it("rejects venue names tagged as the city", () => {
    assert.equal(
      rejected("12/house_number Main/road |/FSEP Comfort/city Inn/city Fruita/city ,/SEP CO/state"),
      "venue-as-city",
    );
    assert.ok(ok("Fountain/city Inn/city ,/SEP SC/state").ok);
  });

  it("drops removed fields and collapses the separators around them", () => {
    const r = ok(
      "12/house_number Main/road |/FSEP Midtown/suburb |/FSEP Kenai/city ,/SEP Kenai/state_district ,/SEP AK/state",
    );
    assert.equal(r.text, "12 Main, Kenai, AK");
    assert.ok(r.notes.includes("dropped:suburb"));
    assert.ok(r.notes.includes("dropped:state_district"));
  });

  it("never renders separators at the start or end", () => {
    assert.equal(ok("Hotel/house |/FSEP Kenai/city ,/SEP Borough/state_district").text, "Kenai");
  });

  it("prefers a literal separator over a field break", () => {
    assert.equal(ok("Kenai/city |/FSEP ,/SEP AK/state", " ").text, "Kenai, AK");
  });

  it("labels category and near as NotAddress", () => {
    assert.deepEqual(spans("cafes/category near/near Kenai/city"), [
      ["cafes near", "NotAddress"],
      ["Kenai", "PlaceName"],
    ]);
  });

  it("rejects placeholder roads", () => {
    assert.equal(rejected("0/house_number UNKNOWN/road |/FSEP Kenai/city"), "placeholder-road");
    assert.equal(run("NO/road SITUS/road").ok, false);
  });

  it("rejects non-Latin text in kept fields but not in dropped ones", () => {
    assert.equal(rejected("Kenai/city ,/SEP アラスカ/state 州/state"), "non-latin-script");
    assert.equal(ok("Kenai/city ,/SEP ケナイ/state_district ,/SEP AK/state").text, "Kenai, AK");
  });

  it("rejects an example with nothing left", () => {
    assert.equal(rejected("Hotel/house"), "empty");
  });

  it("rejects unknown libpostal labels", () => {
    assert.equal(rejected("x/mystery"), "unknown-label:mystery");
  });

  it("notes translated state and country names", () => {
    const notes = ok("Kenai/city ,/SEP Alaska/state |/FSEP Estados/country Unidos/country").notes;
    assert.ok(notes.includes("country:non-english"));
    assert.ok(!notes.includes("state:non-english"));
    assert.ok(ok("Fresno/city ,/SEP Kalifornien/state").notes.includes("state:non-english"));
    assert.ok(!ok("Fresno/city ,/SEP N./state Y./state").notes.includes("state:non-english"));
  });

  it("notes words inside house numbers and postcodes", () => {
    assert.ok(
      ok("Número/house_number 51/house_number Main/road").notes.includes("house_number:has-word"),
    );
    assert.ok(
      !ok("12/house_number B/house_number Main/road").notes.includes("house_number:has-word"),
    );
    assert.ok(ok("Kenai/city Cp/postcode 99611/postcode").notes.includes("postcode:has-word"));
  });
});
