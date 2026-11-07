/**
 * Writes test/fixtures/data/{train,dev,test}.jsonl: the first examples of each split in data/ (or
 * `$ADDRPARSE_DATA_DIR`), as many as the `ci` suite uses. The fixture is committed so CI can run
 * every impl without downloading the training data.
 *
 *   node src/data/fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUITES } from "../../eval.config.ts";
import { loadExamples } from "./load.ts";
import { ROOT, type Split } from "./paths.ts";

const FIXTURE_DIR = join(ROOT, "test", "fixtures", "data");
const sizes: Record<Split, number> = {
  train: SUITES.ci.trainExamples,
  dev: SUITES.ci.evalExamples,
  test: SUITES.ci.evalExamples,
};

mkdirSync(FIXTURE_DIR, { recursive: true });
for (const [split, n] of Object.entries(sizes) as [Split, number][]) {
  const examples = await loadExamples(split, n);
  const path = join(FIXTURE_DIR, `${split}.jsonl`);
  writeFileSync(path, examples.map((e) => JSON.stringify(e) + "\n").join(""));
  console.log(`${split}: ${n} examples → ${path}`);
}
