import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Example } from "../types.ts";
import { splitPath, type Split } from "./paths.ts";

/** The first `limit` examples of a split, in file order. */
export async function loadExamples(split: Split, limit: number): Promise<Example[]> {
  const path = splitPath(split);
  if (!existsSync(path)) throw new Error(`${path} missing; run \`pnpm data\` first`);
  const out: Example[] = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (out.length >= limit) break;
    if (line) out.push(JSON.parse(line) as Example);
  }
  rl.close();
  if (out.length < limit) {
    throw new Error(`${split} has only ${out.length} examples, ${limit} requested`);
  }
  return out;
}

/** Content hash of the first `limit` lines of a split; changes whenever the data or labels do. */
export async function hashSplit(split: Split, limit: number): Promise<string> {
  const h = createHash("sha256");
  const rl = createInterface({ input: createReadStream(splitPath(split)), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (n++ >= limit) break;
    h.update(line).update("\n");
  }
  rl.close();
  return h.digest("hex").slice(0, 16);
}
