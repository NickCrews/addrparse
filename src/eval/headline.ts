/**
 * The metrics shown in comparison tables, in order. Edit this list to change what
 * `pnpm eval` and `pnpm compare` print; the run JSON always has everything.
 *
 * `noise` is the relative change at or below which a difference is shown as unchanged. Timing
 * and RSS numbers vary run to run on one machine; the V8 heap numbers barely do. The values come
 * from `pnpm noise lookup --last 6` over six `pnpm eval lookup --retrain` quick runs on an Apple
 * M1 Max (10 cores, 1-minute load average about 5 from other work): each is the 90th percentile
 * of the relative change between two of those runs, rounded up, so about one in ten repeat runs
 * still shows a coloured change. Throughput gets up to 20%, as full runs moved 16%; "throughput/s
 * 4 threads" runs only in the full suite, where two runs moved 2.3%, and gets the 1-thread value
 * plus a margin for core contention; "train heap peak" moved 2.5% between full runs, as major GCs
 * land at different points of a longer training. noop's timings are too close to the clock's
 * resolution to use. Re-measure after changing the suites or the machine.
 */
import { TARGET_EXACT_MATCH } from "./accuracy.ts";
import type { RunResult } from "./results.ts";

export interface Metric {
  name: string;
  better: "higher" | "lower";
  noise: number;
  format: (v: number) => string;
  /** Show changes as percentage points rather than relative %. For rates like exact match. */
  points?: boolean;
  get: (r: RunResult) => number | undefined;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fixed = (d: number) => (v: number) => v.toFixed(d);
const int = (v: number) => Math.round(v).toLocaleString("en-US");
const bytes = (v: number) =>
  v >= 1024 * 1024 ? `${(v / 1024 / 1024).toFixed(2)} MB` : `${(v / 1024).toFixed(1)} KB`;
const mb = (v: number) => `${v.toFixed(1)} MB`;

/**
 * Training rates are hidden when training took under a millisecond (noop's takes
 * microseconds): there they measure the timer, not the implementation.
 */
const trainRate = (r: RunResult, v: number | undefined) =>
  (r.metrics.training?.seconds ?? 0) >= 0.001 ? v : undefined;
const bundle = (r: RunResult) => {
  const b = r.metrics.bundle;
  return b && "bytes" in b ? b : undefined;
};

const callsPerSec = (threads: string) => (r: RunResult) =>
  r.metrics.throughput?.[threads]?.callsPerSec;

/** A Metric whose changes are shown as relative %. */
const metric = (
  name: string,
  better: Metric["better"],
  noise: number,
  format: Metric["format"],
  get: Metric["get"],
): Metric => ({ name, better, noise, format, get });

/** A share of examples or tokens: shown as a percentage, changes in percentage points. */
const rate = (name: string, better: Metric["better"], get: Metric["get"]): Metric => ({
  name,
  better,
  noise: 0,
  format: pct,
  points: true,
  get,
});

export const HEADLINE: readonly Metric[] = [
  rate("exact match", "higher", (r) => r.metrics.accuracy?.exactMatch),
  rate("token accuracy", "higher", (r) => r.metrics.accuracy?.tokenAccuracy),
  rate("span F1", "higher", (r) => r.metrics.accuracy?.span.f1),
  ...[0.9, 0.8, 0.5].map((coverage) =>
    rate(
      `exact @ ${coverage * 100}% coverage`,
      "higher",
      (r) =>
        r.metrics.accuracy?.riskCoverage?.exactAtCoverage.find((p) => p.coverage === coverage)
          ?.exactMatch,
    ),
  ),
  rate("risk–coverage AURC", "lower", (r) => r.metrics.accuracy?.riskCoverage?.aurc),
  rate(`coverage @ ${TARGET_EXACT_MATCH * 100}% exact`, "higher", (r) => {
    const rc = r.metrics.accuracy?.riskCoverage;
    return rc ? (rc.atTarget?.coverage ?? 0) : undefined;
  }),
  rate("junk abstained", "higher", (r) => {
    const a = r.metrics.accuracy?.abstention;
    return a?.junkExamples ? a.junkAbstained : undefined;
  }),
  rate("addresses abstained", "lower", (r) => r.metrics.accuracy?.abstention?.addressAbstained),
  rate("coarse exact match", "higher", (r) => r.metrics.accuracy?.coarse?.exactMatch),
  metric("latency p50 µs", "lower", 0.2, fixed(1), (r) => r.metrics.latency?.p50Us),
  metric("latency p99 µs", "lower", 0.4, fixed(1), (r) => r.metrics.latency?.p99Us),
  metric("latency µs/token", "lower", 0.2, fixed(2), (r) => r.metrics.latency?.usPerToken),
  metric("throughput/s 1 thread", "higher", 0.2, int, callsPerSec("1")),
  metric("throughput/s 4 threads", "higher", 0.2, int, callsPerSec("4")),
  metric("model size", "lower", 0, bytes, (r) => r.metrics.memory?.modelBytes),
  metric("model size gzip", "lower", 0, bytes, (r) => r.metrics.memory?.modelGzipBytes),
  metric("bundle size", "lower", 0, bytes, (r) => bundle(r)?.bytes),
  metric("bundle size gzip", "lower", 0, bytes, (r) => bundle(r)?.gzipBytes),
  metric("model load ms", "lower", 0.15, fixed(1), (r) => r.metrics.memory?.loadMs),
  metric(
    "infer RSS over baseline",
    "lower",
    0.2,
    mb,
    (r) => r.metrics.memory?.peakRssOverBaselineMB,
  ),
  metric("infer heap peak", "lower", 0.02, mb, (r) => r.metrics.memory?.peakHeapOverBaselineMB),
  metric("model heap", "lower", 0.02, mb, (r) => r.metrics.memory?.modelHeapMB),
  metric("train seconds", "lower", 0.15, fixed(2), (r) => r.metrics.training?.seconds),
  metric("train examples/s", "higher", 0.15, int, (r) =>
    trainRate(r, r.metrics.training?.examplesPerSec),
  ),
  metric(
    "train RSS over baseline",
    "lower",
    0.5,
    mb,
    (r) => r.metrics.training?.peakRssOverBaselineMB,
  ),
  metric("train heap peak", "lower", 0.05, mb, (r) => r.metrics.training?.peakHeapOverBaselineMB),
  metric("train allocated", "lower", 0.03, mb, (r) => r.metrics.training?.allocatedMB),
  metric("code lines", "lower", 0, int, (r) => r.metrics.code?.lines),
];
