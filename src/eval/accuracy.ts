/**
 * Accuracy of predicted spans against gold spans.
 *
 * Before comparing, both sides' spans are trimmed of whitespace and edge `,`/`;`, so a
 * tokenizer that keeps "Anchorage," as one token is not penalized for the comma.
 *
 * - exactMatch: share of examples whose span set equals gold exactly. The headline number;
 *   it's what "parsed correctly" means to a caller.
 * - tokenAccuracy: share of whitespace tokens whose label (the span covering the token's first
 *   character, or none) matches gold.
 * - span precision/recall/F1: a predicted span counts only if start, end and label all match.
 */
import { LABEL_NAMES, type Label } from "../labels.ts";
import { labelAt, tokenize } from "../tokens.ts";
import type { Example, Span } from "../types.ts";
import { SLICES } from "./slices.ts";

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

export interface AccuracyMetrics extends SliceMetrics {
  tokens: number;
  span: Prf;
  perLabel: Record<string, Prf & { gold: number; predicted: number }>;
  /** Most frequent token-level mistakes, gold → predicted ("-" is no label). */
  confusions: { gold: string; predicted: string; count: number }[];
  slices: Record<string, SliceMetrics>;
  /** Examples whose predicted spans overlapped or fell outside the text. */
  invalidPredictions: number;
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

export function scoreAll(
  examples: readonly Example[],
  predictions: readonly (readonly Span[])[],
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

  return {
    ...aggregate(scores),
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
  };
}
