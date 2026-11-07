/**
 * Viterbi decoding for a linear-chain model with `L` states.
 *
 * `emit[i * L + y]` is the score of state y at token i. Transitions are `(L + 1) x (L + 1)` with
 * index L as the boundary: `trans[transIndex(L, a, b)]` scores a→b, so a = L is the start score
 * of b and b = L the end score of a. Only allowed transitions (those seen in gold training
 * sequences) are considered. Training data has states with self-loops that can start and end a
 * sequence (PlaceName, NONE), so some allowed path exists for every length.
 */
export const transIndex = (L: number, from: number, to: number) => to * (L + 1) + from;

export class Viterbi {
  readonly L: number;
  private readonly trans: Float64Array;
  /** Allowed sources of target y (y = L is the end) are `src[srcPtr[y] .. srcPtr[y + 1]]`. */
  private readonly src: Int32Array;
  private readonly srcPtr: Int32Array;
  private readonly startOk: Uint8Array;
  private score = new Float64Array(0);
  private back = new Int32Array(0);

  /** `trans` is read on every decode, so updates to it (during training) take effect. */
  constructor(L: number, trans: Float64Array, allowed: Uint8Array) {
    this.L = L;
    this.trans = trans;
    const src: number[] = [];
    this.srcPtr = new Int32Array(L + 2);
    for (let y = 0; y <= L; y++) {
      for (let x = 0; x < L; x++) if (allowed[transIndex(L, x, y)]) src.push(x);
      this.srcPtr[y + 1] = src.length;
    }
    this.src = Int32Array.from(src);
    this.startOk = Uint8Array.from({ length: L }, (_, y) => allowed[transIndex(L, L, y)]!);
  }

  /** Writes the best state sequence into `out` and returns its score. */
  decode(emit: Float64Array, n: number, out: Uint8Array): number {
    if (n === 0) return 0;
    const L = this.L;
    if (this.score.length < n * L) {
      this.score = new Float64Array(n * L * 2);
      this.back = new Int32Array(n * L * 2);
    }
    const score = this.score;
    const back = this.back;
    const trans = this.trans;
    const src = this.src;
    const srcPtr = this.srcPtr;
    const T = L + 1;
    for (let y = 0; y < L; y++) {
      score[y] = this.startOk[y] ? trans[y * T + L]! + emit[y]! : -Infinity;
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
