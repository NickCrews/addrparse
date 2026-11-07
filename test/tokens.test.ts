import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Label } from "../src/labels.ts";
import { labelAt, labeledTokens, spansFromTokens, tokenize } from "../src/tokens.ts";
import { example, pairs } from "./helpers.ts";

const cores = (text: string) => tokenize(text).map((t) => text.slice(t.coreStart, t.coreEnd));

describe("tokenize", () => {
  it("splits on whitespace and records whole-token offsets", () => {
    const text = "12  Main St";
    assert.deepEqual(
      tokenize(text).map((t) => [t.start, t.end]),
      [
        [0, 2],
        [4, 8],
        [9, 11],
      ],
    );
  });

  it("strips edge commas and semicolons from the core only", () => {
    const text = "Kenai, AK;";
    const [kenai, ak] = tokenize(text);
    assert.deepEqual([kenai!.start, kenai!.end, kenai!.coreStart, kenai!.coreEnd], [0, 6, 0, 5]);
    assert.deepEqual([ak!.start, ak!.end, ak!.coreStart, ak!.coreEnd], [7, 10, 7, 9]);
  });

  it("keeps other punctuation in the core", () => {
    assert.deepEqual(cores("P.O. Box #12, 1,096"), ["P.O.", "Box", "#12", "1,096"]);
  });

  it("skips tokens that are only separator punctuation", () => {
    assert.deepEqual(cores("Main , St"), ["Main", "St"]);
  });
});

describe("labelAt", () => {
  it("returns the label of the span covering the token's first core character", () => {
    const [kenai, ak] = tokenize("Kenai, AK");
    const spans = [{ start: 0, end: 5, label: "PlaceName" as const }];
    assert.equal(labelAt(spans, kenai!), "PlaceName");
    assert.equal(labelAt(spans, ak!), undefined);
  });
});

describe("labeledTokens", () => {
  it("pairs each token's core text with its gold label", () => {
    const ex = example("Kenai, AK", [
      ["Kenai", "PlaceName"],
      ["AK", "StateName"],
    ]);
    assert.deepEqual(
      labeledTokens(ex).map((t) => [t.text, t.label]),
      [
        ["Kenai", "PlaceName"],
        ["AK", "StateName"],
      ],
    );
  });
});

describe("spansFromTokens", () => {
  const spans = (text: string, labels: (Label | undefined)[]) =>
    pairs(text, spansFromTokens(tokenize(text), labels));

  it("merges adjacent tokens with the same label", () => {
    assert.deepEqual(spans("New York NY", ["PlaceName", "PlaceName", "StateName"]), [
      ["New York", "PlaceName"],
      ["NY", "StateName"],
    ]);
  });

  it("does not merge across a comma", () => {
    assert.deepEqual(spans("Kansas, City", ["PlaceName", "PlaceName"]), [
      ["Kansas", "PlaceName"],
      ["City", "PlaceName"],
    ]);
  });

  it("does not merge across a leading comma on the next token", () => {
    assert.deepEqual(spans("Kansas ,City", ["PlaceName", "PlaceName"]), [
      ["Kansas", "PlaceName"],
      ["City", "PlaceName"],
    ]);
  });

  it("excludes edge commas from span offsets", () => {
    assert.deepEqual(spans("Kenai, AK", ["PlaceName", "StateName"]), [
      ["Kenai", "PlaceName"],
      ["AK", "StateName"],
    ]);
  });

  it("does not merge across an unlabeled token", () => {
    assert.deepEqual(spans("A x B", ["StreetName", undefined, "StreetName"]), [
      ["A", "StreetName"],
      ["B", "StreetName"],
    ]);
  });
});
