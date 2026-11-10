import assert from "node:assert/strict";
import { test } from "node:test";
import { readmeProblems, render, stripMarkers } from "../scripts/readme.ts";

test("README.md's numbers come from a run of the current crf code and data inputs", () => {
  assert.deepEqual(readmeProblems(), []);
});

test("render replaces each marker's contents and stripMarkers removes the markers", () => {
  const text = "a <!-- gen:x -->1<!-- /gen --> b <!-- gen:y -->\nold\n<!-- /gen -->";
  const out = render(text, { x: () => "2", y: () => "\nnew\n" });
  assert.equal(out, "a <!-- gen:x -->2<!-- /gen --> b <!-- gen:y -->\nnew\n<!-- /gen -->");
  assert.equal(stripMarkers(out), "a 2 b \nnew\n");
  assert.throws(() => render(text, { x: () => "2" }), /unknown marker gen:y/);
});
