import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSourceNumbers } from "../src/data/libpostal.ts";
import { mixOrder } from "../src/data/mix.ts";

const order = (lengths: number[], weights: number[]) =>
  [...mixOrder(lengths, weights)].map((o) => `${o.source}:${o.i}`);

describe("mixOrder", () => {
  it("alternates sources line by line when weights are equal", () => {
    assert.deepEqual(order([2, 2], [1, 1]), ["0:0", "1:0", "0:1", "1:1"]);
  });
  it("keeps every prefix in proportion to the weights", () => {
    const sources = [...mixOrder([1000, 1000, 1000], [1, 1, 0.2])].map((o) => o.source);
    for (const n of [11, 110, 550]) {
      const prefix = sources.slice(0, n);
      const share = prefix.filter((s) => s === 2).length / n;
      assert.ok(Math.abs(share - 0.2 / 2.2) < 0.02, `prefix ${n}: share ${share}`);
    }
  });
  it("continues with the remaining sources after one runs out", () => {
    assert.deepEqual(order([1, 3], [1, 1]), ["0:0", "1:0", "1:1", "1:2"]);
  });
  it("keeps the remaining sources in proportion after one runs out", () => {
    const sources = [...mixOrder([10, 1000, 1000], [1, 1, 0.5])].map((o) => o.source);
    const after = sources.slice(30, 330);
    const share = after.filter((s) => s === 2).length / after.length;
    assert.ok(Math.abs(share - 1 / 3) < 0.01, `share ${share}`);
  });
  it("breaks ties toward the lower source index", () => {
    assert.deepEqual(order([1, 1, 1], [2, 2, 2]), ["0:0", "1:0", "2:0"]);
  });
  it("yields nothing when every weight is 0 or every source is empty", () => {
    assert.deepEqual(order([3, 3], [0, 0]), []);
    assert.deepEqual(order([0, 0], [1, 1]), []);
  });
  it("leaves out sources with weight 0", () => {
    assert.deepEqual(order([2, 2], [1, 0]), ["0:0", "0:1"]);
  });
  it("reads every line of every weighted source exactly once", () => {
    const got = order([3, 5, 7], [1, 0.3, 2]);
    assert.equal(got.length, 15);
    assert.equal(new Set(got).size, 15);
  });
});

describe("parseSourceNumbers", () => {
  it("parses source=number pairs", () => {
    assert.deepEqual(parseSourceNumbers(["ways=0.5", "osm=100"]), { ways: 0.5, osm: 100 });
  });
  it("rejects unknown sources and non-numbers", () => {
    assert.throws(() => parseSourceNumbers(["nad=1"]), /source one of/);
    assert.throws(() => parseSourceNumbers(["ways=x"]), /not a non-negative number/);
    assert.throws(() => parseSourceNumbers(["ways"]), /not a non-negative number/);
    assert.throws(() => parseSourceNumbers(["ways=1=2"]), /expected/);
    assert.throws(() => parseSourceNumbers(["toString=1"]), /source one of/);
  });
});
