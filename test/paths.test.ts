import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { SUITES } from "../eval.config.ts";

const ROOT = join(import.meta.dirname, "..");

function dataDir(env: Record<string, string>): string {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { datasetPath } from ${JSON.stringify(join(ROOT, "src/data/paths.ts"))}; console.log(datasetPath("dev", "osm"));`,
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, NERDRESS_DATA_DIR: "", ...env } },
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

describe("DATA_DIR", () => {
  it("is data/ by default", () => {
    assert.equal(dataDir({}), join(ROOT, "data", "dev", "osm.jsonl"));
  });
  it("is NERDRESS_DATA_DIR when set", () => {
    assert.equal(
      dataDir({ NERDRESS_DATA_DIR: "test/fixtures/data" }),
      resolve(ROOT, "test/fixtures/data/dev/osm.jsonl"),
    );
  });
});

describe("test/fixtures/data", () => {
  const dir = join(ROOT, "test/fixtures/data");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    datasets: Record<string, Record<string, number>>;
  };
  const total = (split: string) =>
    Object.values(manifest.datasets).reduce((n, c) => n + (c[split] ?? 0), 0);
  it("holds exactly as many examples as the ci suite uses", () => {
    assert.equal(total("train"), SUITES.ci.trainExamples);
    assert.equal(total("dev"), SUITES.ci.evalExamples);
    assert.equal(total("test"), SUITES.ci.evalExamples);
  });
  it("has as many lines in each file as its manifest says", () => {
    for (const [name, counts] of Object.entries(manifest.datasets)) {
      for (const [split, n] of Object.entries(counts)) {
        const path = join(dir, split, `${name}.jsonl`);
        const lines = n === 0 ? 0 : readFileSync(path, "utf8").split("\n").filter(Boolean).length;
        assert.equal(lines, n, path);
      }
    }
  });
});
