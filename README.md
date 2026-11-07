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

| command                                     | does                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm eval <impl...> [--suite quick]`       | train (or reuse cached model), measure, save, print vs previous run  |
| `  --split test`                            | score on the test split instead of dev                               |
| `  --only accuracy,memory,latency,...`      | run a subset of steps (`throughput`, `determinism`, `curve`)         |
| `  --retrain`                               | ignore the model cache                                               |
| `pnpm compare [--suite quick] [--detail]`   | latest run per impl; best value per metric highlighted               |
| `pnpm compare <impl>`                       | that impl's last two runs, with changes                              |
| `pnpm compare <runA> <runB>`                | two runs (id, id prefix, impl name, or path)                         |
| `pnpm errors <run> [--label X] [--slice s]` | misparsed examples as token / gold / predicted tables                |
| `pnpm data:override <id\|text>...`          | `overrides/gold.jsonl` lines for raw lines, to hand-fix their labels |

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
serialization, size and load cost are part of what is measured. `src/tokens.ts` has a whitespace
tokenizer and `spansFromTokens` for token-level models; `impls/lookup` uses them. `impls/noop`
returns nothing: its timings and memory are the harness's own floor.

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
| model load ms             | wall time of `load(bytes)`                                                                                                    |
| model heap                | heap used after `load`, minus before (both after GC)                                                                          |
| infer RSS over baseline   | peak RSS during `load` and one parse of each eval text, minus RSS before                                                      |
| train seconds, examples/s | wall time of `train()`, excluding data loading                                                                                |
| train RSS over baseline   | peak RSS during `train()`, minus RSS before                                                                                   |
| determinism               | train twice, compare sha256 of the model bytes (`full` suite)                                                                 |
| learning curve            | exact match after training on fewer examples (`full` suite)                                                                   |
| code lines                | lines of `impls/<name>/**/*.ts`                                                                                               |

Gold NotAddress spans break at `,` and `;` the way `spansFromTokens` does ("Baker, Sandra" is two
spans), so exact match on junk needs those spans; junk abstained only needs no other label.

Memory caveats: the "over baseline" peaks are sampled every millisecond by a worker thread, so
spikes shorter than that can be missed. The run JSON also has `peakRssMB`, the OS's maxRSS; that
covers the whole process lifetime, so it includes Node startup and loading the data,
and is only meaningful when the model dominates.

## Runs, cache and history

- `results/runs/<runId>.json`: everything a run measured, plus suite config, git sha/dirty, data
  hashes, implementation source hash and machine. Committed, so history stays comparable.
- `results/predictions/<runId>.jsonl`: per-example predictions, read by `pnpm errors`. Not committed.
- `models/<impl>/<key>.bin`: trained models. The key hashes the impl's sources plus shared `src/`
  (not `src/eval/`), the training data, seed and size, so any change that could change the model
  retrains it. A cached model reuses the training metrics from when it was trained;
  `--retrain` measures training again.

A run is compared against the previous run of the same impl, suite and split. Runs from different
suites, data or machines aren't comparable; `compare` prints a note when they differ.

## Where to tweak

| file                      | controls                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eval.config.ts`          | suites: train/eval sizes, seed, latency calls, throughput threads, determinism, learning curve                                                     |
| `src/eval/headline.ts`    | which metrics the tables show, their order, format and noise thresholds                                                                            |
| `src/eval/slices.ts`      | accuracy subsets                                                                                                                                   |
| `src/data/libpostal.ts`   | sources, US lines fetched per source (`--limit`), their mix in the splits (`--mix`)                                                                |
| `src/data/refine.ts`      | how libpostal's labels map to the output labels                                                                                                    |
| `src/data/noise.ts`       | formatting noise added to rendered examples (newlines, "Apt4", typos, …) and its rates; `node src/data/build.ts --noise-scale 0` builds clean data |
| `src/data/not-address.ts` | synthetic NotAddress examples; rates also via `pnpm data:build --junk-rate R --embedded-rate R`                                                    |
| `src/data/gold.ts`        | corpus-level checks that reject or relabel libpostal noise refine can't see                                                                        |
| `overrides/gold.jsonl`    | hand-checked labels for single lines                                                                                                               |
| `src/labels.ts`           | the label set                                                                                                                                      |

## Gold labels

libpostal's labels are coarse and its text has deliberate noise (truncated and misspelled
words), so the gold labels are derived by heuristics, in order:

1. `src/data/refine.ts` splits each libpostal field into output labels, one line at a time.
2. `src/data/gold.ts` checks the result against counts over the whole corpus: it rejects roads
   whose type libpostal cut to one letter ("Wilmont D"), relabels misspelled types ("Raod")
   as `StreetNamePostType`, and notes city names abbreviated beyond USPS forms ("S Diego").
3. `overrides/gold.jsonl` replaces both for single lines, by hand.

Every rule that makes a judgment call adds a note to the example's `notes`, and
`data/stats.json` counts each note, each rejection reason, and the overrides. The
`gold=heuristic` slice is the examples with such a note; `gold=clean` is the rest: labels no rule
had to guess at, or hand-checked ones. Noise the rules don't recognize can still hide there. `dropped:<field>` notes (a field was removed
from the text) don't count.

### Overrides

`overrides/gold.jsonl` has one JSON object per line:

```json
{"key":"4fa35de149bcebea","text":"100 WILMONT D, WAUKESHA, Wisconsin 53189","spans":[["100","AddressNumber"],["WILMONT","StreetName"],["D","StreetNamePostType"],["WAUKESHA","PlaceName"],["Wisconsin","StateName"],["53189","ZipCode"]],"why":"D is Drive truncated"}
{"key":"851856e2a707501b","text":"1026 31st St, Ug, Apartment 2011","reject":"Ug is libpostal's German basement; no US reading"}
```

- `key`: the first 16 hex digits of the sha1 of the raw libpostal line.
- `text`: the refined text the entry was written against, unique in the file. Overrides only change labels, never
  text. When the line no longer refines to this text (the line is gone, or refine or rendering
  changed), the entry is stale: it applies to nothing and `stats.overrides.stale` counts it.
- `spans`: each span's text and label, in order; each is matched at the next whole-word
  occurrence, and every letter and digit of `text` must be in a span. Or `reject`: why the line
  is dropped.
- `why`: optional note on the fix.

An override applies to every line that refines to the same text, and replaces the corpus checks,
so it can also keep a line they would reject. The example gets the note `override`.
`pnpm data:override osm:6` (an example id, or a text substring) prints entries with the current
labels, plus each line's split, notes and rejection on stderr; edit one, append it and rebuild.
`pnpm test` validates the file.

## Dev vs test

Hill-climb on `dev` (the default). Score on `test` with `--split test` only occasionally, e.g.
before writing up a result, so it stays an unbiased estimate. Test runs get a `-test` suffix in
their id and are only compared with other test runs.

## CI

`.github/workflows/ci.yml` runs `pnpm check` and then the `ci` suite for every impl on
`test/fixtures/data/`, a few hundred committed examples. `eval`, `errors` and `data:build` read and write the
splits in `$ADDRPARSE_DATA_DIR` instead of `data/` when that is set (downloads stay in `data/raw/`):

```sh
ADDRPARSE_DATA_DIR=test/fixtures/data pnpm eval lookup --suite ci
```

Runs of the `ci` suite are gitignored. `pnpm eval` exits non-zero when an impl throws, has parse
errors, or trains a different model twice from the same data.

`node src/data/fixture.ts` regenerates the fixture from the first examples of each split in
`data/`; rerun it after changing how the data is built.
