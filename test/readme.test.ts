import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { markdownTable, README_PATH, releaseRun, renderReadme } from "../docs/readme.ts";

test("README.md's generated sections match the release run (`pnpm readme` updates them)", () => {
  const readme = readFileSync(README_PATH, "utf8");
  assert.equal(renderReadme(readme, releaseRun()), readme);
});

test("markdownTable pads columns and marks right-aligned ones", () => {
  assert.equal(
    markdownTable(
      ["a", "count"],
      [
        ["x", "1"],
        ["long", "22"],
      ],
      ["l", "r"],
    ),
    ["| a    | count |", "| ---- | ----: |", "| x    |     1 |", "| long |    22 |"].join("\n"),
  );
});
