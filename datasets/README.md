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

And two labeled datasets of real addresses, `ak-voterfile` and `ak-apoc` (below).

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

Most of its examples were labeled by rules written for these shapes and the rest by an LLM
following the conventions below. The rules send any line they can't fully explain to the LLM, but
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

## `ak-apoc.jsonl`: Alaska campaign finance addresses

Real addresses from the Alaska Public Offices Commission's campaign finance reports (contributions,
expenditures, debts and registrations), as republished by
[apoc-data](https://github.com/NickCrews/apoc-data) (release `20261106-191557`). Filers type the
other party's address into separate address, city, state and ZIP boxes, so the data has what web
forms collect: suite and PMB numbers, units with no designator (`Harris St 329`), misspelt types
(`Strreet`, `Avve`), the city, state or ZIP typed into the address box too, business names and
notes in the address (`Anedot.com`, `NOTE-Out of state donation refunded`), placeholders (`N/A`,
`Not provided`, `TBD`), and ZIPs that lost their leading 0 or are a dollar amount. About 70% are in
Alaska and the rest elsewhere in the US. Non-US addresses are left out.

Each row is rendered as `address, city, state zip`, or as the address alone when it already ends
with its city, state or ZIP. The state is APOC's full name ("Alaska"). Rows that differ only in
their digits or case count as one shape, and the most frequent row of each shape is kept. The
fields are labeled by the rules in `scripts/ak-apoc/rules.ts` where the shape is one they cover,
otherwise by `scripts/ak-apoc/hand.jsonl`: the most frequent of each coarse shape of the rest,
labeled by an LLM correcting the parse of the model below to the conventions here and in
`ak-voterfile`. Shapes in neither are left out.

Only the shapes that the published model (nerdress 0.1.0, trained with `ak-voterfile`) parses
differently from the labels, or with confidence under 0.9, are kept, and of those with a dollar
amount for a ZIP, the first 100. The build writes the count of each step to `ak-apoc.stats.json`.
To rebuild:

```sh
uv run scripts/ak-apoc/extract.py 20261106-191557 data/raw/apoc.jsonl
node scripts/ak-apoc/build.ts --addresses data/raw/apoc.jsonl --model <nerdress 0.1.0 model.bin>
```

Labeling conventions beyond `ak-voterfile`'s:

- A placeholder in any field (`N/A`, `Unknown`, `None`, `TBD`, `$95.00` as the ZIP) is
  NotAddress. A ZIP that is mistyped but still a number (`9080`, `995203`, `99,501.00`) is ZipCode.
- A business, agency or campus name in the address box is Recipient (`Wells Fargo Bank`, `UAF`,
  `eXp Realty LLC`); a named building, mall, station or facility is LandmarkName (`State Capitol`,
  `Nugget Mall`, `Spenard PO`).
- Notes, emails, URLs, phone numbers and reference numbers are NotAddress.
- `PMB`, `Mailbox`, `Bldg`, `Room` and `Condo` numbers are OccupancyType and OccupancyIdentifier;
  `ST E` after a road with its type is a suite (`3875 Geist Rd ST E`).
- `Northern Lights`, Anchorage's Northern Lights Blvd written without its type, is the name.
- A road that ends in a word that is also a USPS type but usually part of a name, with no other
  type (`Crooked Tree`, `Wood Hall`, `Lake Otis`), is all StreetName.

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
