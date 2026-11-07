# addrparse

An eval harness for US address parsers written in pure TypeScript. An implementation in
`impls/<name>/` trains on labeled addresses and parses text into labeled spans (`AddressNumber`,
`StreetName`, `PlaceName`, …; see `src/labels.ts`). The harness measures accuracy, speed, memory,
model size and training cost, saves every run, and compares runs, so implementations can be
improved one measured change at a time.

Requires Node 24+ (TypeScript runs directly via type stripping).

## Quickstart

```sh
pnpm install
pnpm data                          # download libpostal training data, build data/{train,dev,test}.jsonl
pnpm eval lookup --suite smoke     # train + measure the lookup baseline, print results
pnpm compare                       # latest run of every impl, side by side
```

## Commands

| command                                           | does                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm eval <impl...> [--suite quick]`             | train (or reuse cached model), measure, save, print vs previous run     |
| `  --split test`                                  | score on the test split instead of dev                                  |
| `  --only accuracy,memory,bundle,...`             | run a subset of steps (`latency`, `throughput`, `determinism`, `curve`) |
| `  --retrain`                                     | ignore the model cache                                                  |
| `pnpm compare [--suite quick] [--detail]`         | latest run per impl; best value per metric highlighted                  |
| `pnpm compare <impl>`                             | that impl's last two runs, with changes                                 |
| `pnpm compare <runA> <runB>`                      | two runs (id, id prefix, impl name, or path)                            |
| `pnpm errors <run> [--label X] [--slice s]`       | misparsed examples as token / gold / predicted tables                   |
| `pnpm noise <impl...> [--suite quick] [--last 5]` | run-to-run spread of each metric vs its noise threshold                 |
| `pnpm data:override <id\|text>...`                | `overrides/gold.jsonl` lines for raw lines, to hand-fix their labels    |

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

`src/tokens.ts` has a whitespace tokenizer and `spansFromTokens` for token-level models;
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
| token accuracy            | share of whitespace tokens whose label matches gold                                                                           |
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
| infer heap peak           | peak V8 heap + external memory over the same window, minus before                                                             |
| train seconds, examples/s | wall time of `train()`, excluding data loading                                                                                |
| train RSS over baseline   | peak RSS during `train()`, minus RSS before                                                                                   |
| train heap peak           | peak V8 heap + external memory during `train()`, minus before                                                                 |
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

## Where to tweak

| file                                                                                            | controls                                                                                       |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `eval.config.ts`                                                                                | suites: train/eval sizes, seed, latency calls, throughput threads, determinism, learning curve |
| `src/eval/headline.ts`                                                                          | which metrics the tables show, their order, format and noise thresholds (`pnpm noise`)         |
| `src/eval/slices.ts`                                                                            | accuracy subsets                                                                               |
| `src/data/refine.ts`                                                                            | how libpostal's labels map to the output labels                                                |
| `src/labels.ts`                                                                                 | the label set                                                                                  |
| `pnpm data:override osm:6` (an example id, or a text substring) prints entries with the current |

## Dev vs test

Hill-climb on `dev` (the default). Score on `test` with `--split test` only occasionally, e.g.
before writing up a result, so it stays an unbiased estimate. Test runs get a `-test` suffix in
their id and are only compared with other test runs.

## CI

`.github/workflows/ci.yml` runs `pnpm check` and then the `ci` suite for every trained impl (not the reference impls) on
`test/fixtures/data/`, a few hundred committed examples. `eval`, `errors` and `data:build` read and write the
splits in `$ADDRPARSE_DATA_DIR` instead of `data/` when that is set (downloads stay in `data/raw/`):

```sh
ADDRPARSE_DATA_DIR=test/fixtures/data pnpm eval lookup --suite ci
```

Runs of the `ci` suite are gitignored. `pnpm eval` exits non-zero when an impl throws, has parse
errors, or trains a different model twice from the same data.

`node src/data/fixture.ts` regenerates the fixture from the first examples of each split in
`data/`; rerun it after changing how the data is built.

## Data and licenses

The code is MIT-licensed (`LICENSE`). `src/data/street-suffixes.ts` is copied from
[datamade/usaddress](https://github.com/datamade/usaddress) (MIT, © 2014 The Atlanta Journal
Constitution); `LICENSE` carries its notice. The CI fixture `test/fixtures/data/` is data, not
code: it is under ODbL 1.0, with attribution and the method of making it in
`test/fixtures/data/LICENSE`.

The training data is libpostal's parser training data (2017-03-04 snapshot), which
[libpostal's README](https://github.com/openvenues/libpostal) lists as:

| file (`src/data/libpostal.ts`)                    | from          | license                                                    |
| ------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| `formatted_addresses_tagged.random.tsv.gz`        | OpenStreetMap | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| `formatted_ways_tagged.random.tsv.gz`             | OpenStreetMap | ODbL 1.0                                                   |
| `formatted_places_tagged.random.tsv.gz`           | OpenStreetMap | ODbL 1.0                                                   |
| `openaddresses_formatted_addresses_tagged…tsv.gz` | OpenAddresses | per source, "various licenses, mostly CC-BY"               |

OpenAddresses records each source's terms in its JSON file as a `license` object (`text`, `url`,
`attribution`, `attribution name`, `share-alike`, `presumed`;
[field docs](https://github.com/openaddresses/openaddresses/blob/master/CONTRIBUTING.md)).
libpostal's lines don't say which source they came from, so the best available picture is
OpenAddresses' US sources at the last commit before the snapshot,
[`06015e0`](https://github.com/openaddresses/openaddresses/tree/06015e09e15bbcfdaac7d10883665db66c4d1f1c/sources/us)
(2017-03-03). Of its 1,398 US sources:

- 1,248 record no license. That means the terms weren't recorded, not that there are none.
- 34 require attribution (`attribution`, `attribution name`, or a top-level `attribution`).
- 1 is share-alike: `or/portland_metro` (Oregon Metro, ODbL 1.0), the same license as OSM.
- 22 say only "Indemnification", 5 "Unknown", and 2 (`co/arapahoe`, `co/city_of_aurora`) are
  marked "Crappy License"; their terms have to be read at the source before relying on them.
- None is NonCommercial or NoDerivatives.

Today's OpenAddresses has more restrictive US sources (CC BY-SA, CC BY-NC-SA, custom licenses);
data rebuilt from current OpenAddresses needs this check redone.

### What counts as what

- **The examples are a Derivative Database** of OSM (ODbL §1, §4.4); publishing them requires
  ODbL plus the OpenAddresses sources' terms. In this repo:
  - `data/` is gitignored.
  - `test/fixtures/data/` (600 examples) is a substantial extract, published under ODbL 1.0 with
    attribution and the method of making it (`test/fixtures/data/LICENSE`).
  - `overrides/gold.jsonl` and the tests quote a few dozen hand-picked lines. The OSMF counts
    fewer than 100 features as insubstantial only for a one-off, non-systematic extract
    ([Substantial guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline));
    hand-picked lines are such an extract.
  - Run files in `results/runs/` hold aggregate metrics only; per-example predictions
    (`results/predictions/`) and trained models (`models/`) are gitignored.
- **A trained model needs attribution in its documentation.** The OSMF's
  [attribution guideline](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines#Machine_learning_models)
  (adopted 2021-06-25) treats training sets that are substantial OSM extracts as Derivative
  Databases and requires models trained on them to be attributed "in documentation", such as a
  README or download page. Predictions are not covered by ODbL. A model that can recreate
  substantial parts of its training data is itself a Derivative Database. The guideline implies,
  without saying so, that other models are Produced Works (ODbL §4.3).
- **ODbL §4.6 applies to a model either way.** Publicly using "a Produced Work from a Derivative
  Database" requires offering either the Derivative Database or "a file containing all of the
  alterations … or the method of making the alterations", free of charge over the internet.
  Publishing this repo's `src/data/` (fetch, build, refine) with the snapshot id is such a method.
- **CC licenses bind only where copyright permission is needed.** Creative Commons'
  [AI-training guidance](https://creativecommons.org/using-cc-licensed-works-for-ai-training-2/)
  says BY and SA apply when a work or adaptation is shared publicly, NC applies to every use
  that needs permission, and, conservatively, a public model built from SA content carries the
  same license.

### Distributing a trained model

1. Ship this attribution with the model (README, npm package, download page or about box):

   > Trained on address data from © OpenStreetMap contributors, available under the Open
   > Database License (https://www.openstreetmap.org/copyright), and from OpenAddresses
   > (https://openaddresses.io) and the government sources listed at
   > https://github.com/openaddresses/openaddresses/tree/06015e09e15bbcfdaac7d10883665db66c4d1f1c/sources/us,
   > including Oregon Metro (ODbL 1.0), via libpostal's training data
   > (https://github.com/openvenues/libpostal). The data was relabeled and reformatted by
   > https://github.com/NickCrews/addrparse/tree/main/src/data.

   Sources with an `attribution name` at that commit want that name credited; the link above
   is how this attribution points to them (CC BY 4.0 §3(a)(2) allows a URI for this).

2. Publish the method of making the data (`src/data/` and the libpostal snapshot id) at a public
   URL, to satisfy ODbL §4.6.
3. Keep the model from reproducing the data: no stored address strings or tuples of number,
   street, place and ZIP. Whether a vocabulary of street and place names counts as a substantial
   extract is not settled by the guidelines; hashing or frequency-pruning features is this
   repo's heuristic for staying clear, not OSMF guidance. A model that does reproduce the data
   must be released under ODbL (§4.4).
4. Don't publish `data/` or other example files except under ODbL with the attribution above.

This is a reading of the licenses and the publishers' own guidance, not legal advice.
