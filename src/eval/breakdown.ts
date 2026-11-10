/**
 * Training mix and accuracy broken down by dimension (`dimensions.ts`).
 *
 *   pnpm slices <run> [--by kind,error] [--sort order|worst|examples] [--min 30] [--json]
 *   pnpm slices <runA> <runB> ...          the same, with B's change from A
 *
 * <run> is a run id, id prefix, impl name (its latest run) or path. Without `--by`, one table per
 * dimension except `state`, which is long. `--by kind,error` crosses dimensions: one row per
 * combination of values. Each row has the value's share of the training set, its number of eval
 * examples, and exact match with a 95% interval (Wilson), so small rows read as uncertain.
 *
 * Numbers are recomputed from the current data and the run's saved predictions
 * (results/predictions/) when the run's data hashes match them, so dimensions added after the run
 * still work. Otherwise they come from the run file, which has single dimensions only.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { hashSplit, loadExamples, blendedLines } from "../data/load.ts";
import { PREDICTIONS_DIR } from "../data/paths.ts";
import type { Example } from "../types.ts";
import { scoreExample } from "./accuracy.ts";
import { DIMENSIONS, dimension, orderedValues, type Dimension } from "./dimensions.ts";
import { c, renderTable, shortId } from "./report.ts";
import { findRun, readPredictions, type RunResult } from "./results.ts";
import { sliceName } from "./slices.ts";
import { wilson } from "./stats.ts";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    by: { type: "string" },
    sort: { type: "string", default: "order" },
    min: { type: "string", default: "1" },
    json: { type: "boolean", default: false },
  },
});
if (
  positionals.length < 1 ||
  positionals.length > 2 ||
  !["order", "worst", "examples"].includes(opts.sort!)
) {
  console.error(
    "usage: pnpm slices <run> [<runB>] [--by kind,error] [--sort order|worst|examples] [--min 30] [--json]" +
      `\ndimensions: ${DIMENSIONS.map((d) => d.name).join(", ")}`,
  );
  process.exit(2);
}
const runs = positionals.map(findRun);
const minExamples = Number(opts.min);
const log = (m: string) => process.stderr.write(c.dim(m) + "\n");

/** Each value of `dims` crossed: one key per combination an example has, e.g. "street & typo". */
function keysOf(ex: Example, dims: readonly Dimension[]): string[] {
  let keys = [""];
  for (const d of dims) {
    const vs = d.of(ex);
    keys = keys.flatMap((k) => vs.map((v) => (k ? `${k} & ${v}` : v)));
  }
  return keys;
}

interface Cell {
  examples: number;
  exact: number;
  tokens: number;
  tokensCorrect: number;
}
interface Breakdown {
  /** Training examples per key, and in all; undefined when the training set is unknown. */
  train?: { total: number; counts: Map<string, number> };
  eval: Map<string, Cell>;
  evalTotal: number;
  /** Where the numbers came from. */
  from: string;
}

/** Combinations in display order: each dimension's value order, crossed. */
function orderedKeys(dims: readonly Dimension[], keys: Iterable<string>): string[] {
  const rank = (k: string) =>
    k.split(" & ").map((v, i) => {
      const at = dims[i]!.values.indexOf(v);
      return at < 0 ? dims[i]!.values.length : at;
    });
  return [...new Set(keys)].sort((a, b) => {
    const ra = rank(a),
      rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return a.localeCompare(b);
  });
}

const loaded = new Map<string, Promise<Example[]>>();
const examplesOf = (split: "dev" | "test", n: number) => {
  const key = `${split}:${n}`;
  if (!loaded.has(key)) loaded.set(key, loadExamples(split, n));
  return loaded.get(key)!;
};

async function trainBreakdown(run: RunResult, dims: readonly Dimension[]) {
  if (run.data.trainHash === null) return { from: "no training set (reference impl)" };
  const n = run.config.trainExamples;
  const weights = run.data.trainWeights;
  try {
    if ((await hashSplit("train", n, weights)) === run.data.trainHash) {
      const counts = new Map<string, number>();
      for (const { line } of await blendedLines("train", n, weights)) {
        for (const k of keysOf(JSON.parse(line) as Example, dims)) {
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
      return { train: { total: n, counts }, from: "current data" };
    }
  } catch {
    // Data not built, or built differently: fall back to the run file.
  }
  const stored = run.data.trainMix;
  if (stored && dims.length === 1 && stored.counts[dims[0]!.name]) {
    const counts = new Map(Object.entries(stored.counts[dims[0]!.name]!));
    return { train: { total: stored.examples, counts }, from: "run file" };
  }
  return { from: "training data differs from the run's and the run file has no mix" };
}

async function evalBreakdown(run: RunResult, dims: readonly Dimension[]) {
  const { split, evalExamples: n } = run.config;
  const predPath = join(PREDICTIONS_DIR, `${run.runId}.jsonl`);
  try {
    if (existsSync(predPath) && (await hashSplit(split, n)) === run.data.evalHash) {
      const examples = await examplesOf(split, n);
      const preds = readPredictions(predPath);
      const cells = new Map<string, Cell>();
      for (const ex of examples) {
        const s = scoreExample(ex, preds.get(ex.id)?.spans ?? []);
        for (const k of keysOf(ex, dims)) {
          const cell = cells.get(k) ?? { examples: 0, exact: 0, tokens: 0, tokensCorrect: 0 };
          cell.examples++;
          if (s.exact) cell.exact++;
          cell.tokens += s.tokens;
          cell.tokensCorrect += s.tokensCorrect;
          cells.set(k, cell);
        }
      }
      return { eval: cells, evalTotal: examples.length, from: "saved predictions" };
    }
  } catch {
    // Data not built: fall back to the run file.
  }
  const slices = run.metrics.accuracy?.slices;
  if (!slices) throw new Error(`${run.runId} has no accuracy metrics`);
  if (dims.length > 1) {
    throw new Error(
      `${run.runId}: crossing dimensions needs its predictions and eval data, which are missing or changed`,
    );
  }
  const d = dims[0]!;
  const cells = new Map<string, Cell>();
  for (const v of d.values) {
    const s = slices[sliceName(d.name, v)];
    if (!s) continue;
    // The run file has token accuracy but not token counts; one "token" carries the rate.
    cells.set(v, {
      examples: s.examples,
      exact: Math.round(s.exactMatch * s.examples),
      tokens: 1,
      tokensCorrect: s.tokenAccuracy,
    });
  }
  return {
    eval: cells,
    evalTotal: n,
    from: cells.size ? "run file" : `run file, which predates the ${d.name} dimension`,
  };
}

async function breakdown(run: RunResult, dims: readonly Dimension[]): Promise<Breakdown> {
  const [t, e] = await Promise.all([trainBreakdown(run, dims), evalBreakdown(run, dims)]);
  return {
    train: t.train,
    eval: e.eval,
    evalTotal: e.evalTotal,
    from: `eval: ${e.from}; train: ${t.from}`,
  };
}

const pct = (x: number | undefined, d = 2) => (x === undefined ? "–" : `${(x * 100).toFixed(d)}%`);
const exactOf = (cell: Cell | undefined) => (cell ? cell.exact / cell.examples : undefined);

interface Row {
  value: string;
  train?: { examples: number; share: number };
  eval: {
    examples: number;
    exactMatch?: number;
    interval?: [number, number];
    tokenAccuracy?: number;
  };
  baseline?: { exactMatch?: number; change?: number; trainShare?: number };
}

function rowsFor(dims: readonly Dimension[], b: Breakdown, base?: Breakdown): Row[] {
  const keys = orderedKeys(dims, [...b.eval.keys(), ...(b.train?.counts.keys() ?? [])]);
  const rows = keys.map((k): Row => {
    const cell = b.eval.get(k);
    const exact = exactOf(cell);
    const trainN = b.train?.counts.get(k) ?? 0;
    const row: Row = {
      value: k,
      ...(b.train ? { train: { examples: trainN, share: trainN / b.train.total } } : {}),
      eval: {
        examples: cell?.examples ?? 0,
        ...(cell
          ? {
              exactMatch: exact,
              interval: wilson(exact!, cell.examples),
              tokenAccuracy: cell.tokens ? cell.tokensCorrect / cell.tokens : undefined,
            }
          : {}),
      },
    };
    if (base) {
      const be = exactOf(base.eval.get(k));
      row.baseline = {
        exactMatch: be,
        change: be !== undefined && exact !== undefined ? exact - be : undefined,
        trainShare: base.train ? (base.train.counts.get(k) ?? 0) / base.train.total : undefined,
      };
    }
    return row;
  });
  const shown = rows.filter(
    (r) => r.eval.examples >= minExamples || (minExamples <= 1 && (r.train?.examples ?? 0) > 0),
  );
  if (opts.sort === "worst") {
    shown.sort((a, b) => (a.eval.exactMatch ?? 2) - (b.eval.exactMatch ?? 2));
  } else if (opts.sort === "examples") {
    shown.sort((a, b) => b.eval.examples - a.eval.examples);
  }
  return shown;
}

function render(dims: readonly Dimension[], rows: Row[], b: Breakdown, base?: Breakdown) {
  const exclusive = dims.every((d) => d.exclusive);
  const header = [
    dims.map((d) => d.name).join(" × "),
    ...(base?.train ? ["train A"] : []),
    base ? "train B" : "train",
    "eval n",
    ...(base ? ["exact A"] : []),
    base ? "exact B" : "exact",
    "95% interval",
    ...(base ? ["Δ"] : ["token acc"]),
  ];
  const lines = rows.map((r) => {
    const small = r.eval.examples < 30;
    const iv = r.eval.interval
      ? `${pct(r.eval.interval[0], 1)}–${pct(r.eval.interval[1], 1)}`
      : "–";
    const change = r.baseline?.change;
    const delta =
      change === undefined
        ? c.dim("–")
        : change === 0
          ? c.dim("=")
          : (change > 0 ? c.green : c.red)(
              `${change > 0 ? "+" : ""}${(change * 100).toFixed(2)}pp`,
            );
    const cells = [
      r.value,
      ...(base?.train ? [pct(r.baseline?.trainShare)] : []),
      pct(r.train?.share),
      String(r.eval.examples),
      ...(base ? [pct(r.baseline?.exactMatch)] : []),
      pct(r.eval.exactMatch),
      small ? c.dim(iv) : iv,
      ...(base ? [delta] : [pct(r.eval.tokenAccuracy)]),
    ];
    return small ? cells.map((x, i) => (i === 0 ? x : c.dim(x))) : cells;
  });
  const note = exclusive
    ? ""
    : c.dim("\nan example can have several values, so shares don't sum to 100%");
  return renderTable(header, lines) + note;
}

const dimSets: Dimension[][] = opts.by
  ? [opts.by.split(",").map(dimension)]
  : DIMENSIONS.filter((d) => d.name !== "state").map((d) => [d]);

const out: unknown[] = [];
const [first, second] = runs as [RunResult, RunResult | undefined];
const subject = second ?? first;
const baseline = second ? first : undefined;
if (!opts.json) {
  if (baseline) console.log(`${c.dim("A")} ${baseline.runId}\n${c.dim("B")} ${subject.runId}\n`);
  else console.log(`${subject.runId}\n`);
}
for (const dims of dimSets) {
  const b = await breakdown(subject, dims);
  const base = baseline ? await breakdown(baseline, dims) : undefined;
  const rows = rowsFor(dims, b, base);
  if (opts.json) {
    out.push({
      dimensions: dims.map((d) => d.name),
      exclusive: dims.every((d) => d.exclusive),
      rows,
    });
  } else {
    console.log(render(dims, rows, b, base));
    log(`${b.from}${base ? ` | A ${base.from}` : ""}`);
    console.log();
  }
}
if (opts.json) {
  console.log(
    JSON.stringify(
      {
        run: subject.runId,
        ...(baseline ? { baseline: baseline.runId } : {}),
        split: subject.config.split,
        trainExamples: subject.config.trainExamples,
        tables: out,
      },
      null,
      2,
    ),
  );
} else if (!baseline) {
  log(`${shortId(subject)}: rows with under 30 eval examples are dimmed; their intervals are wide`);
}
