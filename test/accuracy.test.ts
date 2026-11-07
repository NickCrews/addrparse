import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSpans, scoreAll, scoreExample } from "../src/eval/accuracy.ts";
import type { Label } from "../src/labels.ts";
import type { Example, Span } from "../src/types.ts";

/** Builds spans from [substring, label] pairs, located left to right in `text`. */
function at(text: string, parts: [string, Label][]): Span[] {
  let from = 0;
  return parts.map(([s, label]) => {
    const start = text.indexOf(s, from);
    assert.ok(start >= 0, `${s} not in ${text}`);
    from = start + s.length;
    return { start, end: from, label };
  });
}

function example(text: string, parts: [string, Label][], source = "openaddresses"): Example {
  return { id: text, text, spans: at(text, parts), source };
}

const kenai = example("12 Main St, Kenai, AK", [
  ["12", "AddressNumber"],
  ["Main", "StreetName"],
  ["St", "StreetNamePostType"],
  ["Kenai", "PlaceName"],
  ["AK", "StateName"],
]);

describe("normalizeSpans", () => {
  it("trims whitespace and edge commas, clamps to the text and sorts", () => {
    const text = "Kenai, AK";
    assert.deepEqual(
      normalizeSpans(text, [
        { start: 6, end: 20, label: "StateName" },
        { start: 0, end: 7, label: "PlaceName" },
      ]),
      [
        { start: 0, end: 5, label: "PlaceName" },
        { start: 7, end: 9, label: "StateName" },
      ],
    );
  });

  it("drops spans that are empty after trimming", () => {
    assert.deepEqual(normalizeSpans("a, b", [{ start: 1, end: 3, label: "PlaceName" }]), []);
  });
});

describe("scoreExample", () => {
  it("counts identical spans as an exact match", () => {
    const s = scoreExample(kenai, kenai.spans);
    assert.equal(s.exact, true);
    assert.equal(s.matched, 5);
    assert.equal(s.tokensCorrect, 5);
    assert.equal(s.valid, true);
  });

  it("ignores a trailing comma included in a predicted span", () => {
    const pred = kenai.spans.map((s) =>
      s.label === "StreetNamePostType" ? { ...s, end: s.end + 1 } : s,
    );
    assert.equal(scoreExample(kenai, pred).exact, true);
  });

  it("is not an exact match when one span's boundary differs", () => {
    const pred = at(kenai.text, [
      ["12", "AddressNumber"],
      ["Main St", "StreetName"],
      ["Kenai", "PlaceName"],
      ["AK", "StateName"],
    ]);
    const s = scoreExample(kenai, pred);
    assert.equal(s.exact, false);
    assert.equal(s.matched, 3);
    assert.equal(s.tokensCorrect, 4);
  });

  it("is not an exact match when a gold span is missing", () => {
    assert.equal(scoreExample(kenai, kenai.spans.slice(1)).exact, false);
  });

  it("marks overlapping and out-of-range predictions invalid", () => {
    const overlap = [...kenai.spans, { start: 0, end: 7, label: "AddressNumber" as const }];
    assert.equal(scoreExample(kenai, overlap).valid, false);
    const outside = [{ start: 0, end: 999, label: "PlaceName" as const }];
    assert.equal(scoreExample(kenai, outside).valid, false);
  });

  it("does not let a duplicated prediction stand in for a missing gold span", () => {
    const pred = [...kenai.spans.slice(0, 4), kenai.spans[0]!];
    const s = scoreExample(kenai, pred);
    assert.equal(s.matched, 4);
    assert.equal(s.exact, false);
    assert.equal(s.valid, false);
  });
});

describe("scoreAll", () => {
  const osm = example(
    "Kenai, AK",
    [
      ["Kenai", "PlaceName"],
      ["AK", "StateName"],
    ],
    "osm",
  );
  const wrongState = at(osm.text, [
    ["Kenai", "PlaceName"],
    ["AK", "ZipCode"],
  ]);
  const m = scoreAll([kenai, osm], [kenai.spans, wrongState]);

  it("reports exact match, token accuracy and span PRF", () => {
    assert.equal(m.examples, 2);
    assert.equal(m.exactMatch, 0.5);
    assert.equal(m.tokens, 7);
    assert.equal(m.tokenAccuracy, 6 / 7);
    assert.equal(m.span.precision, 6 / 7);
    assert.equal(m.span.recall, 6 / 7);
    assert.equal(m.invalidPredictions, 0);
  });

  it("reports precision and recall per label", () => {
    assert.deepEqual(m.perLabel.StateName, {
      precision: 1,
      recall: 0.5,
      f1: 2 / 3,
      gold: 2,
      predicted: 1,
    });
    assert.deepEqual(m.perLabel.ZipCode, { precision: 0, recall: 0, f1: 0, gold: 0, predicted: 1 });
    assert.equal(m.perLabel.CountryName, undefined);
  });

  it("lists token confusions as gold and predicted labels", () => {
    assert.deepEqual(m.confusions, [{ gold: "StateName", predicted: "ZipCode", count: 1 }]);
  });

  it("reports slices containing at least one example", () => {
    assert.equal(m.slices["source=openaddresses"]?.exactMatch, 1);
    assert.equal(m.slices["source=osm"]?.exactMatch, 0);
    assert.equal(m.slices["source=osm"]?.examples, 1);
    assert.equal(m.slices["po-box"], undefined);
  });

  it("counts invalid predictions", () => {
    const bad = [{ start: 0, end: 999, label: "PlaceName" as const }];
    assert.equal(scoreAll([kenai], [bad]).invalidPredictions, 1);
  });

  it("scores a missing prediction as empty", () => {
    const r = scoreAll([kenai], []);
    assert.equal(r.exactMatch, 0);
    assert.equal(r.span.recall, 0);
  });
});
