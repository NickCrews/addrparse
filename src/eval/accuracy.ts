/**
 * Accuracy of predicted spans against gold spans.
 *
 * Before comparing, both sides' spans are trimmed of whitespace and edge `,`/`;`, so a
 * tokenizer that keeps "Anchorage," as one token is not penalized for the comma.
 *
 * - exactMatch: share of examples whose span set equals gold exactly. The headline number;
 *   it's what "parsed correctly" means to a caller.
 * - tokenAccuracy: share of whitespace tokens whose label (the span covering the token's first
 *   character, or none) matches gold. A token holding several gold spans, e.g. "Apt4" (unit type
 *   and identifier, see `unit-joined` in src/data/noise.ts), counts only its first span's label, so
 *   token accuracy can't see the second one; exact match and span F1 do.
 * - span precision/recall/F1: a predicted span counts only if start, end and label all match.
 * - abstention: on junk-only examples (every gold span is NotAddress), the share where the
 *   parser emits no other label; on all other examples, the share where it emits only
 *   NotAddress or nothing, i.e. wrongly abstains.
 * - riskCoverage: when every parse has a confidence, exact match among the most confident
 *   examples. See `riskCoverage`.
 * - coarse: the same three after collapsing labels to libpostal's granularity (COARSE), so a
 *   parser that finds the street but splits it differently, or can't split it at all, still
 *   gets credit.
 */
import { LABEL_NAMES, type Label } from "../labels.ts";
import { labelAt, tokenize } from "../tokens.ts";
import type { Example, Span } from "../types.ts";
import { isJunkOnly, SLICES } from "./slices.ts";

export interface Prf {
  precision: number;
  recall: number;
  f1: number;
}

export interface SliceMetrics {
  examples: number;
  exactMatch: number;
  tokenAccuracy: number;
  spanF1: number;
}

export interface Abstention {
  junkExamples: number;
  /** Share of junk-only examples with no predicted span other than NotAddress. */
  junkAbstained: number;
  addressExamples: number;
  /** Share of the other examples with no predicted span other than NotAddress. */
  addressAbstained: number;
}

export interface RiskCoverage {
  /** Exact match among the `coverage` share of examples with the highest confidence. */
  exactAtCoverage: { coverage: number; exactMatch: number }[];
  /**
   * Area under the risk–coverage curve: mean, over k = 1..n, of the error rate among the k
   * most confident examples. 0 is perfect; a confidence that ignores correctness scores
   * about 1 − exact match.
   */
  aurc: number;
  /**
   * The lowest confidence threshold at which exact match among examples at or above it is at
   * least `target`, and the share of examples kept. null when no threshold reaches it.
   */
  atTarget: { target: number; threshold: number; coverage: number } | null;
}

export const COVERAGES = [1, 0.9, 0.8, 0.5] as const;
export const TARGET_EXACT_MATCH = 0.99;

export interface AccuracyMetrics extends SliceMetrics {
  coarse: { exactMatch: number; tokenAccuracy: number; spanF1: number };
  tokens: number;
  span: Prf;
  perLabel: Record<string, Prf & { gold: number; predicted: number }>;
  /** Most frequent token-level mistakes, gold → predicted ("-" is no label). */
  confusions: { gold: string; predicted: string; count: number }[];
  slices: Record<string, SliceMetrics>;
  /** Examples whose predicted spans overlapped or fell outside the text. */
  invalidPredictions: number;
  abstention: Abstention;
  /** Present when the parser returned a finite confidence for every example. */
  riskCoverage?: RiskCoverage;
}

export interface ExampleScore {
  exact: boolean;
  tokens: number;
  tokensCorrect: number;
  gold: number;
  predicted: number;
  matched: number;
  valid: boolean;
  tokenPairs: [gold: Label | undefined, predicted: Label | undefined][];
}

export function normalizeSpans(text: string, spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    let start = Math.max(0, s.start);
    let end = Math.min(text.length, s.end);
    while (start < end && /[\s,;]/.test(text[start]!)) start++;
    while (end > start && /[\s,;]/.test(text[end - 1]!)) end--;
    if (start < end) out.push({ start, end, label: s.label });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * libpostal's granularity: the whole street is one field, as are the unit and the PO box. Each
 * group is named by one of its labels.
 */
export const COARSE: Record<Label, Label> = {
  AddressNumber: "AddressNumber",
  AddressNumberSuffix: "AddressNumber",
  StreetNamePreModifier: "StreetName",
  StreetNamePreDirectional: "StreetName",
  StreetNamePreType: "StreetName",
  StreetName: "StreetName",
  StreetNamePostType: "StreetName",
  StreetNamePostDirectional: "StreetName",
  OccupancyType: "OccupancyIdentifier",
  OccupancyIdentifier: "OccupancyIdentifier",
  USPSBoxType: "USPSBoxID",
  USPSBoxID: "USPSBoxID",
  PlaceName: "PlaceName",
  StateName: "StateName",
  ZipCode: "ZipCode",
  CountryName: "CountryName",
  NotAddress: "NotAddress",
};

/**
 * Merges consecutive same-label spans whose gap has no letter, digit, `,` or `;`:
 * "Martin Luther King" and "Lands ' End" are one span, "Anchorage, AK" never merges across the
 * comma.
 */
export function mergeAdjacent(text: string, spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (
      last &&
      last.label === s.label &&
      /^[^\p{L}\p{N},;]*$/u.test(text.slice(last.end, s.start))
    ) {
      last.end = Math.max(last.end, s.end);
    } else out.push({ ...s });
  }
  return out;
}

/** Spans relabeled with COARSE, with the pieces of one field merged back into one span. */
export function coarsenSpans(text: string, spans: readonly Span[]): Span[] {
  return mergeAdjacent(
    text,
    normalizeSpans(text, spans).map((s) => ({ ...s, label: COARSE[s.label] })),
  );
}

const spanKey = (s: Span) => `${s.start}:${s.end}:${s.label}`;

export function scoreExample(ex: Example, predictedRaw: readonly Span[]): ExampleScore {
  const gold = normalizeSpans(ex.text, ex.spans);
  const predicted = normalizeSpans(ex.text, predictedRaw);
  const valid =
    predictedRaw.every((s) => s.start >= 0 && s.end <= ex.text.length && s.start < s.end) &&
    predicted.every((s, i) => i === 0 || predicted[i - 1]!.end <= s.start);

  const goldKeys = new Set(gold.map(spanKey));
  // Each gold span is matched at most once, so duplicated predictions can't stand in for it.
  const matched = predicted.filter((s) => goldKeys.delete(spanKey(s))).length;

  const tokenPairs: ExampleScore["tokenPairs"] = tokenize(ex.text).map((t) => [
    labelAt(gold, t),
    labelAt(predicted, t),
  ]);
  const tokensCorrect = tokenPairs.filter(([g, p]) => g === p).length;
  return {
    exact: matched === gold.length && predicted.length === gold.length,
    tokens: tokenPairs.length,
    tokensCorrect,
    gold: gold.length,
    predicted: predicted.length,
    matched,
    valid,
    tokenPairs,
  };
}

function prf(matched: number, predicted: number, gold: number): Prf {
  const precision = predicted ? matched / predicted : 0;
  const recall = gold ? matched / gold : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function aggregate(scores: readonly ExampleScore[]): SliceMetrics & { tokens: number; span: Prf } {
  let exact = 0,
    tokens = 0,
    correct = 0,
    gold = 0,
    predicted = 0,
    matched = 0;
  for (const s of scores) {
    if (s.exact) exact++;
    tokens += s.tokens;
    correct += s.tokensCorrect;
    gold += s.gold;
    predicted += s.predicted;
    matched += s.matched;
  }
  const span = prf(matched, predicted, gold);
  return {
    examples: scores.length,
    exactMatch: scores.length ? exact / scores.length : 0,
    tokenAccuracy: tokens ? correct / tokens : 0,
    spanF1: span.f1,
    tokens,
    span,
  };
}

/**
 * Risk–coverage summary of per-example correctness ranked by confidence. Examples with equal
 * confidence can't be separated by any threshold, so where a coverage cut falls inside a tie,
 * the tied examples count at their mean correctness (the expectation over tie orders).
 */
export function riskCoverage(
  correct: readonly boolean[],
  confidence: readonly number[],
  coverages: readonly number[] = COVERAGES,
  target = TARGET_EXACT_MATCH,
): RiskCoverage {
  const n = correct.length;
  if (n === 0 || confidence.length !== n) throw new Error("need one confidence per example");
  const order = [...correct.keys()].sort((a, b) => confidence[b]! - confidence[a]!);
  // Tie groups in descending confidence: [confidence, size, correct count].
  const groups: [number, number, number][] = [];
  for (const i of order) {
    const last = groups.at(-1);
    if (last && last[0] === confidence[i]) {
      last[1]++;
      last[2] += correct[i] ? 1 : 0;
    } else groups.push([confidence[i]!, 1, correct[i] ? 1 : 0]);
  }
  // expected[k] = expected number correct among the k most confident examples.
  const expected = new Float64Array(n + 1);
  let k = 0;
  let atTarget: RiskCoverage["atTarget"] = null;
  for (const [conf, size, right] of groups) {
    for (let j = 1; j <= size; j++) expected[k + j] = expected[k]! + (j * right) / size;
    k += size;
    if (expected[k]! / k >= target) atTarget = { target, threshold: conf, coverage: k / n };
  }
  let risk = 0;
  for (let j = 1; j <= n; j++) risk += 1 - expected[j]! / j;
  return {
    exactAtCoverage: coverages.map((coverage) => {
      const m = Math.max(1, Math.round(coverage * n));
      return { coverage, exactMatch: expected[m]! / m };
    }),
    aurc: risk / n,
    atTarget,
  };
}

function abstention(examples: readonly Example[], predictions: readonly (readonly Span[])[]) {
  let junk = 0,
    junkAbstained = 0,
    address = 0,
    addressAbstained = 0;
  examples.forEach((ex, i) => {
    const predicted = normalizeSpans(ex.text, predictions[i] ?? []);
    const abstained = predicted.every((s) => s.label === "NotAddress");
    if (isJunkOnly(ex)) {
      junk++;
      if (abstained) junkAbstained++;
    } else {
      address++;
      if (abstained) addressAbstained++;
    }
  });
  return {
    junkExamples: junk,
    junkAbstained: junk ? junkAbstained / junk : 0,
    addressExamples: address,
    addressAbstained: address ? addressAbstained / address : 0,
  };
}

export function scoreAll(
  examples: readonly Example[],
  predictions: readonly (readonly Span[])[],
  confidences: readonly (number | undefined)[] = [],
): AccuracyMetrics {
  const scores = examples.map((ex, i) => scoreExample(ex, predictions[i] ?? []));

  const perLabelCounts = new Map<string, { matched: number; predicted: number; gold: number }>(
    LABEL_NAMES.map((l) => [l, { matched: 0, predicted: 0, gold: 0 }]),
  );
  const confusionCounts = new Map<string, number>();
  examples.forEach((ex, i) => {
    const gold = normalizeSpans(ex.text, ex.spans);
    const pred = normalizeSpans(ex.text, predictions[i] ?? []);
    const goldKeys = new Set(gold.map(spanKey));
    for (const s of gold) perLabelCounts.get(s.label)!.gold++;
    for (const s of pred) {
      const c = perLabelCounts.get(s.label);
      if (!c) continue;
      c.predicted++;
      if (goldKeys.delete(spanKey(s))) c.matched++;
    }
    for (const [g, p] of scores[i]!.tokenPairs) {
      if (g === p) continue;
      const k = `${g ?? "-"}\t${p ?? "-"}`;
      confusionCounts.set(k, (confusionCounts.get(k) ?? 0) + 1);
    }
  });

  const perLabel: AccuracyMetrics["perLabel"] = {};
  for (const [label, c] of perLabelCounts) {
    if (c.gold || c.predicted) {
      perLabel[label] = {
        ...prf(c.matched, c.predicted, c.gold),
        gold: c.gold,
        predicted: c.predicted,
      };
    }
  }

  const slices: Record<string, SliceMetrics> = {};
  for (const slice of SLICES) {
    const subset = scores.filter((_, i) => slice.test(examples[i]!));
    if (subset.length === 0) continue;
    const { examples: n, exactMatch, tokenAccuracy, spanF1 } = aggregate(subset);
    slices[slice.name] = { examples: n, exactMatch, tokenAccuracy, spanF1 };
  }

  const coarse = aggregate(
    examples.map((ex, i) =>
      scoreExample(
        { ...ex, spans: coarsenSpans(ex.text, ex.spans) },
        coarsenSpans(ex.text, predictions[i] ?? []),
      ),
    ),
  );

  return {
    ...aggregate(scores),
    coarse: {
      exactMatch: coarse.exactMatch,
      tokenAccuracy: coarse.tokenAccuracy,
      spanF1: coarse.spanF1,
    },
    perLabel,
    confusions: [...confusionCounts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([k, count]) => {
        const [gold, predicted] = k.split("\t") as [string, string];
        return { gold, predicted, count };
      }),
    slices,
    invalidPredictions: scores.filter((s) => !s.valid).length,
    abstention: abstention(examples, predictions),
    riskCoverage: allFinite(confidences, examples.length)
      ? riskCoverage(
          scores.map((s) => s.exact),
          confidences,
        )
      : undefined,
  };
}

function allFinite(xs: readonly (number | undefined)[], n: number): xs is readonly number[] {
  return n > 0 && xs.length === n && xs.every((x) => typeof x === "number" && Number.isFinite(x));
}
