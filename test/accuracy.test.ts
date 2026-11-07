import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coarsenSpans,
  normalizeSpans,
  riskCoverage,
  scoreAll,
  scoreExample,
} from "../src/eval/accuracy.ts";
import { example, locate as at, pairs } from "./helpers.ts";

const kenai = example(
  "12 Main St, Kenai, AK",
  [
    ["12", "AddressNumber"],
    ["Main", "StreetName"],
    ["St", "StreetNamePostType"],
    ["Kenai", "PlaceName"],
    ["AK", "StateName"],
  ],
  "openaddresses",
);

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
    assert.partialDeepStrictEqual(s, { exact: true, matched: 5, tokensCorrect: 5, valid: true });
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
    assert.partialDeepStrictEqual(s, { exact: false, matched: 3, tokensCorrect: 4 });
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
    assert.partialDeepStrictEqual(s, { matched: 4, exact: false, valid: false });
  });
});

describe("coarsenSpans", () => {
  it("collapses the street, unit and PO box into one span each, not across commas", () => {
    const text = "12 N Main St, Apt # 4, Kenai";
    const spans = at(text, [
      ["12", "AddressNumber"],
      ["N", "StreetNamePreDirectional"],
      ["Main", "StreetName"],
      ["St", "StreetNamePostType"],
      ["Apt #", "OccupancyType"],
      ["4", "OccupancyIdentifier"],
      ["Kenai", "PlaceName"],
    ]);
    assert.deepEqual(pairs(text, coarsenSpans(text, spans)), [
      ["12", "AddressNumber"],
      ["N Main St", "StreetName"],
      ["Apt # 4", "OccupancyIdentifier"],
      ["Kenai", "PlaceName"],
    ]);
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

  it("credits a street split differently in the coarse metrics only", () => {
    const unsplit = at(kenai.text, [
      ["12", "AddressNumber"],
      ["Main St", "StreetName"],
      ["Kenai", "PlaceName"],
      ["AK", "StateName"],
    ]);
    const r = scoreAll([kenai], [unsplit]);
    assert.equal(r.exactMatch, 0);
    assert.equal(r.coarse.exactMatch, 1);
    assert.equal(r.coarse.tokenAccuracy, 1);
    assert.equal(r.coarse.spanF1, 1);
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

describe("riskCoverage", () => {
  it("reports exact match among the most confident share of examples", () => {
    const rc = riskCoverage([true, false, true, true], [0.9, 0.1, 0.8, 0.5], [1, 0.75, 0.5]);
    assert.deepEqual(rc.exactAtCoverage, [
      { coverage: 1, exactMatch: 0.75 },
      { coverage: 0.75, exactMatch: 1 },
      { coverage: 0.5, exactMatch: 1 },
    ]);
  });

  it("computes AURC as the mean error over each k most confident examples", () => {
    // Ranked: right, wrong, right, wrong. Errors at k = 1..4: 0, 1/2, 1/3, 2/4.
    const rc = riskCoverage([true, false, true, false], [4, 3, 2, 1]);
    assert.ok(Math.abs(rc.aurc - (0 + 1 / 2 + 1 / 3 + 2 / 4) / 4) < 1e-12);
  });

  it("scores a perfect ranking's AURC below a reversed one", () => {
    const correct = [true, true, false, false];
    const good = riskCoverage(correct, [4, 3, 2, 1]).aurc;
    const bad = riskCoverage(correct, [1, 2, 3, 4]).aurc;
    assert.ok(good < bad);
  });

  it("counts tied examples at their mean correctness", () => {
    // One tie group of four with two right: every coverage expects 50% exact match.
    const rc = riskCoverage([true, false, true, false], [1, 1, 1, 1], [0.5, 0.25]);
    assert.deepEqual(
      rc.exactAtCoverage.map((p) => p.exactMatch),
      [0.5, 0.5],
    );
    assert.equal(rc.aurc, 0.5);
  });

  it("finds the lowest threshold that keeps exact match at the target", () => {
    const rc = riskCoverage([true, true, false, true], [0.9, 0.7, 0.5, 0.3], [1], 0.99);
    assert.deepEqual(rc.atTarget, { target: 0.99, threshold: 0.7, coverage: 0.5 });
  });

  it("does not split a tie group to reach the target", () => {
    const rc = riskCoverage([true, false], [0.5, 0.5], [1], 0.99);
    assert.equal(rc.atTarget, null);
  });

  it("picks the largest coverage reaching the target even after a dip", () => {
    // Exact match at each cut: 1/1, 1/2, 2/3, 3/4; at target 0.75 the deepest cut keeps all 4.
    const rc = riskCoverage([true, false, true, true], [4, 3, 2, 1], [1], 0.75);
    assert.deepEqual(rc.atTarget, { target: 0.75, threshold: 1, coverage: 1 });
  });
});

describe("scoreAll abstention and confidence", () => {
  const junk = example("N/A", [["N/A", "NotAddress"]], "junk");

  it("counts junk examples with no address labels as abstained", () => {
    const notAddress = junk.spans;
    const m = scoreAll(
      [junk, junk, kenai],
      [notAddress, at(junk.text, [["N/A", "PlaceName"]]), []],
    );
    assert.deepEqual(m.abstention, {
      junkExamples: 2,
      junkAbstained: 0.5,
      addressExamples: 1,
      addressAbstained: 1,
    });
  });

  it("reports risk–coverage only when every example has a confidence", () => {
    assert.equal(scoreAll([kenai, junk], [kenai.spans, []]).riskCoverage, undefined);
    assert.equal(
      scoreAll([kenai, junk], [kenai.spans, []], [0.9, undefined]).riskCoverage,
      undefined,
    );
    const m = scoreAll([kenai, junk], [kenai.spans, []], [0.9, 0.2]);
    assert.equal(m.riskCoverage?.exactAtCoverage[0]?.exactMatch, 0.5);
    assert.deepEqual(m.riskCoverage?.atTarget, { target: 0.99, threshold: 0.9, coverage: 0.5 });
  });
});

describe("riskCoverage with partial ties", () => {
  // Ranked: one right at 2, then a tie at 1 with one right and one wrong.
  const rc = riskCoverage([true, true, false], [2, 1, 1], [2 / 3, 0.9]);

  it("interpolates a coverage cut inside a tie at the tie's mean correctness", () => {
    assert.equal(rc.exactAtCoverage[0]!.exactMatch, (1 + 0.5) / 2);
  });

  it("rounds coverage to a whole number of examples", () => {
    // 0.9 × 3 rounds to all 3 examples.
    assert.equal(rc.exactAtCoverage[1]!.exactMatch, 2 / 3);
  });

  it("uses the tie's mean correctness in AURC", () => {
    const want = (0 + (1 - 1.5 / 2) + (1 - 2 / 3)) / 3;
    assert.ok(Math.abs(rc.aurc - want) < 1e-12);
  });
});
