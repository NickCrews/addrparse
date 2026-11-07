import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { IMPLS_DIR, ROOT } from "../data/paths.ts";
import type { Impl, ReferenceImpl } from "../types.ts";

export function implDir(name: string): string {
  return join(IMPLS_DIR, name);
}

export function listImpls(): string[] {
  return readdirSync(IMPLS_DIR).filter((n) => existsSync(join(IMPLS_DIR, n, "index.ts")));
}

async function importDefault(name: string): Promise<Partial<Impl & ReferenceImpl>> {
  const path = join(implDir(name), "index.ts");
  if (!existsSync(path)) throw new Error(`no ${path}; impls are ${listImpls().join(", ")}`);
  const mod = (await import(path)) as { default?: Partial<Impl & ReferenceImpl> };
  return mod.default ?? {};
}

export async function importImpl(name: string): Promise<Impl> {
  const impl = await importDefault(name);
  if (!impl.train || !impl.load) {
    throw new Error(`impls/${name}/index.ts must default-export { train, load }`);
  }
  return impl as Impl;
}

/** The impl as a ReferenceImpl, or undefined when it is an ordinary trainable Impl. */
export async function importReference(name: string): Promise<ReferenceImpl | undefined> {
  const impl = await importDefault(name);
  return impl.predict ? (impl as ReferenceImpl) : undefined;
}

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/**
 * Source files that can change a model or a reference's predictions: the impl's own directory
 * (TypeScript, plus Python scripts and their uv lockfiles) and shared src/, minus the harness.
 */
function sourceFiles(name: string): string[] {
  const own = walk(implDir(name)).filter((p) => /\.(ts|py|lock)$/.test(p));
  const shared = walk(join(ROOT, "src")).filter(
    (p) => p.endsWith(".ts") && !p.includes(`${join("src", "eval")}`),
  );
  return [...own, ...shared];
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
