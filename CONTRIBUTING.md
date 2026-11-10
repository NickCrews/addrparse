# Contributing

This repository is an eval harness for US address parsers written in pure TypeScript, and the
source of the `nerdress` npm package (`README.md` is the package's page). An implementation in
`impls/<name>/` trains on labeled addresses and parses text into labeled spans (`AddressNumber`,
`StreetName`, `PlaceName`, …; see `src/labels.ts`). The harness measures accuracy, speed, memory,
model size and training cost, saves every run, and compares runs, so implementations can be
improved one measured change at a time. The npm package is `impls/crf` with a trained model.

Requires Node 24+ (TypeScript runs directly via type stripping).

## Quickstart

```sh
pnpm install
pnpm data                          # download libpostal training data, build data/<split>/<dataset>.jsonl
pnpm eval lookup --suite smoke     # train + measure the lookup baseline, print results
pnpm compare                       # latest run of every impl, side by side
```

## Commands

| command                                            | does                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm eval <impl...> [--suite quick]`              | train (or reuse cached model), measure, save, print vs previous run       |
| `  --split test`                                   | score on the test split instead of dev                                    |
| `  --only accuracy,memory,bundle,...`              | run a subset of steps (`latency`, `throughput`, `determinism`, `curve`)   |
| `  --retrain`                                      | ignore the model cache                                                    |
| `  --without synthetic` / `--use libpostal,po-box` | train without / only on these datasets or tags (see Training data)        |
| `  --mix po-box=0.2` / `--blend libpostal-only`    | change a dataset's training weight / train on a named blend               |
| `pnpm compare [--suite quick] [--detail]`          | latest run per impl and training blend; best value per metric highlighted |
| `pnpm compare <impl>`                              | that impl's last two runs, with changes                                   |
| `pnpm compare <runA> <runB>`                       | two runs (id, id prefix, impl name, or path)                              |
| `pnpm errors <run> [--label X] [--slice s]`        | misparsed examples as token / gold / predicted tables                     |
| `pnpm noise <impl...> [--suite quick] [--last 5]`  | run-to-run spread of each metric vs its noise threshold                   |
| `pnpm data:override <id\|text>...`                 | `overrides/gold.jsonl` lines for raw lines, to hand-fix their labels      |
| `pnpm docs [--suite full]`                         | user docs as one offline HTML file, `docs/dist/index.html`                |

`--detail` adds span F1 per label, exact match per slice and the learning curve. Changes are green
or red only when larger than the metric's noise threshold; smaller ones are dimmed.

## Adding an implementation

Create `impls/<name>/index.ts` that default-exports an `Impl` (`src/types.ts`):

```ts
const impl: Impl = {
  train(examples, ctx) {
    return { model: bytes, info: { features: 123 } };
  },
  load(bytes) {
    return { parse: (text) => spans }; // or { spans, confidence }
  },
};
export default impl;
```

`parse` may return `{ spans, confidence }` instead of bare spans. Confidence is any number where
higher means more likely exactly right (a CRF's sequence probability, say); returning it for every
example turns on the risk–coverage metrics. `impls/lookup` returns the share of tokens it saw in
training.

Training and inference run in separate processes and share only the model bytes, so
serialization, size and load cost are part of what is measured.

`src/tokens.ts` has a tokenizer (whitespace-delimited words, split where addresses often leave
out a space: "Apt303", "St,Kenai", "N.Main") and `spansFromTokens` for token-level models;
`impls/lookup` uses them. `impls/noop` returns nothing: its timings and memory are the
harness's own floor, so side-by-side tables dim its column and never rank it best.

The bundle-size metric bundles `impls/<name>/load.ts` if it exists, else `index.ts`. esbuild
can't drop `train` from the exported object, so put `load` and everything it uses in `load.ts`
(`export function load(model: Uint8Array): Parser`), import it into `index.ts`, and keep
training-only code out of `load.ts`'s imports; `impls/lookup` does this. Runtime code must not
import `node:` modules, or the browser bundle fails; esbuild doesn't catch uses of the `Buffer`
or `process` globals, which fail only in a browser.

## Reference implementations

`impls/usaddress` and `impls/libpostal` are existing parsers, trained elsewhere, that give the
numbers context. Each default-exports a `ReferenceImpl` (`src/types.ts`) instead of an `Impl`: a
`predict(texts)` that runs a Python script (`predict.py`, dependencies pinned in its inline
metadata and `predict.py.lock`) over the whole eval set with `uv`, then maps the returned tokens
back to character spans and to our labels (`src/eval/reference.ts`; each `index.ts` documents its
label mapping). `pnpm eval usaddress libpostal` measures accuracy only; speed and memory of a
subprocess aren't comparable to an in-process parse, so a reference shows `–` in those rows
next to trained impls. Package and model versions are saved in the run's `metrics.reference`.

- usaddress: needs `uv`. Its labels are ours plus a few finer ones, folded in.
- libpostal: needs `uv` and the libpostal C library with its ~2 GB data directory
  (`brew install libpostal`; elsewhere build it and set `LIBPOSTAL_DATA_DIR`). Its fields are
  coarse (the whole street is `road`), so they are split into our labels by `src/data/refine.ts`,
  the same rules that derive the gold labels. libpostal was trained on the lines our gold comes
  from, dev and test included, so its score is an optimistic upper reference.

## Metrics

Every measurement runs in a fresh `node --expose-gc` process (`src/eval/child.ts`), so JIT state
and heap from one measurement don't affect another.

| metric                    | how it's measured                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| exact match               | share of eval examples whose predicted span set equals gold. The headline number.                                             |
| token accuracy            | share of tokens (`src/tokens.ts`, which splits "Apt4" into "Apt" "4") whose label matches gold                                |
| span P/R/F1               | a span counts only if start, end and label all match; also per label                                                          |
| coarse exact match        | exact match with the street, the unit and the PO box each collapsed to one label, as libpostal has                            |
| slices                    | exact match on subsets (`src/eval/slices.ts`), e.g. PO boxes, all-caps, junk-only, embedded, `noise=none`, one per noise type |
| exact @ N% coverage       | exact match among the N% of examples with the highest confidence (only with confidences)                                      |
| risk–coverage AURC        | mean error rate among the k most confident examples, over every k; lower is better                                            |
| coverage @ 99% exact      | share of examples kept by the lowest confidence threshold at which exact match is ≥ 99%                                       |
| junk abstained            | share of junk-only examples (all gold spans NotAddress) with no predicted label but NotAddress                                |
| addresses abstained       | share of the other examples with no predicted label but NotAddress; the cost of abstaining                                    |
| latency p50/p99, µs/token | one thread, after warmup passes; each `parse` call timed individually                                                         |
| throughput/s              | N worker threads, each with its own model, parsing back to back for a fixed time; median of repeats                           |
| model size, gzip          | bytes returned by `train`, raw and gzip -9                                                                                    |
| bundle size, gzip         | `load.ts` (else `index.ts`) bundled for the browser by esbuild, minified; raw and gzip -9                                     |
| model load ms             | wall time of `load(bytes)`                                                                                                    |
| model heap                | heap used after `load`, minus before (both after GC)                                                                          |
| infer RSS over baseline   | peak RSS during `load` and one parse of each eval text, minus RSS before                                                      |
| infer heap peak           | peak V8 heap + external memory over the same window, minus before; low by older garbage V8 sweeps meanwhile                   |
| train seconds, examples/s | wall time of `train()`, excluding data loading                                                                                |
| train RSS over baseline   | peak RSS during `train()`, minus RSS before                                                                                   |
| train heap peak           | peak V8 heap + external memory during `train()`, minus before; low by older garbage V8 sweeps meanwhile                       |
| train allocated           | V8 heap + external bytes allocated during `train()`, including garbage                                                        |
| determinism               | train twice, compare sha256 of the model bytes (`full` suite)                                                                 |
| learning curve            | exact match after training on fewer examples (`full` suite)                                                                   |
| code lines                | lines of `impls/<name>/**/*.ts`                                                                                               |

Gold NotAddress spans break at `,` and `;` the way `spansFromTokens` does ("Baker, Sandra" is two
spans), so exact match on junk needs those spans; junk abstained only needs no other label.

Memory caveats: the RSS "over baseline" peaks are sampled every millisecond by a worker thread, so
spikes shorter than that can be missed, and they depend on when the OS and GC return pages, so
they vary run to run. The heap metrics come from V8's accounting before and after each
garbage collection (`src/eval/heap.ts`), so they're stable even for trainings that take
milliseconds, but they don't see native memory outside V8. The run JSON also has `peakRssMB`,
the OS's maxRSS; that covers the whole process lifetime, so it includes Node startup and loading
the data, and is only meaningful when the model dominates. Training rates are hidden when
training took under a millisecond, where they measure the timer.

Runs record the machine's 1-minute load average (the higher of its values at the start and end).
Above the core count, other processes competed for the CPU: `pnpm eval` and `pnpm compare` note
"machine busy: timings unreliable", and `pnpm noise` leaves the run out.

## Runs, cache and history

- `results/runs/<runId>.json`: everything a run measured, plus suite config, git sha/dirty, data
  hashes, implementation source hash and machine. Committed, so history stays comparable.
- `results/predictions/<runId>.jsonl`: per-example predictions, read by `pnpm errors`. Not committed.
- `models/<impl>/<key>.bin`: trained models. The key hashes the impl's sources plus shared `src/`
  (not `src/eval/`), the training data, seed and size, so any change that could change the model
  retrains it. A cached model reuses the training metrics from when it was trained; the run
  records when, at which commit and on which machine (`training.measured`), and `pnpm eval`
  prints it. `--retrain` measures training again.

A run is compared against the previous run of the same impl, suite and split. Runs from different
suites, data or machines aren't comparable; `compare` prints a note when they differ.

## Training data

`pnpm data:build` writes each dataset on its own, `data/<split>/<dataset>.jsonl`, with their sizes
in `data/manifest.json`. A training or eval set is a blend: the datasets interleaved by weight
when the split is loaded (`src/data/blend.ts`), so every prefix of a blended split has the same
mix. Default weights are `DATASET_WEIGHTS` in `eval.config.ts`.

| dataset                                     | tag           | what                                                       |
| ------------------------------------------- | ------------- | ---------------------------------------------------------- |
| `openaddresses`, `osm`, `ways`, `places`    | `libpostal`   | libpostal's US training lines, relabeled (`src/data/`)     |
| `junk`, `embedded`                          | `not-address` | text that is not an address, alone or around one           |
| `po-box`, `rural-route`, `highway-contract` | `synthetic`   | PO Box 12; RR 2 Box 123; HC 60 Box 4321                    |
| `general-delivery`, `milepost`, `military`  | `synthetic`   | General Delivery; Mile 14.5 Parks Hwy; PSC 3 Box 12 APO AE |
| `datasets/<name>.jsonl`                     | `labeled`     | your own hand-labeled examples                             |
| `datasets/<name>.ts`                        | `synthetic`   | your own generator                                         |

The synthetic datasets cover physical and mailing address forms that libpostal's data barely has:
PO boxes, rural and highway contract routes (`USPSBoxGroupType`, `USPSBoxGroupID`), general
delivery (`USPSBoxType` with no ID), mileposts (`AddressNumberPrefix`) and military mail. Most are followed by the city, state and ZIP of a real
libpostal address. `datasets/README.md` has the file formats for adding a dataset.

The blend flags of `pnpm eval` change only the training set; the eval set is always the default
blend, so every run is scored on the same examples. Each dataset has a `source=<dataset>` slice.
A run on another blend gets the blend in its id (`…__crf__full__without=synthetic`), is compared
with earlier runs on the same blend, and is its own column (`crf@without=synthetic`) in
`pnpm compare`. Named blends are `BLENDS` in `eval.config.ts`.

```sh
pnpm eval crf --without synthetic        # what the synthetic address forms buy
pnpm eval crf --without po-box,military  # leave out two datasets
pnpm eval crf --mix milepost=0.1         # five times the default milepost share
```

## Where to tweak

| file                                                                                            | controls                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `eval.config.ts`                                                                                | suites: train/eval sizes, seed, latency calls, throughput threads, determinism, learning curve; dataset weights and named blends |
| `datasets/`                                                                                     | added datasets: generators (`.ts`) and hand-labeled examples (`.jsonl`)                                                          |
| `src/eval/headline.ts`                                                                          | which metrics the tables show, their order, format and noise thresholds (`pnpm noise`)                                           |
| `src/eval/slices.ts`                                                                            | accuracy subsets                                                                                                                 |
| `src/data/refine.ts`                                                                            | how libpostal's labels map to the output labels                                                                                  |
| `src/labels.ts`                                                                                 | the label set                                                                                                                    |
| `pnpm data:override osm:6` (an example id, or a text substring) prints entries with the current |

## Dev vs test

Hill-climb on `dev` (the default). Score on `test` with `--split test` only occasionally, e.g.
before writing up a result, so it stays an unbiased estimate. Test runs get a `-test` suffix in
their id and are only compared with other test runs.

## CI

`.github/workflows/ci.yml` runs `pnpm check` and then the `ci` suite for every trained impl (not the reference impls) on
`test/fixtures/data/`, a few hundred committed examples. `eval`, `errors` and `data:build` read and write the
splits in `$NERDRESS_DATA_DIR` instead of `data/` when that is set (downloads stay in `data/raw/`):

```sh
NERDRESS_DATA_DIR=test/fixtures/data pnpm eval lookup --suite ci
```

Runs of the `ci` suite are gitignored. `pnpm eval` exits non-zero when an impl throws, has parse
errors, or trains a different model twice from the same data.

`node src/data/fixture.ts` regenerates the fixture from the first examples of each split in
`data/`; rerun it after changing how the data is built.

## Docs

`pnpm docs` builds `docs/dist/index.html`, one self-contained page for users of the parsers:
usage, the label set, what is measured and why, the training data, a comparison of the impls
other than `noop` and `lookup`, and a playground that runs `crf` in the browser with its model
embedded. Numbers come from the latest run of each impl in the suite (`--suite`, default `full`) and from
`data/stats.json`. Models come from the `models/` cache for that suite, trained first if missing.
Demo rows are seeded samples of the dev split, picked by running the models at build time; the
references' columns come from their saved predictions (`results/predictions/`).

The page embeds trained models and dev examples, so it is gitignored; publishing it means
distributing a Produced Work and an extract of a Derivative Database (see LICENSING.md). It carries the
attribution from LICENSING.md, read at build time.

## npm package

`package/` builds the `nerdress` npm package: `impls/crf` with a model trained on the `full`
suite's training set, embedded as base64, exporting `parse(text)` and `LABELS`
(`package/index.ts`), with no dependencies and no `node:` imports. `package/package.json` is its
manifest, and the root `package.json` holds its version; `README.md` is its npm page.

```sh
pnpm package                                # train, then build dist/ (a few minutes, ~1 GB)
pnpm package --model models/crf/<key>.bin   # reuse a model `pnpm eval crf --suite full` cached
npm publish ./dist
```

`pnpm package` writes `dist/` (gitignored): the bundle, its `.d.ts`, the manifest, `README.md`
with a section on this release's model appended (size, sha256, training size, seed and commit),
and `LICENSE` with the model attribution from LICENSING.md. The commit
link is how the package meets ODbL §4.6, so build from a clean commit that is pushed to the
public repository. `test/package.test.ts` builds the package from the CI fixture and imports it.

Before a release, score the model on the test split once (`pnpm eval crf --suite full --split
test`) and update the numbers in `README.md` and `docs/page.ts`.

## Data and licenses

Licenses, the model attribution, and the rules for publishing data and models are in
[LICENSING.md](LICENSING.md).
