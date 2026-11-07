/**
 * The datasets `pnpm data:build` writes, one file per dataset and split
 * (`data/<split>/<dataset>.jsonl`). Training and eval sets are blends of them (`blend.ts`).
 *
 * Built in:
 * - libpostal: openaddresses, osm, ways, places (`libpostal.ts`), refined by `refine.ts`.
 * - not-address: junk and embedded (`not-address.ts`), seeded by the libpostal examples.
 *
 * Added by dropping a file in `datasets/` (see `datasets/README.md`); files starting with `_` are
 * shared code:
 * - `datasets/<name>.ts`: a `GeneratedDataset` whose `generate` builds one labeled example at a
 *   time. Tagged `synthetic`.
 * - `datasets/<name>.jsonl`: hand-labeled examples, one `{"text", "spans"}` object per line.
 *   Tagged `labeled`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Label } from "../labels.ts";
import type { Span } from "../types.ts";
import { LIBPOSTAL_FILES } from "./libpostal.ts";
import { ROOT } from "./paths.ts";

export const DATASETS_DIR = join(ROOT, "datasets");

export type DatasetKind = "libpostal" | "not-address" | "generated" | "labeled";

export interface DatasetInfo {
  name: string;
  kind: DatasetKind;
  /** Group names usable in place of dataset names in a blend's `use` and `without`. */
  tags: string[];
  /** The definition in `datasets/`, for generated and labeled datasets. */
  path?: string;
}

export const KIND_TAGS: Record<DatasetKind, string> = {
  libpostal: "libpostal",
  "not-address": "not-address",
  generated: "synthetic",
  labeled: "labeled",
};

/** Lowercase letters, digits and hyphens, so a name is a file name, a slice name and a CLI token. */
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Every dataset: the built-in ones, then `datasets/` files in name order. */
export function listDatasets(dir = DATASETS_DIR): DatasetInfo[] {
  const builtIn: DatasetInfo[] = [
    ...Object.keys(LIBPOSTAL_FILES).map((name) => info(name, "libpostal")),
    info("junk", "not-address"),
    info("embedded", "not-address"),
  ];
  const added: DatasetInfo[] = [];
  const files = existsSync(dir) ? readdirSync(dir).sort() : [];
  for (const file of files) {
    const m = /^(.+)\.(ts|jsonl)$/.exec(file);
    // `_helpers.ts` files are shared code, not datasets.
    if (!m || file.startsWith("_")) continue;
    const name = m[1]!;
    if (!NAME.test(name)) {
      throw new Error(`datasets/${file}: name must be lowercase letters, digits and hyphens`);
    }
    added.push(info(name, m[2] === "ts" ? "generated" : "labeled", join(dir, file)));
  }
  const all = [...builtIn, ...added];
  const seen = new Set<string>();
  const tags = new Set(Object.values(KIND_TAGS));
  for (const d of all) {
    if (seen.has(d.name)) throw new Error(`two datasets are named ${d.name}`);
    if (tags.has(d.name)) throw new Error(`dataset ${d.name} has the name of a tag`);
    seen.add(d.name);
  }
  return all;
}

function info(name: string, kind: DatasetKind, path?: string): DatasetInfo {
  return { name, kind, tags: [KIND_TAGS[kind]], ...(path ? { path } : {}) };
}

/**
 * A piece of an example's text: a plain string is unlabeled (separators, or words that belong
 * to no label), a `[text, label]` pair is one span.
 */
export type Part = string | readonly [string, Label];

/** Concatenates parts into text and spans. Empty parts are dropped. */
export function fromParts(parts: readonly Part[]): { text: string; spans: Span[] } {
  let text = "";
  const spans: Span[] = [];
  for (const p of parts) {
    if (typeof p === "string") {
      text += p;
    } else if (p[0] !== "") {
      spans.push({ start: text.length, end: text.length + p[0].length, label: p[1] });
      text += p[0];
    }
  }
  return { text, spans };
}

/** An example's text and spans as parts, the inverse of `fromParts`. */
export function toParts(text: string, spans: readonly Span[]): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) parts.push(text.slice(at, s.start));
    parts.push([text.slice(s.start, s.end), s.label]);
    at = s.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

export type Rng = () => number;

/**
 * What `generate` gets for one example. Every random choice must come from `rng`, which is seeded
 * by the dataset name and example number, so builds are deterministic.
 */
export interface GenerateContext {
  rng: Rng;
  /**
   * The city, state, ZIP and country of a real libpostal address ("Kenai, AK 99611"), preceded by
   * the separator that address used before it (", " or " "). `state` limits it to addresses in
   * those states, matched on the state's text ignoring case ("AK", "Alaska"); when there are
   * none, any state is used.
   */
  locality(opts?: { state?: readonly string[] }): Part[];
  /** The street line of a real libpostal address ("123 Main St Apt 4"), with no locality. */
  street(): Part[];
}

/** The default export of a `datasets/<name>.ts` file. */
export interface GeneratedDataset {
  /** One line on what the dataset covers; shown in `pnpm data:build` output and the docs. */
  description: string;
  /**
   * How many examples to generate. Duplicates of earlier texts are dropped, so fewer may be
   * written. Generate more than the largest blend needs: a dataset that runs out leaves the
   * blend's later examples without it.
   */
  count: number;
  /** Add the build's formatting noise (`noise.ts`), as for libpostal examples. Default true. */
  noise?: boolean;
  /** One example, or undefined to skip this number. */
  generate(ctx: GenerateContext): Part[] | undefined;
}

/** Picks one element uniformly. */
export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

/** Picks one key of `weights` with probability proportional to its value. */
export function pickWeighted<T extends string>(rng: Rng, weights: Readonly<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = rng() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries.at(-1)![0];
}

/** An integer in [lo, hi]. */
export const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
