/** Pieces the synthetic address-form datasets share. Not a dataset: its name starts with `_`. */
import {
  int,
  pick,
  pickWeighted,
  type GenerateContext,
  type Part,
  type Rng,
} from "../src/data/datasets.ts";

/** Spellings of Alaska, for `ctx.locality({ state: ALASKA })`. */
export const ALASKA = ["AK", "Alaska", "ALASKA", "Ak"];

/**
 * A box number: mostly 2-4 digits, sometimes 1, 5 or 6, now and then with a letter or a
 * hyphenated suffix ("123A", "1234-B").
 */
export function boxNumber(rng: Rng): string {
  const digits = pickWeighted(rng, { 1: 8, 2: 18, 3: 28, 4: 32, 5: 12, 6: 2 });
  let n = String(int(rng, 1, 9));
  for (let k = 1; k < Number(digits); k++) n += String(int(rng, 0, 9));
  const r = rng();
  if (r < 0.03) n += pick(rng, ["A", "B", "C", "D"]);
  else if (r < 0.04) n += `-${pick(rng, ["A", "B", "1", "2"])}`;
  return n;
}

/** "Box 12" after a route ("RR 2 Box 12"), as parts. */
export function routeBox(rng: Rng): Part[] {
  const type = pickWeighted(rng, { Box: 80, BOX: 14, Bx: 3, "Box #": 3 });
  return [[type, "USPSBoxType"], " ", [boxNumber(rng), "USPSBoxID"]];
}

/** The separator between a route and its box: "RR 2 Box 5" or "RR 2, Box 5". */
export const routeSeparator = (rng: Rng) => (rng() < 0.75 ? " " : ", ");

/**
 * `line` followed by a real locality with probability `p`, else alone, as people write the
 * first line of a form. `state` prefers localities in those states for `preferState` of them.
 */
export function withLocality(
  ctx: GenerateContext,
  line: Part[],
  p: number,
  opts: { state?: readonly string[]; preferState?: number } = {},
): Part[] {
  if (ctx.rng() >= p) return line;
  const state = opts.state && ctx.rng() < (opts.preferState ?? 1) ? opts.state : undefined;
  return [...line, ...ctx.locality(state ? { state } : undefined)];
}
