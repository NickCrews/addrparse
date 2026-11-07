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
}

/** A loaded model. `parse` must be synchronous and side-effect free. */
export interface Parser {
  parse(text: string): Span[];
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
