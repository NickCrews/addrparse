/**
 * Compares saved runs.
 *
 *   pnpm compare                  latest run of every impl in a suite (--suite, default quick)
 *   pnpm compare <impl>           that impl's last two runs, with changes
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
import { findRun, loadRuns, type RunResult } from "./results.ts";

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
    const same = ofImpl.filter((r) => r.suite === suite && r.config.split === opts.split);
    if (same.length < 2) {
      console.error(`${ref} has ${same.length} ${suite}/${opts.split} run(s); need two`);
      process.exit(1);
    }
    printPair(same.at(-2)!, same.at(-1)!);
  }
} else if (positionals.length === 0) {
  const suite =
    opts.suite ?? (runs.some((r) => r.suite === "quick") ? "quick" : runs.at(-1)!.suite);
  const latest = new Map<string, RunResult>();
  for (const r of runs)
    if (r.suite === suite && r.config.split === opts.split) latest.set(r.impl, r);
  if (latest.size === 0) {
    console.error(`no ${suite}/${opts.split} runs`);
    process.exit(1);
  }
  const chosen = [...latest.values()].sort((a, b) => a.impl.localeCompare(b.impl));
  console.log(c.dim(`latest ${suite}/${opts.split} run of each impl`));
  for (const r of chosen) console.log(c.dim(`  ${r.impl}: ${r.runId}`));
  console.log();
  const labels = chosen.map((r) => r.impl);
  console.log(sideBySideTable(chosen, labels));
  for (const n of comparabilityNotes(chosen)) console.log(n);
  if (opts.detail) console.log("\n" + detailTables(chosen, labels));
} else {
  console.error("usage: pnpm compare [<impl> | <runA> <runB>] [--suite quick] [--detail]");
  process.exit(2);
}
