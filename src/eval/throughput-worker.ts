/**
 * One throughput thread: loads its own model, warms up, reports ready, then parses
 * back to back for `seconds` after the parent says "go", so all threads run concurrently.
 */
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { asScoredParse } from "../types.ts";
import { importImpl } from "./impl.ts";

type WorkerData = { impl: string; model: string; texts: string[]; seconds: number };
const { impl, model, texts, seconds } = workerData as WorkerData;
const parser = (await importImpl(impl)).load(readFileSync(model));
for (const t of texts) parser.parse(t);

parentPort!.postMessage("ready");
parentPort!.once("message", () => {
  const start = performance.now();
  const deadline = start + seconds * 1000;
  let calls = 0;
  let sink = 0;
  // Check the clock every 64 calls so timing overhead stays negligible.
  do {
    for (let k = 0; k < 64; k++) {
      sink += asScoredParse(parser.parse(texts[calls++ % texts.length]!)).spans.length;
    }
  } while (performance.now() < deadline);
  parentPort!.postMessage({ calls, seconds: (performance.now() - start) / 1000, sink });
});
