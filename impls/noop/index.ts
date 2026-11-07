/**
 * Returns no spans. Scores zero; its latency, throughput and memory are the harness's own
 * floor, to subtract from other implementations' numbers.
 */
import type { Impl } from "../../src/types.ts";

const impl: Impl = {
  train: () => ({ model: new Uint8Array(0) }),
  load: () => ({ parse: () => [] }),
};

export default impl;
