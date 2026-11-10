import assert from "node:assert/strict";
import { test } from "node:test";
import { NOISE_NAMES } from "../src/data/noise.ts";
import {
  countMix,
  dimension,
  DIMENSIONS,
  kindOf,
  NOISE_FAMILIES,
  stateOf,
  stateOfZip,
} from "../src/eval/dimensions.ts";
import { SLICES, slicesOf } from "../src/eval/slices.ts";
import { wilson } from "../src/eval/stats.ts";
import type { Example } from "../src/types.ts";
import { example } from "./helpers.ts";

const street = example("123 Main St, Kenai, AK 99611", [
  ["123", "AddressNumber"],
  ["Main", "StreetName"],
  ["St", "StreetNamePostType"],
  ["Kenai", "PlaceName"],
  ["AK", "StateName"],
  ["99611", "ZipCode"],
]);
const route = example("RR 2 Box 5, Ames, Iowa", [
  ["RR", "USPSBoxGroupType"],
  ["2", "USPSBoxGroupID"],
  ["Box", "USPSBoxType"],
  ["5", "USPSBoxID"],
  ["Ames", "PlaceName"],
  ["Iowa", "StateName"],
]);
const military = example("PSC 1234 Box 5, APO AE 09204", [
  ["PSC", "USPSBoxGroupType"],
  ["1234", "USPSBoxGroupID"],
  ["Box", "USPSBoxType"],
  ["5", "USPSBoxID"],
  ["APO", "PlaceName"],
  ["AE", "StateName"],
  ["09204", "ZipCode"],
]);
const hc = example("HCR 1 Box 45", [
  ["HCR", "USPSBoxGroupType"],
  ["1", "USPSBoxGroupID"],
  ["Box", "USPSBoxType"],
  ["45", "USPSBoxID"],
]);
const junk: Example = { ...example("N/A", [["N/A", "NotAddress"]]), noise: ["uppercase"] };
const embedded = example("Attn Jo, PO Box 9, thanks", [
  ["Attn Jo", "Recipient"],
  ["PO Box", "USPSBoxType"],
  ["9", "USPSBoxID"],
  ["thanks", "NotAddress"],
]);

test("kind takes the first type that applies", () => {
  assert.equal(kindOf(street), "street");
  assert.equal(kindOf(route), "rural-route");
  assert.equal(kindOf(military), "military");
  assert.equal(kindOf(hc), "highway-contract");
  assert.equal(kindOf(junk), "junk");
  assert.equal(kindOf(embedded), "po-box");
  assert.equal(kindOf(example("Kenai", [["Kenai", "PlaceName"]])), "place-only");
});

test("state comes from the state's text, else the ZIP", () => {
  assert.equal(stateOf(street), "AK");
  assert.equal(stateOf(route), "IA");
  assert.equal(stateOf(example("12 Elm St 99501", [["99501", "ZipCode"]])), "AK");
  assert.equal(stateOf(example("Kenai, A.K.", [["A.K.", "StateName"]])), "AK");
  assert.equal(stateOf(hc), undefined);
  assert.equal(stateOfZip("10001-1234"), "NY");
  assert.equal(stateOfZip("02139"), "MA");
  assert.equal(stateOfZip("abc"), undefined);
});

test("error types: noise by family, missing fields only on an address line", () => {
  const error = dimension("error");
  assert.deepEqual(error.of(street), ["none"]);
  assert.deepEqual(error.of(route), ["missing-zip"]);
  assert.deepEqual(error.of(hc), ["missing-city", "missing-state", "missing-zip"]);
  assert.deepEqual(error.of(junk), ["case"]);
  assert.deepEqual(error.of({ ...street, noise: ["unit-joined", "typo"] }), ["typo", "joined"]);
  assert.deepEqual(error.of({ ...street, notes: ["road:truncated-suffix"] }), ["typo"]);
  assert.deepEqual(error.of(example("Kenai", [["Kenai", "PlaceName"]])), ["none"]);
});

test("every noise transform is in exactly one error family", () => {
  const families = Object.values(NOISE_FAMILIES).flat();
  assert.deepEqual([...families].sort(), [...NOISE_NAMES].sort());
});

test("extra text besides the address", () => {
  const extra = dimension("extra");
  assert.deepEqual(extra.of(street), ["none"]);
  assert.deepEqual(extra.of(embedded), ["recipient", "other-text"]);
  assert.deepEqual(extra.of(junk), ["only-other-text"]);
});

test("exclusive dimensions give one listed value per example", () => {
  for (const ex of [street, route, military, hc, junk, embedded]) {
    for (const d of DIMENSIONS) {
      const vs = d.of(ex);
      assert.ok(vs.length >= 1, `${d.name} of ${ex.text}`);
      if (d.exclusive) assert.equal(vs.length, 1, `${d.name} of ${ex.text}`);
      for (const v of vs) {
        if (d.name !== "source") assert.ok(d.values.includes(v), `${d.name}=${v} not listed`);
      }
    }
  }
});

test("slicesOf matches testing every slice", () => {
  for (const ex of [street, route, military, hc, junk, embedded].map((e) => ({
    ...e,
    source: "osm",
  }))) {
    const tested = SLICES.filter((s) => s.test(ex)).map((s) => s.name);
    assert.deepEqual(slicesOf(ex).sort(), tested.sort());
  }
});

test("countMix counts examples per value", () => {
  const mix = countMix([street, route, junk]);
  assert.equal(mix.examples, 3);
  assert.deepEqual(mix.counts.kind, { street: 1, "rural-route": 1, junk: 1 });
  assert.deepEqual(mix.counts.region, { alaska: 1, midwest: 1, none: 1 });
});

test("wilson interval contains the share and stays in [0, 1]", () => {
  const [lo, hi] = wilson(1, 100);
  assert.ok(lo > 0.96 && lo < 0.97 && hi > 0.9999 && hi <= 1);
  const [a, b] = wilson(0.5, 10);
  assert.ok(a < 0.5 && b > 0.5 && a > 0 && b < 1);
  assert.deepEqual(wilson(0, 0), [0, 1]);
});
