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
      `import { splitPath } from ${JSON.stringify(join(ROOT, "src/data/paths.ts"))}; console.log(splitPath("dev"));`,
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, ADDRPARSE_DATA_DIR: "", ...env } },
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

describe("DATA_DIR", () => {
  it("is data/ by default", () => {
    assert.equal(dataDir({}), join(ROOT, "data", "dev.jsonl"));
  });
  it("is ADDRPARSE_DATA_DIR when set", () => {
    assert.equal(
      dataDir({ ADDRPARSE_DATA_DIR: "test/fixtures/data" }),
      resolve(ROOT, "test/fixtures/data/dev.jsonl"),
    );
  });
});

describe("test/fixtures/data", () => {
  const lines = (split: string) =>
    readFileSync(join(ROOT, "test/fixtures/data", `${split}.jsonl`), "utf8")
      .split("\n")
      .filter(Boolean).length;
  it("holds exactly as many examples as the ci suite uses", () => {
    assert.equal(lines("train"), SUITES.ci.trainExamples);
    assert.equal(lines("dev"), SUITES.ci.evalExamples);
    assert.equal(lines("test"), SUITES.ci.evalExamples);
  });
});
