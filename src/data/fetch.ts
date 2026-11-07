/**
 * Streams libpostal's training files from archive.org and keeps the first `limit` US lines of
 * each in data/raw/<source>.tsv. The upstream files are pre-shuffled, so a prefix is a random
 * sample. Re-running is a no-op for sources that already have enough lines.
 *
 *   node src/data/fetch.ts [--limit 600000]
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { parseArgs } from "node:util";
import { LIBPOSTAL_FILES, libpostalUrl, type LibpostalSource } from "./libpostal.ts";
import { RAW_DIR, rawPath } from "./paths.ts";

const { values } = parseArgs({ options: { limit: { type: "string", default: "600000" } } });
const limit = Number(values.limit);

mkdirSync(RAW_DIR, { recursive: true });

for (const source of Object.keys(LIBPOSTAL_FILES) as LibpostalSource[]) {
  const path = rawPath(source);
  if (existsSync(path) && countLines(path) >= limit) {
    console.log(`${source}: already have ${limit}+ lines in ${path}`);
    continue;
  }
  await fetchSource(source, path);
}

async function fetchSource(source: LibpostalSource, path: string): Promise<void> {
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
