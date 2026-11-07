/**
 * Shows the examples a run got wrong, one token per row with gold and predicted labels.
 *
 *   pnpm errors <run> [--label X] [--slice name] [--limit 20]
 *
 * <run> is a run id, id prefix, impl name (its latest run) or path. `--label` keeps examples
 * where X is the gold or predicted label of some token; `--slice` uses a name from slices.ts.
 * Labels are shown BIO-style: B- starts a span, I- continues it, so boundary errors show too.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { hashSplit, loadExamples } from "../data/load.ts";
import { PREDICTIONS_DIR, splitPath } from "../data/paths.ts";
import { tokenize } from "../tokens.ts";
import type { ScoredParse, Span } from "../types.ts";
import { normalizeSpans, scoreExample } from "./accuracy.ts";
import { c, renderTable } from "./report.ts";
import { findRun } from "./results.ts";
import { SLICES } from "./slices.ts";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: "string" },
    slice: { type: "string" },
    limit: { type: "string", default: "20" },
  },
});
if (positionals.length !== 1) {
  console.error("usage: pnpm errors <run> [--label X] [--slice name] [--limit 20]");
  process.exit(2);
}

const run = findRun(positionals[0]!);
const predPath = join(PREDICTIONS_DIR, `${run.runId}.jsonl`);
if (!existsSync(predPath)) throw new Error(`${predPath} missing; the run had no accuracy step`);
const { split, evalExamples } = run.config;
const examples = await loadExamples(split, evalExamples);
if ((await hashSplit(split, evalExamples)) !== run.data.evalHash) {
  console.log(c.yellow(`note: ${splitPath(split)} changed since this run; ids may not line up`));
}
const predicted = new Map<string, Span[]>();
const confidence = new Map<string, number>();
for (const line of readFileSync(predPath, "utf8").split("\n")) {
  if (!line) continue;
  const p = JSON.parse(line) as ScoredParse & { id: string };
  predicted.set(p.id, p.spans);
  // JSON writes NaN and ±Infinity as null.
  if (typeof p.confidence === "number") confidence.set(p.id, p.confidence);
}

const slice = opts.slice ? SLICES.find((s) => s.name === opts.slice) : undefined;
if (opts.slice && !slice) {
  throw new Error(`unknown slice ${opts.slice}; slices: ${SLICES.map((s) => s.name).join(", ")}`);
}

/** BIO tag of each token: B-/I- prefix plus label, or "-" for unlabeled. */
function bio(text: string, spans: readonly Span[]): string[] {
  const norm = normalizeSpans(text, spans);
  return tokenize(text).map((t) => {
    const s = norm.find((s) => s.start <= t.coreStart && t.coreStart < s.end);
    return s ? `${s.start === t.coreStart ? "B" : "I"}-${s.label}` : "-";
  });
}

const inScope = examples.filter((ex) => !slice || slice.test(ex));
const wrong = inScope.filter((ex) => {
  const score = scoreExample(ex, predicted.get(ex.id) ?? []);
  if (score.exact) return false;
  return !opts.label || score.tokenPairs.some(([g, p]) => g === opts.label || p === opts.label);
});

const limit = Number(opts.limit);
console.log(
  `${run.runId}: ${wrong.length} of ${inScope.length} ${slice ? `"${slice.name}" ` : ""}` +
    `examples misparsed${opts.label ? ` involving ${opts.label}` : ""}; showing ${Math.min(limit, wrong.length)}`,
);
if (!opts.label && !slice) {
  const top = run.metrics.accuracy?.confusions.slice(0, 8) ?? [];
  if (top.length) {
    console.log(
      "\n" +
        renderTable(
          ["top token confusions: gold", "predicted", "count"],
          top.map((x) => [x.gold, x.predicted, String(x.count)]),
          ["l", "l", "r"],
        ),
    );
  }
}

for (const ex of wrong.slice(0, limit)) {
  const tokens = tokenize(ex.text);
  const gold = bio(ex.text, ex.spans);
  const pred = bio(ex.text, predicted.get(ex.id) ?? []);
  const rows = tokens.map((t, i) => {
    const ok = gold[i] === pred[i];
    return [
      ex.text.slice(t.start, t.end),
      gold[i]!,
      ok ? c.dim(pred[i]!) : c.red(pred[i]!),
      ok ? "" : c.red("✗"),
    ];
  });
  const tags = [ex.source, ...(ex.noise ?? [])].join(", ");
  const conf = confidence.get(ex.id);
  const meta = `${ex.id} (${tags})${conf === undefined ? "" : ` confidence ${conf.toPrecision(3)}`}`;
  console.log(`\n${c.bold(ex.text.replaceAll("\n", "\\n"))}  ${c.dim(meta)}`);
  console.log(renderTable(["token", "gold", "predicted", ""], rows, ["l", "l", "l", "l"]));
}
