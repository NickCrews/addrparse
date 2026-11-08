/**
 * Viterbi decoding for a linear-chain model with `L` states.
 *
 * `emit[i * L + y]` is the score of state y at token i. Transitions are `(L + 1) x (L + 1)` with
 * index L as the boundary: `trans[transIndex(L, a, b)]` scores a→b, so a = L is the start score
 * of b and b = L the end score of a. Only allowed transitions (those seen in gold training
 * sequences) are considered. Training data has states with self-loops that can start and end a
 * sequence (PlaceName, NONE), so some allowed path exists for every length.
 *
 * The number of allowed transitions is what most directly sets parse time: Viterbi here and
 * forward-backward (the confidence) do work per token for every allowed transition. Adding
 * datasets/ak-voterfile.jsonl to the training blend took them from 175 to 308 of 676 and made
 * full-suite parsing ~30% slower (11.3 to 14.8 µs p50, timed back to back), while cutting the
 * model's features by 35% or its weights by a third changed speed by under 5%.
 */
export const transIndex = (L: number, from: number, to: number) => to * (L + 1) + from;

/** Index of the transition into token i of an n-token state sequence (i = n is the end). */
export const pathTransIndex = (L: number, path: ArrayLike<number>, n: number, i: number) =>
  transIndex(L, i === 0 ? L : path[i - 1]!, i === n ? L : path[i]!);

/**
 * Allowed transitions as source lists: the allowed sources of target y (y = L is the end) are
 * `src[srcPtr[y] .. srcPtr[y + 1]]`, and `startOk[y]` says whether y may start a sequence.
 */
export function allowedSources(L: number, allowed: Uint8Array) {
  const src: number[] = [];
  const srcPtr = new Int32Array(L + 2);
  for (let y = 0; y <= L; y++) {
    for (let x = 0; x < L; x++) if (allowed[transIndex(L, x, y)]) src.push(x);
    srcPtr[y + 1] = src.length;
  }
  const startOk = Uint8Array.from({ length: L }, (_, y) => allowed[transIndex(L, L, y)]!);
  return { src: Int32Array.from(src), srcPtr, startOk };
}

export class Viterbi {
  readonly L: number;
  private readonly trans: Float64Array;
  private readonly sources: ReturnType<typeof allowedSources>;
  private score = new Float64Array(0);
  private back = new Int32Array(0);

  /** `trans` is read on every decode, so updates to it (during training) take effect. */
  constructor(L: number, trans: Float64Array, allowed: Uint8Array) {
    this.L = L;
    this.trans = trans;
    this.sources = allowedSources(L, allowed);
  }

  /** Writes the best state sequence into `out` and returns its score. */
  decode(emit: Float64Array, n: number, out: Uint8Array): number {
    if (n === 0) return 0;
    const L = this.L;
    if (this.score.length < n * L) {
      this.score = new Float64Array(n * L * 2);
      this.back = new Int32Array(n * L * 2);
    }
    const { score, back, trans } = this;
    const { src, srcPtr, startOk } = this.sources;
    const T = L + 1;
    for (let y = 0; y < L; y++) {
      score[y] = startOk[y] ? trans[y * T + L]! + emit[y]! : -Infinity;
    }
    for (let i = 1; i < n; i++) {
      const prev = (i - 1) * L;
      const cur = i * L;
      for (let y = 0; y < L; y++) {
        const t = y * T;
        let best = -Infinity;
        let arg = 0;
        const j1 = srcPtr[y + 1]!;
        for (let j = srcPtr[y]!; j < j1; j++) {
          const x = src[j]!;
          const s = score[prev + x]! + trans[t + x]!;
          if (s > best) {
            best = s;
            arg = x;
          }
        }
        score[cur + y] = best + emit[cur + y]!;
        back[cur + y] = arg;
      }
    }
    const last = (n - 1) * L;
    const t = L * T;
    let best = -Infinity;
    let arg = 0;
    for (let j = srcPtr[L]!; j < srcPtr[L + 1]!; j++) {
      const y = src[j]!;
      const s = score[last + y]! + trans[t + y]!;
      if (s > best) {
        best = s;
        arg = y;
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      out[i] = arg;
      arg = back[i * L + arg]!;
    }
    return best;
  }
}
