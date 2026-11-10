import { join } from "node:path";
import { build } from "esbuild";
import { ROOT } from "../src/data/paths.ts";

export const PACKAGE_ENTRY = join(import.meta.dirname, "index.ts");

/** Bundles package/index.ts into `outfile` with `model` embedded as base64. */
export async function bundlePackage(model: Uint8Array, outfile: string): Promise<void> {
  await build({
    entryPoints: [PACKAGE_ENTRY],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    define: { __NERDRESS_MODEL__: JSON.stringify(Buffer.from(model).toString("base64")) },
    absWorkingDir: ROOT,
    logLevel: "warning",
  });
}
