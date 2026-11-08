import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PageData } from "../docs/page-data.ts";
import { loadEmbedded } from "../docs/parsers.ts";
import { scoreExample } from "../src/eval/accuracy.ts";
import { asScoredParse } from "../src/types.ts";

const ROOT = join(import.meta.dirname, "..");

test("docs build makes one page whose embedded models parse demo rows as the build did", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nerdress-docs-"));
  try {
    const out = join(dir, "index.html");
    execFileSync(
      process.execPath,
      [join(ROOT, "docs", "build.ts"), "--suite", "ci", "--out", out],
      {
        env: { ...process.env, NERDRESS_DATA_DIR: join(ROOT, "test", "fixtures", "data") },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const html = readFileSync(out, "utf8");
    for (const tab of ["home", "metrics", "models"]) {
      assert.match(html, new RegExp(`data-tab="${tab}"`));
    }
    assert.match(html, /OpenStreetMap contributors/);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="http/);

    const json = /<script id="page-data" type="application\/json">(.*?)<\/script>/s.exec(html);
    const data = JSON.parse(json![1]!) as PageData;
    assert.deepEqual(data.embedded.map((m) => m.impl).sort(), ["crf"]);
    assert.ok(data.demo.sets.length > 0);

    for (const m of data.embedded) {
      const parser = await loadEmbedded(m);
      for (const [text, row] of Object.entries(data.demo.rows)) {
        const { spans } = asScoredParse(parser.parse(text));
        const exact = scoreExample({ id: "", source: "", text, spans: row.gold }, spans).exact;
        assert.equal(exact, row.exact[m.impl], `${m.impl} on ${JSON.stringify(text)}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
