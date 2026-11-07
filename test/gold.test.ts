import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  checkGold,
  GOLD_OVERRIDES_PATH,
  GoldIndex,
  oneEditApart,
  parseOverrides,
  resolveSpans,
} from "../src/data/gold.ts";
import type { Label } from "../src/labels.ts";
import type { Span } from "../src/types.ts";

/** An example from `[text, label]` pairs joined by `sep`. */
function ex(pairs: [string, Label][], sep = ", ") {
  const text = pairs.map(([t]) => t).join(sep);
  return { text, spans: resolveSpans(text, pairs) };
}

const pairsOf = (e: { text: string; spans: Span[] }) =>
  e.spans.map((s) => [e.text.slice(s.start, s.end), s.label]);

function indexOf(...examples: ReturnType<typeof ex>[]): GoldIndex {
  const index = new GoldIndex();
  for (const e of examples) index.add(e);
  return index;
}

describe("oneEditApart", () => {
  it("accepts one swap, insertion, deletion or substitution", () => {
    assert.ok(oneEditApart("raod", "road"));
    assert.ok(oneEditApart("circel", "circle"));
    assert.ok(oneEditApart("blvrd", "blvd"));
    assert.ok(oneEditApart("terace", "terrace"));
    assert.ok(oneEditApart("pewy", "pkwy"));
  });
  it("rejects equal words and two edits", () => {
    assert.ok(!oneEditApart("road", "road"));
    assert.ok(!oneEditApart("rdoa", "road"));
    assert.ok(!oneEditApart("boulavarde", "boulevard"));
  });
});

describe("resolveSpans", () => {
  it("finds each piece after the previous one", () => {
    const spans = resolveSpans("12 N 12th St", [
      ["12", "AddressNumber"],
      ["N", "StreetNamePreDirectional"],
      ["12th", "StreetName"],
    ]);
    assert.deepEqual(
      spans.map((s) => [s.start, s.end]),
      [
        [0, 2],
        [3, 4],
        [5, 9],
      ],
    );
  });
  it("matches whole words only", () => {
    const spans = resolveSpans("Raod R", [["R", "StreetNamePostType"]]);
    assert.deepEqual(spans[0], { start: 5, end: 6, label: "StreetNamePostType" });
  });
  it("throws when a piece is missing or out of order", () => {
    assert.throws(() => resolveSpans("Main St", [["Ave", "StreetNamePostType"]]));
    assert.throws(() =>
      resolveSpans("Main St", [
        ["St", "StreetNamePostType"],
        ["Main", "StreetName"],
      ]),
    );
  });
});

describe("parseOverrides", () => {
  const line = (o: object) => JSON.stringify({ key: "0123456789abcdef", text: "Main St", ...o });
  it("parses a fix and a reject", () => {
    const fix = line({
      spans: [
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
      ],
    });
    const reject = JSON.stringify({ key: "fedcba9876543210", text: "x", reject: "noise" });
    const m = parseOverrides(`${fix}\n\n${reject}\n`);
    assert.equal(m.size, 2);
    assert.equal(m.get("fedcba9876543210")?.reject, "noise");
  });
  it("rejects bad keys, labels, spans and duplicates", () => {
    assert.throws(() => parseOverrides(line({ key: "abc", reject: "x" })), /16 hex/);
    assert.throws(() => parseOverrides(line({ spans: [["Main", "Street"]] })), /unknown label/);
    assert.throws(() => parseOverrides(line({ spans: [["Elm", "StreetName"]] })), /not found/);
    assert.throws(
      () => parseOverrides(line({ spans: [["Main", "StreetName"]] })),
      /no span covers/,
    );
    assert.throws(() => parseOverrides(line({})), /exactly one/);
    const dup = line({ reject: "x" });
    assert.throws(() => parseOverrides(`${dup}\n${dup}`), /duplicate/);
    const other = JSON.stringify({ key: "fedcba9876543210", text: "Main St", reject: "x" });
    assert.throws(() => parseOverrides(`${dup}\n${other}`), /duplicate text/);
    assert.throws(() => parseOverrides("{"), /gold.jsonl:1/);
  });
  it("accepts overrides/gold.jsonl", () => {
    assert.ok(parseOverrides(readFileSync(GOLD_OVERRIDES_PATH, "utf8")).size > 0);
  });
});

describe("checkGold", () => {
  const empty = new GoldIndex();
  const road = (name: string, more: [string, Label][] = []) =>
    ex([["12", "AddressNumber"], [name, "StreetName"], ...more], " ");

  it("rejects a road ending in a type cut to D, R or L", () => {
    assert.equal(checkGold(road("Wilmont D"), empty).reject, "road:truncated-to-letter");
    assert.equal(checkGold(road("Ken Oak r."), empty).reject, "road:truncated-to-letter");
  });
  it("rejects a type word ending a longer name before the letter", () => {
    assert.equal(checkGold(road("Mallard Creek R"), empty).reject, "road:truncated-to-letter");
    assert.equal(checkGold(road("Casa Park Ct D"), empty).reject, "road:truncated-to-letter");
    assert.equal(checkGold(road("Beach R"), empty).reject, "road:truncated-to-letter");
  });
  it("keeps other final letters, lettered avenues, and typed roads", () => {
    assert.equal(checkGold(road("Windsor C"), empty).reject, undefined);
    assert.equal(checkGold(road("Avnu D"), empty).reject, undefined);
    const typed = road("Wilmont D", [["Ext", "StreetNamePostType"]]);
    assert.equal(checkGold(typed, empty).reject, undefined);
  });

  it("relabels a misspelled type that mostly ends street names", () => {
    const finals = ["Laurel", "Elm", "Oak", "Pine", "Ash", "Fir"].map((w) => road(`${w} Raod`));
    const index = indexOf(...finals, road("Raod Runner"));
    const check = checkGold(road("Maple Leaf Raod", [["N", "StreetNamePostDirectional"]]), index);
    assert.deepEqual(check.notes, ["road:misspelled-type"]);
    assert.deepEqual(pairsOf({ text: "12 Maple Leaf Raod N", spans: check.spans! }), [
      ["12", "AddressNumber"],
      ["Maple Leaf", "StreetName"],
      ["Raod", "StreetNamePostType"],
      ["N", "StreetNamePostDirectional"],
    ]);
  });
  it("keeps listed name words that pass the ratio", () => {
    const finals = ["Amber", "Oak", "Arrow", "Red", "Gold", "Fig"].map((w) => road(`${w} Leaf`));
    assert.deepEqual(checkGold(road("Amber Leaf"), indexOf(...finals)), { notes: [] });
  });
  it("keeps a word one edit from a type that is common elsewhere", () => {
    const index = indexOf(road("Oak Tree"), road("Tree Top"), road("Tree View"));
    assert.deepEqual(checkGold(road("Oak Tree"), index), { notes: [] });
  });

  const city = (name: string, zip = "92108") =>
    ex([
      [name, "PlaceName"],
      ["CA", "StateName"],
      [zip, "ZipCode"],
    ]);
  const sanDiego = Array.from({ length: 3 }, () => city("San Diego"));

  it("notes a city that abbreviates the common spelling in its ZIP", () => {
    const index = indexOf(...sanDiego, city("S Diego"));
    assert.deepEqual(checkGold(city("S Diego"), index).notes, ["city:abbreviated"]);
    assert.deepEqual(checkGold(city("San Diego"), index).notes, []);
    assert.deepEqual(checkGold(city("S Diego", "90001"), index).notes, []);
  });
  it("keeps a city whose letters merely occur in order in another", () => {
    const index = indexOf(...Array.from({ length: 3 }, () => city("Northville")));
    assert.deepEqual(checkGold(city("Novi"), index).notes, []);
    assert.deepEqual(checkGold(city("Nrthvll"), index).notes, ["city:abbreviated"]);
  });
  it("keeps USPS abbreviations and directionals", () => {
    const index = indexOf(
      ...Array.from({ length: 3 }, () => city("Fort Myers")),
      ...Array.from({ length: 3 }, () => city("South Gate")),
    );
    assert.deepEqual(checkGold(city("Ft Myers"), index).notes, []);
    assert.deepEqual(checkGold(city("S Gate"), index).notes, []);
  });
});
