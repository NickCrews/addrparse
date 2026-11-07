/**
 * Streams libpostal's training files from archive.org and keeps the first US lines of each in
 * data/raw/<source>.tsv, at least as many as SOURCE_LIMITS (libpostal.ts) says. The upstream files are
 * pre-shuffled, so a prefix is a random sample. Re-running is a no-op for sources that already
 * have enough lines.
 *
 *   node src/data/fetch.ts [--limit <source>=<n> ...] [--only <source>,...]
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { parseArgs } from "node:util";
import {
  isSource,
  LIBPOSTAL_FILES,
  libpostalUrl,
  parseSourceNumbers,
  SOURCE_LIMITS,
  type LibpostalSource,
} from "./libpostal.ts";
import { RAW_DIR, rawPath } from "./paths.ts";

const { values } = parseArgs({
  options: {
    limit: { type: "string", multiple: true, default: [] },
    only: { type: "string" },
  },
});
const limits = { ...SOURCE_LIMITS, ...parseSourceNumbers(values.limit ?? []) };
for (const [s, n] of Object.entries(limits)) {
  if (!Number.isInteger(n)) throw new Error(`--limit ${s}=${n}: not a whole number`);
}
const only = values.only?.split(",").filter(Boolean);
for (const s of only ?? []) if (!isSource(s)) throw new Error(`unknown source ${s}`);

mkdirSync(RAW_DIR, { recursive: true });

for (const source of (only as LibpostalSource[] | undefined) ??
  (Object.keys(LIBPOSTAL_FILES) as LibpostalSource[])) {
  const limit = limits[source];
  if (limit === 0) continue;
  const path = rawPath(source);
  if (existsSync(path) && countLines(path) >= limit) {
    console.log(`${source}: already have ${limit}+ lines in ${path}`);
    continue;
  }
  await fetchSource(source, path, limit);
}

async function fetchSource(source: LibpostalSource, path: string, limit: number): Promise<void> {
  const url = libpostalUrl(source);
  console.log(`${source}: streaming ${url}`);
  const abort = new AbortController();
  const res = await fetch(url, { signal: abort.signal });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);

  const gunzip = createGunzip();
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  // Stopping early aborts the download; the resulting stream errors are expected.
  const ignore = () => {};
  body.on("error", ignore);
  gunzip.on("error", ignore);
  body.pipe(gunzip);
  const out = createWriteStream(path);
  let seen = 0;
  let kept = 0;
  try {
    for await (const line of createInterface({ input: gunzip, crlfDelay: Infinity })) {
      seen++;
      if (line.split("\t", 2)[1] !== "us") continue;
      out.write(line + "\n");
      if (++kept >= limit) break;
      if (kept % 100_000 === 0) console.log(`${source}: ${kept} US lines of ${seen} read`);
    }
  } finally {
    abort.abort();
    body.destroy();
    gunzip.destroy();
    await new Promise((resolve) => out.end(resolve));
  }
  console.log(`${source}: kept ${kept} US lines of ${seen} read → ${path}`);
}

function countLines(path: string): number {
  let n = 0;
  for (const byte of readFileSync(path)) if (byte === 10) n++;
  return n;
}
