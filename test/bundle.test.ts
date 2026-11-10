import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bundleImpl } from "../src/eval/bundle.ts";
import { implDir, importImpl, listImpls } from "../src/eval/impl.ts";

test("bundles an impl's load.ts without its training code", async () => {
  const b = await bundleImpl("crf");
  assert.equal(b.entry, "impls/crf/load.ts");
  assert.equal(b.includesTraining, false);
  assert.ok(!("impls/crf/index.ts" in b.inputs));
  assert.ok("src/tokens.ts" in b.inputs);
  assert.ok(b.gzipBytes > 0 && b.gzipBytes < b.bytes);
});

test("every impl with a load.ts uses its load", async () => {
  for (const name of listImpls()) {
    const runtime = join(implDir(name), "load.ts");
    if (!existsSync(runtime)) continue;
    const impl = await importImpl(name);
    const mod = (await import(runtime)) as { load?: unknown };
    assert.equal(impl.load, mod.load, `${name}/index.ts must use load from load.ts`);
  }
});
