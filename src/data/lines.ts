/**
 * Turns one raw libpostal line into a refined example, the same way for `build.ts` and for the
 * override tooling in `override.ts`.
 */
import { createHash } from "node:crypto";
import type { Label } from "../labels.ts";
import type { Example } from "../types.ts";
import { parseLine } from "./libpostal.ts";
import { junkSplitKey } from "./not-address.ts";
import type { Split } from "./paths.ts";
import { refine, type RefineResult } from "./refine.ts";

const IDENTITY_LABELS: ReadonlySet<Label> = new Set([
  "AddressNumber",
  "AddressNumberSuffix",
  "StreetName",
  "PlaceName",
  "ZipCode",
  "USPSBoxID",
]);

export function hashUnit(s: string): number {
  return createHash("sha1").update(s).digest().readUInt32BE(0) / 2 ** 32;
}

/** Stable key of a raw line: the first 16 hex digits of its sha1. Used by overrides/gold.jsonl. */
export function lineKey(line: string): string {
  return createHash("sha1").update(line).digest("hex").slice(0, 16);
}

/**
 * The split of an example, from a hash of its address identity (number and suffix, street name, place, ZIP,
 * box number), not of the text, so two renderings of one address never straddle train and test.
 * Junk examples hash `junkSplitKey`, so variants of one name or phone number share a split.
 */
export function splitFor(ex: Pick<Example, "text" | "spans"> & { source?: string }): Split {
  // A number suffix joins its number with a space, so "1833 B" hashes the same whether or not
  // the suffix is its own span.
  const parts: string[] = [];
  for (const s of ex.spans) {
    if (!IDENTITY_LABELS.has(s.label)) continue;
    const text = ex.text.slice(s.start, s.end).toLowerCase();
    if (s.label === "AddressNumberSuffix" && parts.length > 0)
      parts[parts.length - 1] += ` ${text}`;
    else parts.push(text);
  }
  const identity = parts.join("|");
  const key = ex.source === "junk" ? junkSplitKey(ex.text) : identity || ex.text.toLowerCase();
  const u = hashUnit(key);
  return u < 0.9 ? "train" : u < 0.95 ? "dev" : "test";
}

/**
 * Parses and refines a raw line, or undefined when it doesn't parse. The field separator
 * (", " or " ") is chosen by a hash of the line, so builds are deterministic.
 */
export function refineLine(line: string): RefineResult | undefined {
  const parsed = parseLine(line);
  if (!parsed) return undefined;
  const fieldSeparator = hashUnit(line) < 0.6 ? ", " : " ";
  return refine(parsed.tokens, { fieldSeparator });
}
