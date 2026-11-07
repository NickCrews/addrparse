/**
 * Peak RSS over a window of time. The OS's maxRSS covers the whole process lifetime, including
 * startup and data loading, so it can't isolate one phase. A worker thread samples the
 * process's RSS every millisecond instead; it keeps sampling while the main thread is busy in
 * synchronous code. Spikes shorter than a millisecond can be missed.
 */
import { Worker } from "node:worker_threads";

const WORKER = `
const { workerData } = require("node:worker_threads");
const peak = new BigInt64Array(workerData);
setInterval(() => {
  const rss = BigInt(process.memoryUsage.rss());
  let cur = Atomics.load(peak, 0);
  while (rss > cur) {
    const prev = Atomics.compareExchange(peak, 0, cur, rss);
    if (prev === cur) break;
    cur = prev;
  }
}, 1);
`;

export interface RssSampler {
  /** Starts a new window at the current RSS. */
  reset(): void;
  /** Highest RSS seen since the last reset, in bytes. */
  peak(): number;
  stop(): Promise<number>;
}

export async function startRssSampler(): Promise<RssSampler> {
  const buf = new SharedArrayBuffer(8);
  const peak = new BigInt64Array(buf);
  const worker = new Worker(WORKER, { eval: true, workerData: buf });
  await new Promise((resolve) => worker.once("online", resolve));
  const sampler: RssSampler = {
    reset: () => Atomics.store(peak, 0, BigInt(process.memoryUsage.rss())),
    peak: () => Math.max(Number(Atomics.load(peak, 0)), process.memoryUsage.rss()),
    stop: () => worker.terminate(),
  };
  sampler.reset();
  return sampler;
}
