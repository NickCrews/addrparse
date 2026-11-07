import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DATA_DIR, datasetPath, ROOT } from "../src/data/paths.ts";
import type { Label } from "../src/labels.ts";
import { labelAt, labeledTokens, spansFromTokens, tokenize } from "../src/tokens.ts";
import type { Example } from "../src/types.ts";
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

  it("splits words where a space between fields is often left out", () => {
    const parts = (text: string) => tokenize(text).map((t) => text.slice(t.start, t.end));
    assert.deepEqual(parts("Apt303 Apt#303 Box55 RR2 AK99501"), [
      ...["Apt", "303", "Apt", "#303", "Box", "55", "RR", "2", "AK", "99501"],
    ]);
    assert.deepEqual(parts("St,Kenai,AK"), ["St,", "Kenai,", "AK"]);
    assert.deepEqual(parts("N.Main St.Apt Ste.100 No.1 Apt.#4"), [
      ...["N.", "Main", "St.", "Apt", "Ste.", "100", "No.", "1", "Apt.", "#4"],
    ]);
    assert.deepEqual(parts("St/Apt c/o"), ["St", "/", "Apt", "c", "/", "o"]);
    assert.deepEqual(parts("Unit-4 I-95"), ["Unit", "-", "4", "I", "-", "95"]);
  });

  it("keeps words whole that are one field", () => {
    const text = "123B 4th 12A #4 P.O. N.W. U.S.A. 14.5 1/2 45-29 Winston-Salem 1,096 St.E";
    assert.deepEqual(cores(text), text.split(" "));
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

  it("merges the parts of a word that share a label", () => {
    assert.deepEqual(
      spans("Apt303 I-95", [
        "OccupancyType",
        "OccupancyIdentifier",
        "StreetName",
        "StreetName",
        "StreetName",
      ]),
      [
        ["Apt", "OccupancyType"],
        ["303", "OccupancyIdentifier"],
        ["I-95", "StreetName"],
      ],
    );
  });

  it("does not merge across an unlabeled token", () => {
    assert.deepEqual(spans("A x B", ["StreetName", undefined, "StreetName"]), [
      ["A", "StreetName"],
      ["B", "StreetName"],
    ]);
  });
});

describe("gold data", () => {
  it("puts every span boundary on a token boundary", () => {
    const bad: string[] = [];
    const dir = existsSync(datasetPath("dev", "osm")) ? DATA_DIR : join(ROOT, "test/fixtures/data");
    for (const file of readdirSync(join(dir, "dev"))) {
      for (const line of readFileSync(join(dir, "dev", file), "utf8").split("\n")) {
        if (!line) continue;
        const ex = JSON.parse(line) as Example;
        const tokens = tokenize(ex.text);
        const starts = new Set(tokens.map((t) => t.coreStart));
        const ends = new Set(tokens.map((t) => t.coreEnd));
        for (const s of ex.spans) {
          const where = `${file} ${ex.id}: ${JSON.stringify(ex.text.slice(s.start, s.end))} in ${JSON.stringify(ex.text)}`;
          if (!(starts.has(s.start) && ends.has(s.end))) bad.push(where);
        }
      }
    }
    // Raw lines with fields fused beyond any rule ("PALM SPRINGS,CACP92262") are left as they are.
    assert.ok(bad.length <= 5, `${bad.length} misaligned spans:\n${bad.slice(0, 20).join("\n")}`);
  });
});
