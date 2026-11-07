/**
 * Reads blended splits: the datasets of `data/<split>/<dataset>.jsonl` interleaved by weight
 * (`blend.ts`, `mix.ts`). Without weights, the default blend.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Example } from "../types.ts";
import { resolveBlend } from "./blend.ts";
import { mixOrder } from "./mix.ts";
import { DATA_DIR, datasetPath, manifestPath, type Split } from "./paths.ts";

/** Examples per split of every built dataset, in the order the build wrote them. */
export interface Manifest {
  datasets: Record<string, Record<Split, number>>;
}

export function readManifest(dir = DATA_DIR): Manifest {
  const path = manifestPath(dir);
  if (!existsSync(path)) throw new Error(`${path} missing; run \`pnpm data\` first`);
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** The default blend's weights over the built datasets. */
export const defaultWeights = (dir = DATA_DIR) =>
  resolveBlend({}, Object.keys(readManifest(dir).datasets));

/** The first `n` lines of a file. */
async function headLines(path: string, n: number): Promise<string[]> {
  const out: string[] = [];
  if (n === 0) return out;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line) out.push(line);
    if (out.length >= n) break;
  }
  rl.close();
  return out;
}

/**
 * The first `n` JSON lines of a split blended by `weights` (dataset → weight), in blend order,
 * with the dataset each came from.
 */
export async function blendedLines(
  split: Split,
  n: number,
  weights: Readonly<Record<string, number>> = defaultWeights(),
  dir = DATA_DIR,
): Promise<{ line: string; dataset: string }[]> {
  const manifest = readManifest(dir);
  const names = Object.keys(manifest.datasets).filter((d) => (weights[d] ?? 0) > 0);
  for (const d of Object.keys(weights)) {
    if (!manifest.datasets[d])
      throw new Error(`dataset ${d} is not built; run \`pnpm data:build\``);
  }
  const order: { source: number; i: number }[] = [];
  const lengths = names.map((d) => manifest.datasets[d]![split]);
  const shares = names.map((d) => weights[d]!);
  for (const o of mixOrder(lengths, shares)) {
    if (order.length >= n) break;
    order.push(o);
  }
  if (order.length < n) {
    throw new Error(`${split} blend has only ${order.length} examples, ${n} requested`);
  }
  const need = names.map(() => 0);
  for (const o of order) need[o.source] = o.i + 1;
  const lines = await Promise.all(
    names.map((d, s) => headLines(datasetPath(split, d, dir), need[s]!)),
  );
  return order.map((o) => {
    const line = lines[o.source]![o.i];
    if (line === undefined)
      throw new Error(`${datasetPath(split, names[o.source]!, dir)} is short`);
    return { line, dataset: names[o.source]! };
  });
}

/** The first `n` examples of a split blended by `weights`. */
export async function loadExamples(
  split: Split,
  n: number,
  weights?: Readonly<Record<string, number>>,
): Promise<Example[]> {
  return (await blendedLines(split, n, weights)).map((l) => JSON.parse(l.line) as Example);
}

/** Content hash of the first `n` examples of a blended split; changes whenever they do. */
export async function hashSplit(
  split: Split,
  n: number,
  weights?: Readonly<Record<string, number>>,
): Promise<string> {
  const h = createHash("sha256");
  for (const { line } of await blendedLines(split, n, weights)) h.update(line).update("\n");
  return h.digest("hex").slice(0, 16);
}
