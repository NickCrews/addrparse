/**
 * Writes test/fixtures/data/: from data/ (or `$ADDRPARSE_DATA_DIR`), the examples of each dataset
 * that the default blend's first examples of each split take, as many as the `ci` suite uses,
 * and a manifest. Loading the default blend from the fixture gives exactly those examples in the
 * same order. The fixture is committed so CI can run every impl without downloading the training
 * data. It is ODbL 1.0 data; its notice is test/fixtures/data/LICENSE.
 *
 *   node src/data/fixture.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SUITES } from "../../eval.config.ts";
import { blendedLines, readManifest, type Manifest } from "./load.ts";
import { datasetPath, manifestPath, ROOT, type Split } from "./paths.ts";

const FIXTURE_DIR = join(ROOT, "test", "fixtures", "data");
const sizes: Record<Split, number> = {
  train: SUITES.ci.trainExamples,
  dev: SUITES.ci.evalExamples,
  test: SUITES.ci.evalExamples,
};

const manifest: Manifest = { datasets: {} };
const lines: Record<string, Record<Split, string[]>> = {};
for (const name of Object.keys(readManifest().datasets)) {
  manifest.datasets[name] = { train: 0, dev: 0, test: 0 };
  lines[name] = { train: [], dev: [], test: [] };
}
for (const [split, n] of Object.entries(sizes) as [Split, number][]) {
  for (const { line, dataset } of await blendedLines(split, n)) lines[dataset]![split].push(line);
}
for (const split of Object.keys(sizes) as Split[]) {
  rmSync(join(FIXTURE_DIR, split), { recursive: true, force: true });
}
for (const [name, bySplit] of Object.entries(lines)) {
  for (const [split, ls] of Object.entries(bySplit) as [Split, string[]][]) {
    manifest.datasets[name]![split] = ls.length;
    if (ls.length === 0) continue;
    const path = datasetPath(split, name, FIXTURE_DIR);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, ls.map((l) => l + "\n").join(""));
  }
}
// Datasets the fixture has no examples of stay out, so the default blend skips them.
for (const [name, c] of Object.entries(manifest.datasets)) {
  if (c.train + c.dev + c.test === 0) delete manifest.datasets[name];
}
writeFileSync(manifestPath(FIXTURE_DIR), JSON.stringify(manifest, null, 2) + "\n");
for (const [split, n] of Object.entries(sizes))
  console.log(`${split}: ${n} examples → ${FIXTURE_DIR}`);
