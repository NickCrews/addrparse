/**
 * Compares saved runs.
 *
 *   pnpm compare                  latest run of every impl and training blend in a suite
 *                                 (--suite, default quick)
 *   pnpm compare <impl>           that impl's last two runs on its latest run's blend, with changes
 *   pnpm compare <runA> <runB>    two runs (id, id prefix, impl name or path), with changes
 *
 * `--detail` adds span F1 per label, exact match per slice, the confidence threshold for 99%
 * exact match and the learning curve.
 */
import { parseArgs } from "node:util";
import {
  c,
  comparabilityNotes,
  deltaTable,
  detailTables,
  shortId,
  sideBySideTable,
} from "./report.ts";
import { findRun, loadRuns, trainBlendOf, type RunResult } from "./results.ts";

/** "crf", or "crf@libpostal-only" for a run trained on another blend. */
const columnName = (r: RunResult) =>
  trainBlendOf(r) === "default" ? r.impl : `${r.impl}@${trainBlendOf(r)}`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    suite: { type: "string" },
    split: { type: "string", default: "dev" },
    detail: { type: "boolean", default: false },
  },
});

const runs = loadRuns();
if (runs.length === 0) {
  console.error("no saved runs; try `pnpm eval lookup --suite smoke`");
  process.exit(1);
}

function printPair(a: RunResult, b: RunResult) {
  console.log(`${c.dim("A")} ${a.runId}\n${c.dim("B")} ${b.runId}\n`);
  console.log(deltaTable(a, b, [`A ${shortId(a)}`, `B ${shortId(b)}`]));
  for (const n of comparabilityNotes([a, b])) console.log(n);
  if (opts.detail) console.log("\n" + detailTables([a, b], ["A", "B"]));
}

if (positionals.length === 2) {
  printPair(findRun(positionals[0]!), findRun(positionals[1]!));
} else if (positionals.length === 1) {
  const ref = positionals[0]!;
  const ofImpl = runs.filter((r) => r.impl === ref);
  if (ofImpl.length === 0) {
    // A single run ref: show it alone.
    const run = findRun(ref);
    console.log(`${run.runId}\n`);
    console.log(sideBySideTable([run], [run.impl]));
    if (opts.detail) console.log("\n" + detailTables([run], [run.impl]));
  } else {
    const suite = opts.suite ?? ofImpl.at(-1)!.suite;
    const blend = trainBlendOf(ofImpl.at(-1)!);
    const same = ofImpl.filter(
      (r) => r.suite === suite && r.config.split === opts.split && trainBlendOf(r) === blend,
    );
    if (same.length < 2) {
      console.error(`${ref} has ${same.length} ${suite}/${opts.split} run(s); need two`);
      process.exit(1);
    }
    printPair(same.at(-2)!, same.at(-1)!);
  }
} else if (positionals.length === 0) {
  const suite =
    opts.suite ?? (runs.some((r) => r.suite === "quick") ? "quick" : runs.at(-1)!.suite);
  /** Keyed by impl and training blend, so a run on another blend is its own column. */
  const latest = new Map<string, RunResult>();
  for (const r of runs)
    if (r.suite === suite && r.config.split === opts.split) latest.set(columnName(r), r);
  if (latest.size === 0) {
    console.error(`no ${suite}/${opts.split} runs`);
    process.exit(1);
  }
  const chosen = [...latest.values()].sort((a, b) => columnName(a).localeCompare(columnName(b)));
  console.log(c.dim(`latest ${suite}/${opts.split} run of each impl and training blend`));
  for (const r of chosen) console.log(c.dim(`  ${columnName(r)}: ${r.runId}`));
  console.log();
  const labels = chosen.map(columnName);
  console.log(sideBySideTable(chosen, labels));
  for (const n of comparabilityNotes(chosen)) console.log(n);
  if (opts.detail) console.log("\n" + detailTables(chosen, labels));
} else {
  console.error("usage: pnpm compare [<impl> | <runA> <runB>] [--suite quick] [--detail]");
  process.exit(2);
}
