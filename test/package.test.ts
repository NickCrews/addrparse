import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { readAttribution } from "../docs/attribution.ts";
import { ROOT } from "../src/data/paths.ts";
import { LABEL_NAMES } from "../src/labels.ts";

const out = mkdtempSync(join(tmpdir(), "nerdress-package-"));
after(() => rmSync(out, { recursive: true, force: true }));

test("package/build.ts builds an importable package from the fixture data", async () => {
  const r = spawnSync(
    process.execPath,
    [join(ROOT, "package", "build.ts"), "--suite", "ci", "--out", out],
    {
      env: { ...process.env, NERDRESS_DATA_DIR: join(ROOT, "test", "fixtures", "data") },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, r.stderr);

  for (const f of ["index.js", "index.d.ts", "package.json", "README.md", "LICENSE"]) {
    assert.ok(existsSync(join(out, f)), f);
  }
  assert.match(readFileSync(join(out, "README.md"), "utf8"), /## This release's model/);
  assert.match(readFileSync(join(out, "LICENSE"), "utf8"), /OpenStreetMap contributors/);
  const pkg = JSON.parse(readFileSync(join(out, "package.json"), "utf8")) as { name: string };
  assert.equal(pkg.name, "nerdress");
  assert.doesNotMatch(readFileSync(join(out, "index.js"), "utf8"), /\bfrom\s+["']node:/);

  const mod = (await import(
    pathToFileURL(join(out, "index.js")).href
  )) as typeof import("../package/index.ts");
  assert.deepEqual(Object.keys(mod.LABELS), LABEL_NAMES);
  const text = "123 Main St, Anchorage, AK 99501";
  const result = mod.parse(text);
  assert.ok(result.spans.length > 0);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  for (const s of result.spans) assert.equal(s.text, text.slice(s.start, s.end));
  assert.deepEqual(mod.parse(""), { spans: [], confidence: 1 });
  assert.throws(() => mod.parse(42 as unknown as string), TypeError);
});

test("LICENSING.md carries the model attribution", () => {
  assert.match(readAttribution(), /^Trained on address data from © OpenStreetMap contributors/);
});
