/**
 * Run-to-run spread of each headline metric, to check the `noise` thresholds in headline.ts.
 *
 *   pnpm noise <impl...> [--suite quick] [--last 5]
 *
 * Uses the last `--last` saved dev-split runs of each impl in the suite that share the latest
 * run's code, data, suite config and machine, so they differ only by chance. Runs made while the
 * machine was busy (load average above its core count) are skipped, as `pnpm eval` already flags
 * their timings as unreliable. Make them with e.g.
 * `for i in 1 2 3 4 5 6; do pnpm eval crf --retrain; done` (`--retrain` so training is measured
 * each time). For every ordered pair of those runs it takes the relative change |b − a| / |a|, as
 * `pnpm eval` would show it, and prints the 90th percentile and the maximum. A 90th percentile
 * above the metric's noise (red) means more than one in ten repeat runs would be coloured as a
 * real change.
 */
import { parseArgs } from "node:util";
import { HEADLINE } from "./headline.ts";
import { c, renderTable } from "./report.ts";
import { loadRuns, type RunResult } from "./results.ts";
import { percentile } from "./stats.ts";

const { values: opts, positionals: impls } = parseArgs({
  allowPositionals: true,
  options: {
    suite: { type: "string", default: "quick" },
    last: { type: "string", default: "5" },
  },
});
if (impls.length === 0) {
  console.error("usage: pnpm noise <impl...> [--suite quick] [--last 5]");
  process.exit(2);
}

const sameSetup = (a: RunResult, b: RunResult) =>
  a.implHash === b.implHash &&
  a.data.trainHash === b.data.trainHash &&
  a.data.evalHash === b.data.evalHash &&
  a.machine.cpu === b.machine.cpu &&
  JSON.stringify(a.config) === JSON.stringify(b.config);

const pctText = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

const runs = loadRuns();
const groups = impls.map((impl) => {
  const ofImpl = runs.filter(
    (r) => r.impl === impl && r.suite === opts.suite && r.config.split === "dev",
  );
  const latest = ofImpl.at(-1);
  if (!latest) throw new Error(`no ${opts.suite} runs of ${impl}`);
  return ofImpl
    .filter((r) => sameSetup(r, latest) && !((r.machine.load ?? 0) > r.machine.cores))
    .slice(-Number(opts.last));
});

const rows = HEADLINE.map((m) => {
  const cells = groups.map((g) => {
    // Cached training metrics repeat the run that trained the model, so they'd show no spread.
    const vs = g
      .filter((r) => !(m.name.startsWith("train") && r.metrics.training?.cached))
      .map((r) => m.get(r))
      .filter((v): v is number => v !== undefined);
    if (vs.length < 2) return c.dim("–");
    const changes = vs.flatMap((a, i) =>
      vs
        .filter((_, j) => j !== i)
        .map((b) => (a === b ? 0 : a === 0 ? Infinity : Math.abs(b - a) / Math.abs(a))),
    );
    const sorted = changes.sort((x, y) => x - y);
    if (!Number.isFinite(sorted.at(-1)!)) return c.dim("– (zero)");
    const p90 = percentile(sorted, 0.9);
    const text = `${pctText(p90)} / ${pctText(sorted.at(-1)!)}`;
    return p90 > m.noise ? c.red(text) : text;
  });
  return [m.name, pctText(m.noise), ...cells];
});
console.log(
  renderTable(
    [
      "metric",
      "noise",
      ...impls.map((impl, i) => `${impl}: p90 / max of ${groups[i]!.length} runs`),
    ],
    rows,
  ),
);
