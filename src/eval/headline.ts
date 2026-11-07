/**
 * The metrics shown in comparison tables, in order. Edit this list to change what
 * `pnpm eval` and `pnpm compare` print; the run JSON always has everything.
 *
 * `noise` is the relative change at or below which a difference is shown as unchanged. Timing
 * and RSS numbers vary run to run on one machine; the V8 heap numbers barely do. The values
 * come from `pnpm noise lookup --last 6` over six `pnpm eval lookup --retrain` quick runs on an Apple
 * M1 Max (10 cores, 1-minute load average about 5 from other work): each is the 90th
 * percentile of the relative change between two of those runs, rounded up (throughput up to 20%, as full runs moved 16%), so about one in ten
 * repeat runs still shows a coloured change. noop's timings are too close to the clock's
 * resolution to use. "throughput/s 4 threads" runs only in the full suite; two full runs moved 2.3%,
 * and it gets the 1-thread value plus a margin for core contention; "train heap peak" moved 2.5% between
 * full runs, as major GCs land at different points of a longer training. Re-measure after changing the
 * suites or the machine.
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

export const HEADLINE: readonly Metric[] = [
  {
    name: "exact match",
    better: "higher",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => r.metrics.accuracy?.exactMatch,
  },
  {
    name: "token accuracy",
    better: "higher",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => r.metrics.accuracy?.tokenAccuracy,
  },
  {
    name: "span F1",
    better: "higher",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => r.metrics.accuracy?.span.f1,
  },
  ...[0.9, 0.8, 0.5].map((coverage): Metric => ({
    name: `exact @ ${coverage * 100}% coverage`,
    better: "higher",
    noise: 0,
    format: pct,
    points: true,
    get: (r) =>
      r.metrics.accuracy?.riskCoverage?.exactAtCoverage.find((p) => p.coverage === coverage)
        ?.exactMatch,
  })),
  {
    name: "risk–coverage AURC",
    better: "lower",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => r.metrics.accuracy?.riskCoverage?.aurc,
  },
  {
    name: `coverage @ ${TARGET_EXACT_MATCH * 100}% exact`,
    better: "higher",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => {
      const rc = r.metrics.accuracy?.riskCoverage;
      return rc ? (rc.atTarget?.coverage ?? 0) : undefined;
    },
  },
  {
    name: "junk abstained",
    better: "higher",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => {
      const a = r.metrics.accuracy?.abstention;
      return a?.junkExamples ? a.junkAbstained : undefined;
    },
  },
  {
    name: "addresses abstained",
    better: "lower",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => r.metrics.accuracy?.abstention?.addressAbstained,
  },
  {
    name: "coarse exact match",
    better: "higher",
    noise: 0,
    format: pct,
    points: true,
    get: (r) => r.metrics.accuracy?.coarse?.exactMatch,
  },
  {
    name: "latency p50 µs",
    better: "lower",
    noise: 0.2,
    format: fixed(1),
    get: (r) => r.metrics.latency?.p50Us,
  },
  {
    name: "latency p99 µs",
    better: "lower",
    noise: 0.4,
    format: fixed(1),
    get: (r) => r.metrics.latency?.p99Us,
  },
  {
    name: "latency µs/token",
    better: "lower",
    noise: 0.2,
    format: fixed(2),
    get: (r) => r.metrics.latency?.usPerToken,
  },
  {
    name: "throughput/s 1 thread",
    better: "higher",
    noise: 0.2,
    format: int,
    get: (r) => r.metrics.throughput?.["1"]?.callsPerSec,
  },
  {
    name: "throughput/s 4 threads",
    better: "higher",
    noise: 0.2,
    format: int,
    get: (r) => r.metrics.throughput?.["4"]?.callsPerSec,
  },
  {
    name: "model size",
    better: "lower",
    noise: 0,
    format: bytes,
    get: (r) => r.metrics.memory?.modelBytes,
  },
  {
    name: "model size gzip",
    better: "lower",
    noise: 0,
    format: bytes,
    get: (r) => r.metrics.memory?.modelGzipBytes,
  },
  {
    name: "bundle size",
    better: "lower",
    noise: 0,
    format: bytes,
    get: (r) => bundle(r)?.bytes,
  },
  {
    name: "bundle size gzip",
    better: "lower",
    noise: 0,
    format: bytes,
    get: (r) => bundle(r)?.gzipBytes,
  },
  {
    name: "model load ms",
    better: "lower",
    noise: 0.15,
    format: fixed(1),
    get: (r) => r.metrics.memory?.loadMs,
  },
  {
    name: "infer RSS over baseline",
    better: "lower",
    noise: 0.2,
    format: mb,
    get: (r) => r.metrics.memory?.peakRssOverBaselineMB,
  },
  {
    name: "infer heap peak",
    better: "lower",
    noise: 0.02,
    format: mb,
    get: (r) => r.metrics.memory?.peakHeapOverBaselineMB,
  },
  {
    name: "model heap",
    better: "lower",
    noise: 0.02,
    format: mb,
    get: (r) => r.metrics.memory?.modelHeapMB,
  },
  {
    name: "train seconds",
    better: "lower",
    noise: 0.15,
    format: fixed(2),
    get: (r) => r.metrics.training?.seconds,
  },
  {
    name: "train examples/s",
    better: "higher",
    noise: 0.15,
    format: int,
    get: (r) => trainRate(r, r.metrics.training?.examplesPerSec),
  },
  {
    name: "train RSS over baseline",
    better: "lower",
    noise: 0.5,
    format: mb,
    get: (r) => r.metrics.training?.peakRssOverBaselineMB,
  },
  {
    name: "train heap peak",
    better: "lower",
    noise: 0.05,
    format: mb,
    get: (r) => r.metrics.training?.peakHeapOverBaselineMB,
  },
  {
    name: "train allocated",
    better: "lower",
    noise: 0.03,
    format: mb,
    get: (r) => r.metrics.training?.allocatedMB,
  },
  { name: "code lines", better: "lower", noise: 0, format: int, get: (r) => r.metrics.code?.lines },
];
