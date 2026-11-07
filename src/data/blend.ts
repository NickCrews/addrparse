/**
 * A blend is the share of each dataset in a training or eval set. Datasets are interleaved by
 * `mixOrder` (`mix.ts`), so every prefix of a blended split has the datasets in proportion to
 * their weights until one runs out.
 *
 * Weights start from `DATASET_WEIGHTS` in eval.config.ts (1 for a dataset it doesn't list), then
 * a blend narrows and adjusts them:
 *
 * - `use`: keep just these datasets or tags (`libpostal`, `not-address`, `synthetic`,
 *   `labeled`; see `datasets.ts`).
 * - `without`: drop these datasets or tags.
 * - `weights`: set these datasets' weights; 0 drops one.
 *
 * Eval sets always use the default blend, so runs that train on different blends are scored on
 * the same examples.
 */
import { DATASET_WEIGHTS } from "../../eval.config.ts";
import { KIND_TAGS, listDatasets, type DatasetInfo } from "./datasets.ts";

export interface Blend {
  use?: readonly string[];
  without?: readonly string[];
  weights?: Readonly<Record<string, number>>;
}

/** Weight of each dataset in the blend, for the datasets in `available`; none is 0. */
export function resolveBlend(
  blend: Blend,
  available: readonly string[],
  registry: readonly DatasetInfo[] = listDatasets(),
): Record<string, number> {
  const known = new Map(registry.map((d) => [d.name, d]));
  const tags = new Set([...Object.values(KIND_TAGS), ...registry.flatMap((d) => d.tags)]);
  const matches = (ref: string, name: string) =>
    ref === name || !!known.get(name)?.tags.includes(ref);
  for (const ref of [...(blend.use ?? []), ...(blend.without ?? [])]) {
    if (!known.has(ref) && !tags.has(ref)) {
      throw new Error(
        `${ref} is not a dataset or tag; datasets: ${[...known.keys()].join(", ")}; tags: ${[...tags].join(", ")}`,
      );
    }
  }
  for (const name of Object.keys(blend.weights ?? {})) {
    if (!known.has(name)) throw new Error(`${name} is not a dataset`);
    if (!available.includes(name)) throw new Error(`${name} is not built; run \`pnpm data:build\``);
  }
  const out: Record<string, number> = {};
  for (const name of available) {
    if (blend.use && !blend.use.some((r) => matches(r, name))) continue;
    if (blend.without?.some((r) => matches(r, name))) continue;
    const w = blend.weights?.[name] ?? DATASET_WEIGHTS[name] ?? 1;
    if (!(w >= 0) || !Number.isFinite(w)) throw new Error(`${name}: weight ${w} is not >= 0`);
    if (w > 0) out[name] = w;
  }
  if (Object.keys(out).length === 0) throw new Error("the blend leaves out every dataset");
  return out;
}

/** True when the blend changes nothing. */
export const isDefaultBlend = (b: Blend) =>
  !b.use?.length && !b.without?.length && Object.keys(b.weights ?? {}).length === 0;

/**
 * A short stable name for a blend, used in run ids and to match runs with the same blend:
 * "default", or e.g. "use=libpostal,po-box+without=junk+po-box=0.2".
 */
export function blendLabel(b: Blend): string {
  if (isDefaultBlend(b)) return "default";
  const parts: string[] = [];
  if (b.use?.length) parts.push(`use=${[...b.use].sort().join(",")}`);
  if (b.without?.length) parts.push(`without=${[...b.without].sort().join(",")}`);
  for (const [k, v] of Object.entries(b.weights ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`${k}=${v}`);
  }
  return parts.join("+");
}

/** Parses `name=weight` pairs, as given to `--mix`. */
export function parseWeights(pairs: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of pairs) {
    const [name, value, ...rest] = pair.split("=");
    const n = Number(value);
    if (!name || rest.length || value === undefined || value === "" || !(n >= 0)) {
      throw new Error(`${pair}: expected <dataset>=<weight>, weight a number >= 0`);
    }
    out[name] = n;
  }
  return out;
}

/** Splits comma-separated lists, as given to `--use` and `--without`. */
export const parseList = (values: readonly string[]) =>
  values.flatMap((v) => v.split(",")).filter(Boolean);
