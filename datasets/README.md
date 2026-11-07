# Datasets

Every file here is a dataset that `pnpm data:build` writes to `data/<split>/<name>.jsonl`, next to
the built-in libpostal datasets (`openaddresses`, `osm`, `ways`, `places`) and the NotAddress ones
(`junk`, `embedded`). The file name is the dataset name: lowercase letters, digits and hyphens.
Files starting with `_` are shared code, not datasets.

Training and eval sets are blends of the datasets: interleaved by the weights in
`DATASET_WEIGHTS` (`eval.config.ts`), so every prefix of a split has the same mix. A dataset not
listed there has weight 1. After adding one, run `pnpm data:build`.

## A hand-labeled dataset: `<name>.jsonl`

One example per line, with spans as `[text, label]` pairs in order (labels: `src/labels.ts`).
Text in no span, such as separators, is unlabeled:

```json
{"text": "HC 60 Box 4321, Kenai, AK 99611", "spans": [["HC", "USPSBoxGroupType"], ["60", "USPSBoxGroupID"], ["Box", "USPSBoxType"], ["4321", "USPSBoxID"], ["Kenai", "PlaceName"], ["AK", "StateName"], ["99611", "ZipCode"]]}
{"text": "Mile 14.5 Parks Hwy", "spans": [["Mile", "AddressNumberPrefix"], ["14.5", "AddressNumber"], ["Parks", "StreetName"], ["Hwy", "StreetNamePostType"]]}
```

`{"start", "end", "label"}` spans (character offsets, end exclusive) work too, and `id` is
optional. The build checks every line and stops at the first bad one, naming it. Examples are
used as written, without formatting noise, and split 90/5/5 into train, dev and test by a hash of
the address. Tagged `labeled`.

## A generated dataset: `<name>.ts`

Default-export a `GeneratedDataset` (`src/data/datasets.ts`). `generate` returns one example as
parts: plain strings are unlabeled, `[text, label]` pairs are spans. Every random choice comes
from `ctx.rng`, seeded by the dataset name and example number, so builds are deterministic.
`ctx.locality()` gives the city, state and ZIP of a real address, `ctx.street()` the street line
of one. The build adds formatting noise (`src/data/noise.ts`) unless `noise: false`. Tagged
`synthetic`.

```ts
import { int, type GeneratedDataset } from "../src/data/datasets.ts";

export default {
  description: "Lock boxes: Lock Box 12, Kenai, AK 99611",
  count: 10_000,
  generate: (ctx) => [
    ["Lock Box", "USPSBoxType"],
    " ",
    [String(int(ctx.rng, 1, 999)), "USPSBoxID"],
    ...ctx.locality(),
  ],
} satisfies GeneratedDataset;
```

## The built-in synthetic datasets

Forms of address that people put on forms and that libpostal's data barely has:

| dataset            | example                                 |
| ------------------ | --------------------------------------- |
| `po-box`           | PO Box 123, P.O. Box, POB, Box, Drawer  |
| `rural-route`      | RR 2 Box 123, Rural Route 2, RFD 3      |
| `highway-contract` | HC 60 Box 4321, HCR 1 Box 45            |
| `general-delivery` | General Delivery, Kenai, AK 99611       |
| `milepost`         | Mile 14.5 Parks Hwy, MP 82 Sterling Hwy |
| `military`         | PSC 1234, Box 5678, APO AE 09204        |

## Training on another blend

```sh
pnpm eval crf --without synthetic          # leave out every generated dataset
pnpm eval crf --without po-box,military    # leave out two datasets
pnpm eval crf --use libpostal,po-box       # only these
pnpm eval crf --mix po-box=0.2             # change a weight
pnpm eval crf --blend libpostal-only       # a named blend from BLENDS in eval.config.ts
```

These change only the training set. The eval set is always the default blend, so the runs are
scored on the same examples, and `source=<dataset>` slices (`pnpm compare --detail`) show how
each dataset's examples fared.
