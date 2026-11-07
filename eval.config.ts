import type { Blend } from "./src/data/blend.ts";

/**
 * Default share of each dataset (`src/data/datasets.ts`) in training and eval sets: every prefix
 * of a blended split has the datasets in these proportions until one runs out. A dataset not
 * listed here gets weight 1. The libpostal and not-address weights are in proportion to how many
 * examples each has, so they all run out together; the synthetic address forms and the
 * hand-labeled Alaska voter-file addresses are each about 0.5–2% of the blend.
 */
export const DATASET_WEIGHTS: Record<string, number> = {
  openaddresses: 1,
  osm: 0.76,
  ways: 0.17,
  places: 0.09,
  junk: 0.027,
  embedded: 0.039,
  "po-box": 0.04,
  "rural-route": 0.02,
  "highway-contract": 0.015,
  "general-delivery": 0.012,
  milepost: 0.02,
  military: 0.012,
  "ak-voterfile": 0.04,
};

/**
 * Named training blends for `pnpm eval <impl> --blend <name>`; see `src/data/blend.ts`. The
 * eval set always uses the default blend.
 */
export const BLENDS: Record<string, Blend> = {
  /** The libpostal-derived data alone, without the synthetic address forms. */
  "libpostal-only": { use: ["libpostal", "not-address"] },
  /** No NotAddress examples: what abstaining costs and buys. */
  "no-not-address": { without: ["not-address"] },
};

/**
 * Every knob of the eval harness. A suite trades thoroughness for wall time; pick one with
 * `pnpm eval <impl> --suite <name>`. Runs are only comparable within a suite.
 */
export interface Suite {
  /** Hill-climb on "dev"; look at "test" rarely, so it stays an honest estimate. */
  split: "dev" | "test";
  trainExamples: number;
  evalExamples: number;
  seed: number;
  latency: {
    /** Untimed passes over the eval texts first, so the JIT has warmed up. */
    warmupPasses: number;
    /** Timed calls; the eval texts are cycled until this many have run. */
    calls: number;
  };
  throughput: {
    /** Seconds of back-to-back parsing per measurement. */
    seconds: number;
    /** Measurements per thread count; the median is reported. */
    repeats: number;
    /** Worker-thread counts to measure; each worker loads its own copy of the model. */
    threads: number[];
  };
  /** Train twice and check the model bytes are identical. Doubles training time. */
  determinism: boolean;
  /** Extra train sizes to report accuracy at, showing whether more data would help. */
  learningCurve: number[];
}

export const SUITES = {
  /** Seconds. Checks that an implementation runs end to end. */
  smoke: {
    split: "dev",
    trainExamples: 2_000,
    evalExamples: 500,
    seed: 1,
    latency: { warmupPasses: 1, calls: 2_000 },
    throughput: { seconds: 0.5, repeats: 1, threads: [1] },
    determinism: false,
    learningCurve: [],
  },
  /**
   * Seconds. Runs on the committed fixture in test/fixtures/data (`NERDRESS_DATA_DIR`), which
   * holds exactly this many examples; CI runs it for every impl.
   */
  ci: {
    split: "dev",
    trainExamples: 400,
    evalExamples: 100,
    seed: 1,
    latency: { warmupPasses: 1, calls: 500 },
    throughput: { seconds: 0.2, repeats: 1, threads: [1] },
    determinism: true,
    learningCurve: [100],
  },
  /** About a minute for a fast implementation. The inner hill-climbing loop. */
  quick: {
    split: "dev",
    trainExamples: 50_000,
    evalExamples: 5_000,
    seed: 1,
    latency: { warmupPasses: 2, calls: 100_000 },
    throughput: { seconds: 2, repeats: 3, threads: [1] },
    determinism: false,
    learningCurve: [],
  },
  /** Before keeping a change: more data, multi-threaded throughput, determinism, data curve. */
  full: {
    split: "dev",
    trainExamples: 500_000,
    evalExamples: 20_000,
    seed: 1,
    latency: { warmupPasses: 3, calls: 300_000 },
    throughput: { seconds: 3, repeats: 5, threads: [1, 4] },
    determinism: true,
    learningCurve: [5_000, 50_000],
  },
} satisfies Record<string, Suite>;

export type SuiteName = keyof typeof SUITES;
