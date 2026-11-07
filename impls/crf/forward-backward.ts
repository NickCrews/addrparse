/**
 * Forward-backward for a linear chain over the allowed transitions, in probability space with
 * per-token scaling. Training uses the marginals for the gradient; the parser uses log Z for the
 * probability of its Viterbi path.
 */
import { transIndex } from "./viterbi.ts";

/**
 * Marginals of a linear chain, computed in probability space with per-token scaling.
 * After `run`, `node[i * L + y]` is P(y_i = y) and `logZ` the log partition function.
 */
export class ForwardBackward {
  readonly L: number;
  /** Allowed sources of target y (y = L is the end) are `src[srcPtr[y] .. srcPtr[y + 1]]`. */
  readonly src: Int32Array;
  readonly srcPtr: Int32Array;
  readonly startOk: Uint8Array;
  /** exp(transition score), 0 where disallowed; indexed like `trans`. */
  readonly expTrans: Float64Array;
  node = new Float64Array(0);
  alpha = new Float64Array(0);
  beta = new Float64Array(0);
  expEmit = new Float64Array(0);
  scale = new Float64Array(0);
  logZ = 0;

  constructor(L: number, allowed: Uint8Array) {
    this.L = L;
    const src: number[] = [];
    this.srcPtr = new Int32Array(L + 2);
    for (let y = 0; y <= L; y++) {
      for (let x = 0; x < L; x++) if (allowed[transIndex(L, x, y)]) src.push(x);
      this.srcPtr[y + 1] = src.length;
    }
    this.src = Int32Array.from(src);
    this.startOk = Uint8Array.from({ length: L }, (_, y) => allowed[transIndex(L, L, y)]!);
    this.expTrans = new Float64Array((L + 1) * (L + 1));
  }

  /** Recomputes `expTrans` from transition scores; call after the scores change. */
  setTransitions(trans: Float64Array): void {
    const L = this.L;
    this.expTrans.fill(0);
    for (let y = 0; y <= L; y++) {
      for (let j = this.srcPtr[y]!; j < this.srcPtr[y + 1]!; j++) {
        const t = transIndex(L, this.src[j]!, y);
        this.expTrans[t] = Math.exp(trans[t]!);
      }
      if (y < L && this.startOk[y]) {
        const t = transIndex(L, L, y);
        this.expTrans[t] = Math.exp(trans[t]!);
      }
    }
  }

  /** Fills `node` with marginals and sets `logZ`. */
  run(emit: Float64Array, n: number): void {
    const zEnd = this.forward(emit, n);
    this.backward(n, zEnd);
  }

  /** Sets `logZ` and the scaled forward variables; returns the unscaled end mass. */
  forward(emit: Float64Array, n: number): number {
    const L = this.L;
    if (this.node.length < n * L) {
      const m = n * L * 2;
      this.node = new Float64Array(m);
      this.alpha = new Float64Array(m);
      this.beta = new Float64Array(m);
      this.expEmit = new Float64Array(m);
      this.scale = new Float64Array(n * 2);
    }
    const { alpha, expEmit, scale, expTrans, src, srcPtr } = this;
    const T = L + 1;
    let logZ = 0;
    for (let i = 0; i < n; i++) {
      let m = -Infinity;
      for (let y = 0; y < L; y++) m = Math.max(m, emit[i * L + y]!);
      for (let y = 0; y < L; y++) expEmit[i * L + y] = Math.exp(emit[i * L + y]! - m);
      logZ += m;
    }
    let c = 0;
    for (let y = 0; y < L; y++) {
      const a = expTrans[y * T + L]! * expEmit[y]!;
      alpha[y] = a;
      c += a;
    }
    scale[0] = c;
    for (let y = 0; y < L; y++) alpha[y]! /= c;
    for (let i = 1; i < n; i++) {
      const prev = (i - 1) * L;
      const cur = i * L;
      c = 0;
      for (let y = 0; y < L; y++) {
        let s = 0;
        for (let j = srcPtr[y]!; j < srcPtr[y + 1]!; j++) {
          const x = src[j]!;
          s += alpha[prev + x]! * expTrans[y * T + x]!;
        }
        const a = s * expEmit[cur + y]!;
        alpha[cur + y] = a;
        c += a;
      }
      scale[i] = c;
      for (let y = 0; y < L; y++) alpha[cur + y]! /= c;
    }
    const last = (n - 1) * L;
    let zEnd = 0;
    for (let y = 0; y < L; y++) zEnd += alpha[last + y]! * expTrans[L * T + y]!;
    for (let i = 0; i < n; i++) logZ += Math.log(scale[i]!);
    this.logZ = logZ + Math.log(zEnd);
    return zEnd;
  }

  private backward(n: number, zEnd: number): void {
    const L = this.L;
    const { alpha, beta, expEmit, scale, expTrans, src, srcPtr, node } = this;
    const T = L + 1;
    const last = (n - 1) * L;
    for (let x = 0; x < L; x++) beta[last + x] = expTrans[L * T + x]! / zEnd;
    for (let i = n - 2; i >= 0; i--) {
      const cur = i * L;
      const next = (i + 1) * L;
      for (let x = 0; x < L; x++) beta[cur + x] = 0;
      for (let y = 0; y < L; y++) {
        const v = (expEmit[next + y]! * beta[next + y]!) / scale[i + 1]!;
        if (v === 0) continue;
        for (let j = srcPtr[y]!; j < srcPtr[y + 1]!; j++) {
          const x = src[j]!;
          beta[cur + x]! += expTrans[y * T + x]! * v;
        }
      }
    }
    for (let k = 0; k < n * L; k++) node[k] = alpha[k]! * beta[k]!;
  }
}
