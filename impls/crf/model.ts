/**
 * States, model parameters, the binary model format, and the parser built from them.
 *
 * Format (little-endian):
 *   u32 magic "CRF2" | u32 states | u32 features | u32 entries | f32 scale
 *   f32[(states + 1)^2] transitions, laid out as in viterbi.ts; -Infinity where disallowed
 *   u32[features] feature hashes (int32), ascending, delta-encoded mod 2^32
 *   u8[features] number of nonzero weights per feature
 *   u8[entries] state of each nonzero weight, feature by feature
 *   i16[entries] each nonzero weight divided by `scale`
 */
import { LABEL_NAMES, type Label } from "../../src/labels.ts";
import type { ScoredParse, Span } from "../../src/types.ts";
import { Features, type Tokens } from "./features.ts";
import { ForwardBackward } from "./forward-backward.ts";
import { FeatureTable } from "./table.ts";
import { Viterbi } from "./viterbi.ts";

// ---------------------------------------------------------------------------------------------
// States

/** Tokens outside every span, e.g. a lone "-". */
export const NONE = LABEL_NAMES.length;
/**
 * Labels whose spans can sit next to each other with no separator ("Sub Basement Unit 4",
 * "5th Levl Ap # 123"). Each gets a second state that starts a new span.
 */
const SPLIT_LABELS: readonly Label[] = ["OccupancyType", "OccupancyIdentifier"];
export const STATES = LABEL_NAMES.length + 1 + SPLIT_LABELS.length;

/** Label index of each state, or -1 for NONE. */
const STATE_LABEL = Int8Array.from({ length: STATES }, (_, y) =>
  y < NONE ? y : y === NONE ? -1 : LABEL_NAMES.indexOf(SPLIT_LABELS[y - NONE - 1]!),
);
/** The split state of each label index, or -1. */
const SPLIT_STATE = Int8Array.from(LABEL_NAMES, (l) => {
  const k = SPLIT_LABELS.indexOf(l);
  return k < 0 ? -1 : NONE + 1 + k;
});
const LABEL_INDEX: ReadonlyMap<Label, number> = new Map(LABEL_NAMES.map((l, k) => [l, k]));

const separated = (tokens: Tokens, i: number) =>
  tokens.coreEnd[i - 1] !== tokens.end[i - 1] || tokens.coreStart[i] !== tokens.start[i];

/**
 * Gold state of each token: the label of the span covering its first core character, the
 * label's split state when the token starts a span right after an unseparated span of the same
 * label, or NONE.
 */
export function goldStates(tokens: Tokens, spans: readonly Span[], out: Uint8Array): void {
  let prevSpan = -1;
  let prevLabel = -1;
  for (let i = 0; i < tokens.n; i++) {
    const c = tokens.coreStart[i]!;
    const span = spans.findIndex((s) => s.start <= c && c < s.end);
    if (span < 0) {
      out[i] = NONE;
      prevLabel = -1;
    } else {
      const label = LABEL_INDEX.get(spans[span]!.label)!;
      const split = SPLIT_STATE[label]!;
      const adjacent = prevLabel === label && span !== prevSpan && !separated(tokens, i);
      out[i] = adjacent && split >= 0 ? split : label;
      prevLabel = label;
    }
    prevSpan = span;
  }
}

/**
 * Spans from per-token states. Adjacent tokens with the same label merge unless separator
 * punctuation sits between them, as in `spansFromTokens` (src/tokens.ts), or the second token
 * has a split state.
 */
export function spansFromStates(tokens: Tokens, states: ArrayLike<number>): Span[] {
  const spans: Span[] = [];
  let prevLabel = -1;
  for (let i = 0; i < tokens.n; i++) {
    const y = states[i]!;
    const label = STATE_LABEL[y]!;
    if (label >= 0 && label === prevLabel && y < NONE && !separated(tokens, i)) {
      spans[spans.length - 1]!.end = tokens.coreEnd[i]!;
    } else if (label >= 0) {
      spans.push({
        start: tokens.coreStart[i]!,
        end: tokens.coreEnd[i]!,
        label: LABEL_NAMES[label]!,
      });
    }
    prevLabel = label;
  }
  return spans;
}

// ---------------------------------------------------------------------------------------------
// Parameters and format

/** Dense parameters, as training produces them. */
export interface Params {
  /** Feature hashes; row k of `weights` belongs to `keys[k]`. */
  keys: Int32Array;
  /** `keys.length * STATES` emission weights. */
  weights: Float32Array;
  /** `(STATES + 1)^2` transition weights, laid out as in viterbi.ts. */
  trans: Float32Array;
}

/** Sparse parameters, as inference uses them. Row k holds entries `rowPtr[k] .. rowPtr[k+1]`. */
export interface SparseParams {
  keys: Int32Array;
  rowPtr: Int32Array;
  states: Uint8Array;
  values: Float32Array;
  trans: Float32Array;
}

const MAGIC = 0x32465243; // "CRF2"
const HEADER = 20;

/**
 * Keeps weights of magnitude at least `minWeight` (features left with none are dropped),
 * quantizes them to int16 and serializes.
 */
export function encode(p: Params, minWeight: number): Uint8Array {
  const L = STATES;
  let maxAbs = 0;
  for (const w of p.weights) maxAbs = Math.max(maxAbs, Math.abs(w));
  const scale = maxAbs > 0 ? maxAbs / 32767 : 1;
  const threshold = Math.max(minWeight, scale / 2);
  const rows: number[] = [];
  let entries = 0;
  for (let k = 0; k < p.keys.length; k++) {
    let c = 0;
    for (let y = 0; y < L; y++) if (Math.abs(p.weights[k * L + y]!) >= threshold) c++;
    if (c > 0) {
      rows.push(k);
      entries += c;
    }
  }
  rows.sort((a, b) => p.keys[a]! - p.keys[b]!);
  const nf = rows.length;
  const T = (L + 1) * (L + 1);
  const bytes = new Uint8Array(HEADER + 4 * T + 5 * nf + 3 * entries);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, L, true);
  view.setUint32(8, nf, true);
  view.setUint32(12, entries, true);
  view.setFloat32(16, scale, true);
  let o = HEADER;
  for (let t = 0; t < T; t++, o += 4) view.setFloat32(o, p.trans[t]!, true);
  let prev = 0;
  for (const k of rows) {
    view.setUint32(o, (p.keys[k]! - prev) >>> 0, true);
    prev = p.keys[k]!;
    o += 4;
  }
  let so = o + nf;
  let vo = so + entries;
  for (const k of rows) {
    let c = 0;
    for (let y = 0; y < L; y++) {
      const w = p.weights[k * L + y]!;
      if (Math.abs(w) < threshold) continue;
      bytes[so++] = y;
      view.setInt16(vo, Math.round(w / scale), true);
      vo += 2;
      c++;
    }
    bytes[o++] = c;
  }
  return bytes;
}

export function decode(bytes: Uint8Array): SparseParams {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("not a CRF2 model");
  const L = view.getUint32(4, true);
  if (L !== STATES) throw new Error(`model has ${L} states, expected ${STATES}`);
  const nf = view.getUint32(8, true);
  const entries = view.getUint32(12, true);
  const scale = view.getFloat32(16, true);
  const T = (L + 1) * (L + 1);
  const trans = new Float32Array(T);
  let o = HEADER;
  for (let t = 0; t < T; t++, o += 4) trans[t] = view.getFloat32(o, true);
  const keys = new Int32Array(nf);
  let prev = 0;
  for (let k = 0; k < nf; k++, o += 4) keys[k] = prev = (prev + view.getUint32(o, true)) | 0;
  const rowPtr = new Int32Array(nf + 1);
  for (let k = 0; k < nf; k++) rowPtr[k + 1] = rowPtr[k]! + bytes[o++]!;
  const states = bytes.slice(o, o + entries);
  o += entries;
  const values = new Float32Array(entries);
  for (let e = 0; e < entries; e++, o += 2) values[e] = view.getInt16(o, true) * scale;
  return { keys, rowPtr, states, values, trans };
}

// ---------------------------------------------------------------------------------------------
// Inference

export class CrfParser {
  private readonly fx = new Features();
  private readonly viterbi: Viterbi;
  private readonly fb: ForwardBackward;
  /** Feature hash to row of `rowPtr`. */
  private readonly rows: FeatureTable;
  private readonly rowPtr: Int32Array;
  private readonly states: Uint8Array;
  private readonly values: Float64Array;
  private emit = new Float64Array(64 * STATES);
  private path = new Uint8Array(64);

  constructor(p: SparseParams) {
    this.rows = new FeatureTable(p.keys.length);
    for (let k = 0; k < p.keys.length; k++) this.rows.slot(p.keys[k]!, k);
    this.rowPtr = p.rowPtr;
    this.states = p.states;
    this.values = Float64Array.from(p.values);
    const trans = Float64Array.from(p.trans);
    const allowed = Uint8Array.from(trans, (t) => (t === -Infinity ? 0 : 1));
    this.viterbi = new Viterbi(STATES, trans, allowed);
    this.fb = new ForwardBackward(STATES, allowed);
    this.fb.setTransitions(trans);
  }

  parse(text: string): ScoredParse {
    const fx = this.fx;
    const n = fx.extract(text);
    const L = STATES;
    if (this.emit.length < n * L) {
      this.emit = new Float64Array(n * L * 2);
      this.path = new Uint8Array(n * 2);
    }
    const { emit, rows, rowPtr, states, values } = this;
    const { feats, offs } = fx;
    emit.fill(0, 0, n * L);
    for (let i = 0; i < n; i++) {
      const row = i * L;
      const end = offs[i + 1]!;
      for (let q = offs[i]!; q < end; q++) {
        const k = rows.get(feats[q]!);
        if (k < 0) continue;
        const e1 = rowPtr[k + 1]!;
        for (let e = rowPtr[k]!; e < e1; e++) emit[row + states[e]!]! += values[e]!;
      }
    }
    const best = this.viterbi.decode(emit, n, this.path);
    const spans = spansFromStates(fx.tokens, this.path);
    if (n === 0) return { spans, confidence: 1 };
    // Confidence: probability of the Viterbi path. On dev it ranks parses slightly better than
    // the lowest token marginal (risk–coverage AURC 0.71% vs 0.76%, quick suite) and needs only
    // the forward pass.
    this.fb.forward(emit, n);
    return { spans, confidence: Math.exp(best - this.fb.logZ) };
  }
}
