/**
 * What a browser downloads to run an implementation: its runtime code, bundled and minified
 * by esbuild for the browser, raw and gzip -9 (the model bytes are measured separately).
 *
 * The entry is `impls/<name>/load.ts` when it exists, else `impls/<name>/index.ts`. A bundle
 * of index.ts also contains the training code, because `train` and `load` sit in one object
 * that esbuild can't tree-shake. Implementations keep training code out of the bundle by
 * putting `load` and everything it uses in load.ts (`export function load(model) {…}`) and
 * importing it into index.ts; load.ts must not import training code.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { ROOT } from "../data/paths.ts";
import { implDir } from "./impl.ts";

export interface BundleMetrics {
  /** The bundled entry, relative to the repo root. */
  entry: string;
  /** True when the entry is index.ts, so the bundle includes the training code. */
  includesTraining: boolean;
  bytes: number;
  gzipBytes: number;
  /** Bytes each source file contributes to the minified bundle, largest first. */
  inputs: Record<string, number>;
}

export async function bundleImpl(name: string): Promise<BundleMetrics> {
  const runtime = join(implDir(name), "load.ts");
  const entry = existsSync(runtime) ? runtime : join(implDir(name), "index.ts");
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    absWorkingDir: ROOT,
    write: false,
    metafile: true,
    outfile: "bundle.js",
    logLevel: "silent",
  });
  const code = result.outputFiles[0]!.contents;
  const output = Object.values(result.metafile.outputs)[0]!;
  const inputs = Object.entries(output.inputs)
    .map(([path, i]) => [path, i.bytesInOutput] as const)
    .filter(([, b]) => b > 0)
    .sort((a, b) => b[1] - a[1]);
  return {
    entry: relative(ROOT, entry),
    includesTraining: entry !== runtime,
    bytes: code.byteLength,
    gzipBytes: gzipSync(code, { level: 9 }).byteLength,
    inputs: Object.fromEntries(inputs),
  };
}
