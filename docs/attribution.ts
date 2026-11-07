import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/data/paths.ts";

/**
 * The model attribution blockquote under "Distributing a trained model" in CONTRIBUTING.md, as
 * one line of plain text. The docs page and the npm package both ship it.
 */
export function readAttribution(): string {
  const text = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8");
  const m = /Ship this attribution[\s\S]*?\n\n((?:[ \t]*>[^\n]*\n)+)/.exec(text);
  if (!m) throw new Error("CONTRIBUTING.md: attribution blockquote not found");
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
