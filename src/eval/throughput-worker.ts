/**
 * One throughput thread: loads its own model, warms up, reports ready, then parses
 * back to back for `seconds` after the parent says "go", so all threads run concurrently.
 */
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { importImpl } from "./impl.ts";

const {
  impl: name,
  model,
  texts,
  seconds,
} = workerData as {
  impl: string;
  model: string;
  texts: string[];
  seconds: number;
};
const parser = (await importImpl(name)).load(readFileSync(model));
for (const t of texts) parser.parse(t);

parentPort!.postMessage("ready");
parentPort!.once("message", () => {
  const deadline = performance.now() + seconds * 1000;
  const start = performance.now();
  let calls = 0;
  let sink = 0;
  // Check the clock every 64 calls so timing overhead stays negligible.
  while (true) {
    for (let k = 0; k < 64; k++) sink += parser.parse(texts[calls++ % texts.length]!).length;
    if (performance.now() >= deadline) break;
  }
  parentPort!.postMessage({ calls, seconds: (performance.now() - start) / 1000, sink });
});
