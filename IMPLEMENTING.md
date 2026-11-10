# Implementation brief

A prompt to hand an agent (or follow yourself) when building or improving a parser in
`impls/<name>/`. Replace `<name>` and adjust the design guidance for the approach being tried;
the guidance below is for a linear-chain CRF.

---

Implement a pure-TypeScript US address parser as `impls/<name>/` in this repo (Node 26 runs
`.ts` directly; imports need `.ts` extensions; no enums or parameter properties). Leave changes
uncommitted for review unless told otherwise.

## Context

The repo is an eval harness built for hill-climbing parsers. Read `CONTRIBUTING.md` first, then:

- `src/types.ts`: the `Impl` contract. `train(examples, ctx)` returns `{ model: Uint8Array, info? }`
  and `load(bytes)` returns a parser whose `parse(text)` returns `Span[]` or
  `{ spans, confidence }`. Training and inference run in separate processes and share only the
  model bytes.
- `src/labels.ts` (including `NotAddress`), `src/tokens.ts`.
- `impls/crf/`: the parser to beat (`pnpm compare` shows its numbers); `index.ts` trains,
  `load.ts` parses.
- `impls/usaddress`, `impls/libpostal`: reference parsers, accuracy only, for context.
- `eval.config.ts`: suites and knobs.
- `src/data/refine.ts` and `src/data/street-suffixes.ts`: lexicons usable as features.

Data is built by `pnpm data` into `data/`, one file per dataset: libpostal-derived US addresses
(full addresses, streets with places, places alone), with seeded formatting noise
(`src/data/noise.ts`); synthetic `NotAddress` examples, both junk-only texts and addresses
embedded in other text (`src/data/not-address.ts`); and synthetic PO boxes, rural and highway
contract routes, general delivery, mileposts and military mail (`datasets/`). Training and eval
sets blend them by `DATASET_WEIGHTS` (`eval.config.ts`); `--without <dataset>` trains without one.

## Loop

- `pnpm eval <name> --suite quick` trains, measures accuracy, latency, throughput, memory and
  training cost, and compares against the previous run of the same impl.
- `pnpm eval <name> --suite quick --only accuracy` for fast accuracy-only iterations; run the full
  measurement for changes worth keeping.
- `pnpm compare <name> --detail` shows per-label and per-slice numbers (sources, noise types,
  `gold=clean`/`gold=heuristic`, junk-only, embedded, ...).
- `pnpm errors <name> --limit 20 [--label X] [--slice Y]` shows misparsed examples, with
  confidence when the parser returns one.
- Changes smaller than a metric's noise threshold (`src/eval/headline.ts`) are dimmed; don't
  chase them.

Hill-climb on the dev split only. Never look at or evaluate on the test split.

## Design guidance (CRF; deviate if measurements say so)

- One feature function in TS used by both training and inference, so training and runtime can't
  disagree.
- Features in the spirit of usaddress: lowercased word, shape (digit/letter/case pattern), digit
  class, length bucket, trailing punctuation (comma), directional / street-suffix / occupancy
  lexicon membership, is-state-abbreviation, prefixes and suffixes, the same for neighbours at
  ±1 (try ±2), and start/end-of-string flags.
- Training: an averaged structured perceptron is simple and fast on ~1M examples (libpostal
  uses one). Proper CRF training (SGD or L-BFGS on log-likelihood with L1/L2) also gives marginals
  and sequence probabilities; compare both through the harness.
- Confidence: return `{ spans, confidence }` with a score that ranks parses by how likely they are
  exactly right (a sequence probability, a minimum marginal, a margin). It drives the
  risk–coverage metrics (exact @ N% coverage, AURC, coverage @ 99% exact). Abstention is
  labeling everything `NotAddress`; "junk abstained" and "addresses abstained" measure it.
- Inference: Viterbi over typed arrays. Keep string building out of the hot path: intern features
  to integer ids (hash map built at load, or feature hashing into a fixed table; measure the
  accuracy/size tradeoff).
- Compact binary model format (Float32 or quantized weights plus a feature dictionary), pruning
  near-zero weights. Watch model gzip size and load time.
- Put `load` and everything it imports in `load.ts`, training code in `index.ts` and its own
  modules, so the measured browser bundle leaves out training. Runtime code must not import
  `node:` modules.
- Deterministic given `ctx.seed`.

## Targets

- Exact match as high as the gold allows; some gold labels are unrecoverable (see the open
  gold-label issues: `gh issue list -R NickCrews/nerdress`).
- Low risk–coverage AURC and high coverage @ 99% exact; junk abstained near 100% with
  addresses abstained near 0%.
- p50 latency in single-digit µs.
- Model under ~2 MB gzipped.
- Training on the quick suite in well under a minute.

## Rules

- Don't edit the harness (`src/eval/`), the data pipeline (`src/data/`, `overrides/`),
  `src/labels.ts`, `eval.config.ts` or existing tests to improve a score. Fix a harness bug only if it is clearly a
  bug, and report it.
- Code comments state current behaviour, not history; no mannered prose.
- Add tests for non-trivial pieces (Viterbi, serialization round-trip) in `test/<name>*.test.ts`.
- When done: run `pnpm eval <name> crf --suite full` once, then `pnpm check` (`pnpm fmt`
  formats).

## Report

- A table of the main iterations: change → dev exact match, token accuracy, AURC, p50 µs, model
  gzip size, training seconds.
- Final full-suite numbers vs `crf`.
- The dominant remaining error categories (from `pnpm errors`).
- Ideas not tried.
