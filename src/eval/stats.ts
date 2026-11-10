export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

export function median(xs: readonly number[]): number {
  return percentile(
    [...xs].sort((a, b) => a - b),
    0.5,
  );
}

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return xs.length ? s / xs.length : NaN;
}

export const MB = 1024 * 1024;

/**
 * Wilson score interval for a share `p` of `n` trials, at about 95% (`z` = 1.96). Stays inside
 * [0, 1] and is honest at small `n` and at shares near 0 or 1, where p ± z·se is not.
 */
export function wilson(p: number, n: number, z = 1.96): [low: number, high: number] {
  if (n === 0) return [0, 1];
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
