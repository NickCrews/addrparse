import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLine } from "../src/data/libpostal.ts";
import {
  refine,
  refineOccupancy,
  refinePoBox,
  refineRoad,
  type RefineResult,
} from "../src/data/refine.ts";
import type { Label } from "../src/labels.ts";

const road = (s: string) => refineRoad(s.split(" "), []);

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
    const notes: string[] = [];
    assert.deepEqual(refineRoad(["West", "Morris", "Hill", "Ro"], notes), [
      "StreetNamePreDirectional",
      "StreetName",
      "StreetName",
      "StreetNamePostType",
    ]);
    assert.ok(notes.includes("road:truncated-suffix"));
  });

  it("keeps whole words that prefix a suffix as the name", () => {
    assert.deepEqual(road("N Green Bay"), ["StreetNamePreDirectional", "StreetName", "StreetName"]);
  });

  it("labels a lone word as the name and notes when it is a type or directional", () => {
    const notes: string[] = [];
    assert.deepEqual(refineRoad(["Broadway"], notes), ["StreetName"]);
    assert.deepEqual(notes, []);
    assert.deepEqual(refineRoad(["Boulevard"], notes), ["StreetName"]);
    assert.deepEqual(notes, ["road:lone-type-or-directional"]);
  });

  it("labels libpostal's abbreviated directionals and notes them", () => {
    const notes: string[] = [];
    assert.deepEqual(refineRoad(["Wst", "Higgins", "Av"], notes), [
      "StreetNamePreDirectional",
      "StreetName",
      "StreetNamePostType",
    ]);
    assert.ok(notes.includes("road:abbreviated-directional"));
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

describe("refineOccupancy", () => {
  it("labels leading designators as type and the rest as identifier", () => {
    assert.deepEqual(refineOccupancy(["Apt", "#", "4B"], []), [
      "OccupancyType",
      "OccupancyType",
      "OccupancyIdentifier",
    ]);
  });

  it("accepts libpostal's abbreviations as designators", () => {
    assert.deepEqual(refineOccupancy(["Aptmnt", "12"], []), [
      "OccupancyType",
      "OccupancyIdentifier",
    ]);
  });

  it("infers an unknown leading word as a designator and notes it", () => {
    const notes: string[] = [];
    assert.deepEqual(refineOccupancy(["Casa", "9"], notes), [
      "OccupancyType",
      "OccupancyIdentifier",
    ]);
    assert.deepEqual(notes, ["unit:inferred-type"]);
  });

  it("labels a level word after the identifier as type", () => {
    assert.deepEqual(refineOccupancy(["3rd", "Floor"], []), [
      "OccupancyIdentifier",
      "OccupancyType",
    ]);
    assert.deepEqual(refineOccupancy(["Ground", "Floor"], []), [
      "OccupancyIdentifier",
      "OccupancyType",
    ]);
  });

  it("notes a unit with no designator", () => {
    const notes: string[] = [];
    assert.deepEqual(refineOccupancy(["12"], notes), ["OccupancyIdentifier"]);
    assert.deepEqual(notes, ["unit:no-type"]);
  });
});

describe("refinePoBox", () => {
  it("splits the designator from the number", () => {
    assert.deepEqual(refinePoBox(["P.O.", "Box", "#", "12", "B"], []), [
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxID",
      "USPSBoxID",
    ]);
  });

  it("keeps single-letter designator words as type", () => {
    assert.deepEqual(refinePoBox(["P", "O", "B", "889"], []), [
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxID",
    ]);
  });

  it("takes a final letter as the ID when there is no number", () => {
    assert.deepEqual(refinePoBox(["P", "O", "B", "A"], []), [
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxType",
      "USPSBoxID",
    ]);
  });

  it("notes a box with no ID", () => {
    const notes: string[] = [];
    assert.deepEqual(refinePoBox(["P.O.", "Box"], notes), ["USPSBoxType", "USPSBoxType"]);
    assert.deepEqual(notes, ["po_box:no-id"]);
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
    const r = run("0/house_number UNKNOWN/road |/FSEP Kenai/city");
    assert.deepEqual(r.ok ? undefined : r.reason, "placeholder-road");
    assert.equal(run("NO/road SITUS/road").ok, false);
  });

  it("rejects non-Latin text in kept fields but not in dropped ones", () => {
    const r = run("Kenai/city ,/SEP アラスカ/state 州/state");
    assert.deepEqual(r.ok ? undefined : r.reason, "non-latin-script");
    assert.equal(ok("Kenai/city ,/SEP ケナイ/state_district ,/SEP AK/state").text, "Kenai, AK");
  });

  it("rejects an example with nothing left", () => {
    const r = run("Hotel/house");
    assert.deepEqual(r.ok ? undefined : r.reason, "empty");
  });

  it("rejects unknown libpostal labels", () => {
    const r = run("x/mystery");
    assert.deepEqual(r.ok ? undefined : r.reason, "unknown-label:mystery");
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
