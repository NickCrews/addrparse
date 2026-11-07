import type { Label } from "./labels.ts";

/** A labeled character range `[start, end)` of an input string. */
export interface Span {
  start: number;
  end: number;
  label: Label;
}

/** One labeled example. `spans` never overlap and are sorted by `start`. */
export interface Example {
  id: string;
  text: string;
  spans: Span[];
  /** Which upstream file the example came from, e.g. "openaddresses" or "osm". */
  source: string;
  /**
   * Notes from building the gold labels (`src/data/refine.ts`, `src/data/gold.ts`), each naming a
   * heuristic the labels rest on, e.g. "road:truncated-suffix". Exceptions: "dropped:<field>"
   * says a field was removed from the text, and "override" that the labels were checked by hand.
   */
  notes?: string[];
  /** Formatting noise applied after rendering, e.g. ["unit-joined"]; see src/data/noise.ts. */
  noise?: string[];
}

/**
 * A parse with the parser's confidence that it is exactly right. Only the ranking of
 * confidences matters to the harness (higher = more confident), so a sequence probability,
 * a margin or a heuristic score all work; a probability in [0, 1] makes thresholds readable.
 */
export interface ScoredParse {
  spans: Span[];
  confidence?: number;
}

/**
 * A loaded model. `parse` must be synchronous and side-effect free. It returns either bare
 * spans or a `ScoredParse`; returning confidences turns on the risk–coverage metrics.
 */
export interface Parser {
  parse(text: string): Span[] | ScoredParse;
}

/** A `parse` return value as a `ScoredParse`. */
export function asScoredParse(result: Span[] | ScoredParse): ScoredParse {
  return Array.isArray(result) ? { spans: result } : result;
}

export interface TrainContext {
  seed: number;
  /** Progress output; goes to the training child's stderr, not to results. */
  log(message: string): void;
}

export interface TrainResult {
  model: Uint8Array;
  /** Numbers or strings the implementation wants recorded, e.g. feature count or epochs. */
  info?: Record<string, number | string>;
}

/**
 * The contract every implementation in `impls/<name>/index.ts` default-exports.
 * Training and inference always run in separate processes and only share `model` bytes,
 * so the serialized size and load cost are part of what gets measured.
 */
export interface Impl {
  train(examples: readonly Example[], ctx: TrainContext): TrainResult | Promise<TrainResult>;
  load(model: Uint8Array): Parser;
}

/**
 * A parser that runs outside Node (a Python package, a C library) and is trained elsewhere.
 * `impls/<name>/index.ts` default-exports one instead of an `Impl`. The harness measures only
 * its accuracy: speed and memory of a subprocess aren't comparable to an in-process parse.
 */
export interface ReferenceImpl {
  /** Parses every text; `spans[i]` is the parse of `texts[i]`. */
  predict(
    texts: readonly string[],
    ctx: { log(message: string): void },
  ): Promise<ReferencePrediction>;
}

export interface ReferencePrediction {
  spans: Span[][];
  /** Texts the parser failed on (their spans are empty), and the first failure. */
  parseErrors: number;
  firstError?: string;
  /** Versions and counts the implementation wants recorded, e.g. package versions. */
  info: Record<string, number | string>;
}
