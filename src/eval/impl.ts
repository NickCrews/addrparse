import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { IMPLS_DIR, ROOT } from "../data/paths.ts";
import type { Impl } from "../types.ts";

export function implDir(name: string): string {
  return join(IMPLS_DIR, name);
}

export function listImpls(): string[] {
  return readdirSync(IMPLS_DIR).filter((n) => existsSync(join(IMPLS_DIR, n, "index.ts")));
}

export async function importImpl(name: string): Promise<Impl> {
  const path = join(implDir(name), "index.ts");
  if (!existsSync(path)) throw new Error(`no ${path}; impls are ${listImpls().join(", ")}`);
  const mod = (await import(path)) as { default?: Impl };
  if (!mod.default?.train || !mod.default.load) {
    throw new Error(`${path} must default-export { train, load }`);
  }
  return mod.default;
}

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** Source files that can change a model: the impl's own directory plus shared src/, minus the harness. */
function sourceFiles(name: string): string[] {
  const shared = walk(join(ROOT, "src")).filter((p) => !p.includes(`${join("src", "eval")}`));
  return [...walk(implDir(name)), ...shared].filter((p) => p.endsWith(".ts"));
}

export function implSourceHash(name: string): string {
  const h = createHash("sha256");
  for (const p of sourceFiles(name)) h.update(relative(ROOT, p)).update(readFileSync(p));
  return h.digest("hex").slice(0, 16);
}

/** Size of the implementation's own code (not shared src/). */
export function implCodeSize(name: string): { bytes: number; lines: number; files: number } {
  const files = walk(implDir(name)).filter((p) => p.endsWith(".ts"));
  let bytes = 0;
  let lines = 0;
  for (const p of files) {
    const text = readFileSync(p, "utf8");
    bytes += Buffer.byteLength(text);
    lines += text.split("\n").length;
  }
  return { bytes, lines, files: files.length };
}
