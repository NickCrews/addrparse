import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

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
  it("is ADDRPARSE_DATA_DIR, resolved against the working directory, when set", () => {
    assert.equal(
      dataDir({ ADDRPARSE_DATA_DIR: "test/fixtures/data" }),
      resolve(ROOT, "test/fixtures/data/dev.jsonl"),
    );
  });
});
