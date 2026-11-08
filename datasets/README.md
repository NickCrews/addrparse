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

And one hand-labeled dataset, `ak-voterfile` (below).

## `ak-voterfile.jsonl`: Alaska voter-file addresses

Real residence and mailing addresses from the State of Alaska's public voter file (the
2026-04-08 extract), chosen for the forms the other datasets lack: village streets with no house
numbers, lot and block numbers, `HOUSE #6` and `HUD #2`, mileposts written every way
(`MI 274 .5 RICHARDSON HWY`), named housing and subdivisions, directions in place of an address,
PO box letter codes (`PO BOX PPV`), private mailboxes, C/O lines, a street and a PO box together,
and data-entry repeats. Foreign addresses and lines a plain street or PO box pattern explains are
left out. There is one example per shape: lines that differ only in their digits
(`3705 ARCTIC BLVD PMB 2550` and `PMB 1071`) count as one, and the first is kept. Text is the
file's address lines joined with `, `, then the city, state and ZIP (left off a random 15% of
one-line addresses, and when the line already ends with them).

Of its 23,919 examples, 78% were labeled by rules written for these shapes and the rest by an
LLM following the conventions below. The rules send any line they can't fully explain to the LLM, but
neither half has been checked line by line by a person, so expect some wrong labels.

Labeling conventions beyond `src/labels.ts`:

- A street with no house number keeps its street labels; a number or `#n` after it is the unit:
  `BLUEBERRY ST #3` → StreetName, StreetNamePostType, OccupancyIdentifier.
- Lot, block, tract, house, HUD, PMB, slip, stall and cabin numbers are OccupancyType and
  OccupancyIdentifier, like Apt and Suite: `LOT 4 BLOCK 8`, `HOUSE #17`, `STE 2 PMB 507`.
- LandmarkName is a named building, housing area, subdivision, survey, island, lake, bay or
  harbor that isn't serving as the street (`TEACHER HOUSING APT C4`, `NAUKATI BAY SUBD LOT 14`,
  `ANDERSON ST HOUSING #5` → only `HOUSING`), or a description of where the place is, numbers
  included (`5TH HOUSE SOUTH OF SCHOOL`).
- Recipient is a C/O, ATTN or IN CARE OF line with its name, or a name line written with the
  address.
- A repeat of what the line already said (`101 CHURCH ST 101 CHURCH`), `SAME` and `NHN` (no
  house number) are NotAddress.
- An intersection is two streets with the `AND` or `&` between them unlabeled:
  `3RD AND ALDER ST`.
- Words that glue two fields are split where the tokenizer splits them (`src/tokens.ts`), and
  each part gets its own label: `APT.9` is OccupancyType `APT.` and OccupancyIdentifier `9`,
  `HC60` is USPSBoxGroupType `HC` and USPSBoxGroupID `60`.

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
