/**
 * Terminal tables shared by `pnpm eval`, `pnpm compare` and `pnpm errors`.
 * Colour is plain ANSI, off when stdout is not a TTY or NO_COLOR is set.
 */
import { LABEL_NAMES } from "../labels.ts";
import { TARGET_EXACT_MATCH } from "./accuracy.ts";
import { HEADLINE, type Metric } from "./headline.ts";
import { trainBlendOf, type RunResult } from "./results.ts";
import { SLICES } from "./slices.ts";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: sgr("1"),
  dim: sgr("2"),
  red: sgr("31"),
  green: sgr("32"),
  yellow: sgr("33"),
  boldGreen: sgr("1;32"),
};

const visibleLength = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Column 0 is left-aligned, the rest right-aligned unless `align` says otherwise. */
export function renderTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  align?: readonly ("l" | "r")[],
): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => visibleLength(r[i] ?? ""))));
  const line = (r: readonly string[]) =>
    r
      .map((cell, i) => {
        const pad = " ".repeat(widths[i]! - visibleLength(cell));
        return (align?.[i] ?? (i === 0 ? "l" : "r")) === "l" ? cell + pad : pad + cell;
      })
      .join("  ")
      .trimEnd();
  const rule = widths.map((w) => "─".repeat(w)).join("  ");
  return [c.bold(line(header)), c.dim(rule), ...rows.map(line)].join("\n");
}

/** Signed change from `a` to `b`, coloured green/red when beyond the metric's noise, else dim. */
export function formatDelta(m: Metric, a: number | undefined, b: number | undefined): string {
  if (a === undefined || b === undefined) return "";
  if (a === b) return c.dim("=");
  const rel = a === 0 ? Infinity : (b - a) / Math.abs(a);
  const text = m.points
    ? `${b > a ? "+" : ""}${((b - a) * 100).toFixed(2)}pp`
    : Number.isFinite(rel)
      ? `${rel > 0 ? "+" : ""}${(rel * 100).toFixed(1)}%`
      : `${b > a ? "+" : ""}${m.format(b - a)}`;
  if (Math.abs(rel) <= m.noise) return c.dim(text);
  const improved = m.better === "higher" ? b > a : b < a;
  return improved ? c.green(text) : c.red(text);
}

const fmt = (m: Metric, v: number | undefined) => (v === undefined ? c.dim("–") : m.format(v));

/** Headline metrics of a baseline run and a newer run, with the change. */
export function deltaTable(base: RunResult | undefined, run: RunResult, labels?: [string, string]) {
  const [la, lb] = labels ?? [base ? shortId(base) : "previous", shortId(run)];
  const rows: string[][] = [];
  for (const m of HEADLINE) {
    const a = base ? m.get(base) : undefined;
    const b = m.get(run);
    if (a === undefined && b === undefined) continue;
    rows.push([m.name, fmt(m, a), fmt(m, b), formatDelta(m, a, b)]);
  }
  const table = renderTable(["metric", la, lb, "Δ"], rows);
  return run.impl === FLOOR_IMPL
    ? `${table}\n${c.dim(`${FLOOR_IMPL}: timings and memory are the harness's floor, not a parser's`)}`
    : table;
}

/**
 * The impl that does nothing. Its timings and memory are the harness's own floor (loop and
 * call overhead), not a parser's, so side-by-side tables dim its column and never pick it as
 * best.
 */
export const FLOOR_IMPL = "noop";

/** Headline metrics of several runs side by side; the best value of each row is highlighted. */
export function sideBySideTable(runs: readonly RunResult[], labels: readonly string[]) {
  const isFloor = runs.map((r) => r.impl === FLOOR_IMPL);
  const rows: string[][] = [];
  for (const m of HEADLINE) {
    const values = runs.map((r) => m.get(r));
    if (values.every((v) => v === undefined)) continue;
    const ranked = values.filter((v, i): v is number => v !== undefined && !isFloor[i]);
    const best = m.better === "higher" ? Math.max(...ranked) : Math.min(...ranked);
    const distinct = new Set(ranked).size > 1;
    rows.push([
      m.name,
      ...values.map((v, i) => {
        const s = fmt(m, v);
        if (isFloor[i]) return c.dim(s);
        return distinct && v === best ? c.boldGreen(s) : s;
      }),
    ]);
  }
  const header = labels.map((l, i) => (isFloor[i] ? `${l} (floor)` : l));
  return renderTable(["metric", ...header], rows);
}

const pct = (v: number | undefined) => (v === undefined ? c.dim("–") : `${(v * 100).toFixed(2)}%`);

type Detail = "labels" | "slices" | "confidence" | "curve";

/**
 * Per-label span F1, per-slice exact match, the confidence threshold for the target exact match
 * and the learning curve, one column per run.
 */
export function detailTables(
  runs: readonly RunResult[],
  labels: readonly string[],
  which: readonly Detail[] = ["labels", "slices", "confidence", "curve"],
): string {
  const out: string[] = [];
  const labelRows = LABEL_NAMES.filter((l) =>
    runs.some((r) => r.metrics.accuracy?.perLabel[l]),
  ).map((l) => {
    const gold = runs.map((r) => r.metrics.accuracy?.perLabel[l]?.gold).find((g) => g);
    return [l, String(gold ?? 0), ...runs.map((r) => pct(r.metrics.accuracy?.perLabel[l]?.f1))];
  });
  if (which.includes("labels") && labelRows.length)
    out.push(renderTable(["span F1 by label", "gold", ...labels], labelRows));

  const sliceRows = SLICES.filter((s) => runs.some((r) => r.metrics.accuracy?.slices[s.name])).map(
    (s) => {
      const n = runs.map((r) => r.metrics.accuracy?.slices[s.name]?.examples).find((x) => x);
      return [
        s.name,
        String(n ?? 0),
        ...runs.map((r) => pct(r.metrics.accuracy?.slices[s.name]?.exactMatch)),
      ];
    },
  );
  if (which.includes("slices") && sliceRows.length) {
    out.push(renderTable(["exact match by slice", "examples", ...labels], sliceRows));
  }

  const scored = runs.map((r) => r.metrics.accuracy?.riskCoverage);
  if (which.includes("confidence") && scored.some(Boolean)) {
    const row = [
      `confidence threshold @ ${TARGET_EXACT_MATCH * 100}% exact`,
      ...scored.map((rc) => rc?.atTarget?.threshold.toPrecision(4) ?? c.dim("–")),
    ];
    out.push(renderTable(["confidence", ...labels], [row]));
  }

  const sizes = [
    ...new Set(runs.flatMap((r) => r.metrics.learningCurve?.map((p) => p.trainExamples) ?? [])),
  ].sort((a, b) => a - b);
  if (which.includes("curve") && sizes.length) {
    const rows = sizes.map((n) => [
      n.toLocaleString("en-US"),
      ...runs.map((r) =>
        pct(r.metrics.learningCurve?.find((p) => p.trainExamples === n)?.exactMatch),
      ),
    ]);
    out.push(renderTable(["train examples", ...labels.map((l) => `${l} exact`)], rows));
  }
  return out.join("\n\n");
}

/** Lines about why two runs may not be comparable. */
export function comparabilityNotes(runs: readonly RunResult[]): string[] {
  const notes: string[] = [];
  const differ = (f: (r: RunResult) => unknown) =>
    new Set(runs.map((r) => JSON.stringify(f(r)))).size > 1;
  if (differ((r) => r.data.evalHash)) notes.push("eval data differs: accuracy not comparable");
  const trained = runs.filter((r) => r.data.trainHash !== null);
  if (new Set(trained.map((r) => r.data.trainHash)).size > 1) {
    const blends = [...new Set(trained.map(trainBlendOf))];
    notes.push(
      blends.length > 1 ? `training blends differ: ${blends.join(", ")}` : "training data differs",
    );
  }
  const references = runs.filter((r) => r.metrics.reference).map((r) => r.impl);
  if (references.length) {
    notes.push(
      `${[...new Set(references)].join(", ")}: reference, trained elsewhere; accuracy only`,
    );
  }
  if (differ((r) => r.suite)) notes.push("suites differ");
  if (differ((r) => r.machine.cpu)) notes.push("machines differ: timings not comparable");
  const trainedOn = (r: RunResult) => r.metrics.training?.measured?.machine?.cpu ?? r.machine.cpu;
  if (!differ((r) => r.machine.cpu) && differ(trainedOn)) {
    notes.push("cached training metrics come from different machines: not comparable");
  }
  for (const r of runs) {
    const busy = (m: RunResult["machine"] | undefined) => m?.load !== undefined && m.load > m.cores;
    const m = r.machine;
    if (busy(m)) {
      notes.push(
        `machine busy during ${shortId(r)} (load ${m.load!.toFixed(0)} on ${m.cores} cores): timings unreliable`,
      );
    } else if (busy(r.metrics.training?.measured?.machine)) {
      notes.push(`machine busy while training for ${shortId(r)}: training timings unreliable`);
    }
  }
  return notes.map((n) => c.yellow(`note: ${n}`));
}

/** `2026-11-06T18-30-00__crf__quick` → `11-06 18:30 crf`. */
export function shortId(r: RunResult): string {
  const m = /^\d{4}-(\d\d-\d\d)T(\d\d)-(\d\d)/.exec(r.runId);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : r.runId;
}
