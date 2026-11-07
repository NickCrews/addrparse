/**
 * The order in which build.ts reads lines from its sources: a deterministic weighted
 * round-robin, so every prefix of the lines read has the sources in proportion to their weights
 * until one runs out; the rest then continue in proportion to theirs. Ties go to the lower
 * source index, so equal weights alternate line by line.
 */
export function* mixOrder(
  lengths: readonly number[],
  weights: readonly number[],
): Generator<{ source: number; i: number }> {
  const taken = lengths.map(() => 0);
  for (;;) {
    let best = -1;
    let bestScore = Infinity;
    for (let s = 0; s < lengths.length; s++) {
      const w = weights[s]!;
      if (w <= 0 || taken[s]! >= lengths[s]!) continue;
      const score = (taken[s]! + 1) / w;
      if (score < bestScore) {
        best = s;
        bestScore = score;
      }
    }
    if (best < 0) return;
    yield { source: best, i: taken[best]!++ };
  }
}
