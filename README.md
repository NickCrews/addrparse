# nerdress

The name is NER (named-entity recognition) + address.

US address parsing, ready for production:

- **Run anywhere:** Pure javascript/typescript, no dependencies
- **Accurate:** 99.29% of held-out test addresses parsed exactly right, 99.81% of words
  labeled right.
- **Small and fast:** ~370 KB gzipped including the model, ~100k/sec, nothing to download or set up.
- **Comprehensive:** Any US physical or mailing address: street addresses, PO boxes, rural and highway contract routes, general
  delivery, mileposts and military mail.
- **Says how sure it is:** `confidence` is the probability that every span is right. Accept
  confident parses and send the rest for review; the 90% most confident test parses are 99.97%
  exactly right.
- **Recognizes non-addresses:** junk is labeled `NotAddress` instead of being forced into a parse.
- **Tolerates typos:** a misspelt word keeps its label ("vermn" is still the state); 98.56% of
  test addresses with a typo are parsed exactly right.

```js
import { parse } from "nerdress";
const { spans, confidence } = parse(
  "CO John SMITH, 123 E St elias stree S,   Oklahoma City, OK 99507-1234",
);
// spans: [
//   { start: 0,  end: 13, label: "NotAddress",                text: "CO John SMITH" }, // the recipient isn't part of the address
//   { start: 15, end: 18, label: "AddressNumber",             text: "123" },
//   { start: 19, end: 20, label: "StreetNamePreDirectional",  text: "E" },
//   { start: 21, end: 29, label: "StreetName",                text: "St elias" },      // "St" isn't mistaken for Street
//   { start: 30, end: 35, label: "StreetNamePostType",        text: "stree" },         // the typo is still the street type
//   { start: 36, end: 37, label: "StreetNamePostDirectional", text: "S" },
//   { start: 41, end: 54, label: "PlaceName",                 text: "Oklahoma City" }, // "Oklahoma" isn't mistaken for the state
//   { start: 56, end: 58, label: "StateName",                 text: "OK" },
//   { start: 59, end: 69, label: "ZipCode",                   text: "99507-1234" },
// ]
// confidence: 0.851
```

## API

```sh
npm install nerdress
```

- Spans are character ranges `[start, end)` of the input, sorted and non-overlapping, with
  `text === input.slice(start, end)`. Spaces and commas between them have no label.
- A label can occur more than once, e.g. two `OccupancyType` spans in "Apt 4B Floor 2".
- Parsing has no side effects and needs no network or file access. The model is decoded on the
  first call (about 10 ms).
- To abstain, treat a parse as unusable when its confidence is below a threshold, or when every
  span is `NotAddress`.

`LABELS` maps each label to a description with examples. The names follow
[usaddress](https://github.com/datamade/usaddress), which follows the FGDC United States
Thoroughfare, Landmark, and Postal Address Data Standard:

| label                       | example                                 |
| --------------------------- | --------------------------------------- |
| `Recipient`                 | **C/O Jane Doe**, PO Box 55             |
| `AddressNumberPrefix`       | **Mile** 14.5 Parks Hwy                 |
| `AddressNumber`             | **123**, **45-29**                      |
| `AddressNumberSuffix`       | 12 **B**                                |
| `StreetNamePreModifier`     | **Old** Highway 9                       |
| `StreetNamePreDirectional`  | **N** Main St                           |
| `StreetNamePreType`         | **Highway** 9                           |
| `StreetName`                | **Martin Luther King** Blvd             |
| `StreetNamePostType`        | Main **St**                             |
| `StreetNamePostDirectional` | Main St **NE**                          |
| `OccupancyType`             | **Apt** 4B, **Suite** 100, **#** 3      |
| `OccupancyIdentifier`       | Apt **4B**                              |
| `LandmarkName`              | **Teacher Housing** Apt C4              |
| `USPSBoxGroupType`          | **RR** 2 Box 5, **PSC** 3 Box 12        |
| `USPSBoxGroupID`            | RR **2** Box 5                          |
| `USPSBoxType`               | **PO Box** 55, **General Delivery**     |
| `USPSBoxID`                 | PO Box **55**                           |
| `PlaceName`                 | **Springfield**                         |
| `StateName`                 | **IL**, **Illinois**                    |
| `ZipCode`                   | **62704**, **62704-1234**               |
| `CountryName`               | **USA**                                 |
| `NotAddress`                | **call me at** 1600 Pennsylvania Ave NW |

## Scope

All physical and mailing addresses in the US: street addresses, PO boxes, rural and highway contract routes, general
delivery, mileposts, military mail, and the forms rural Alaska uses: lot and block numbers, house
numbers on streets with no address numbers, named housing and subdivisions, and directions
("blue house across from the post office"). It does not validate addresses (whether one exists or
gets mail), geocode them, or standardize them (rewrite Street as ST, fill in a missing ZIP);
spans point into the input unchanged. A name written with an address (before it, or after C/O
or Attn) is `Recipient`; a name alone is `NotAddress`.

The data is a custom blend from several different sources:

<!-- datasets:start: generated by pnpm readme from 2026-11-10T16-29-44__crf__full-test -->

| dataset            | share | training examples |    test exact match | source                                          | example                                  |
| ------------------ | ----: | ----------------: | ------------------: | ----------------------------------------------- | ---------------------------------------- |
| `openaddresses`    | 43.0% |           215,068 |   99.2% (99.0–99.3) | libpostal: OpenAddresses government data        | 123 Main St, Springfield, IL 62704       |
| `osm`              | 32.7% |           163,452 |   99.4% (99.2–99.6) | libpostal: OpenStreetMap addresses              | 45 Oak Ave Apt 2, Portland, OR 97214     |
| `ways`             |  7.3% |            36,561 |   98.1% (97.2–98.7) | libpostal: OpenStreetMap street and its place   | Sled Ct, Palm Coast, Florida             |
| `ak-voterfile`     |  4.3% |            21,483 |   93.2% (91.4–94.7) | Alaska voter file, hand- and rule-labeled       | HOUSE #6, KASIGLUK, AK 99609             |
| `places`           |  3.9% |            19,356 |   99.0% (98.0–99.5) | libpostal: OpenStreetMap place names            | Willistown, Chester County, PA           |
| `po-box`           |  1.7% |             8,602 | 100.0% (98.9–100.0) | synthetic                                       | PO Box 123, P.O. Box, POB, Drawer        |
| `embedded`         |  1.7% |             8,387 |   98.5% (96.5–99.4) | synthetic: an address inside other text         | Mail to 12 Main St, thanks               |
| `junk`             |  1.2% |             5,806 |   99.6% (97.6–99.9) | synthetic: text with no address                 | N/A; same as above; 555-0123             |
| `milepost`         |  0.9% |             4,301 | 100.0% (97.8–100.0) | synthetic                                       | Mile 14.5 Parks Hwy, MP 82 Sterling Hwy  |
| `rural-route`      |  0.9% |             4,301 |   99.4% (96.8–99.9) | synthetic                                       | RR 2 Box 123, Rural Route 2, RFD 3       |
| `ak-apoc`          |  0.9% |             4,297 |   91.1% (86.6–94.2) | Alaska campaign finance, rule- and hand-labeled | 3705 Arctic, PMB 1579, Anchorage, Alaska |
| `highway-contract` |  0.6% |             3,226 | 100.0% (97.1–100.0) | synthetic                                       | HC 60 Box 4321, HCR 1 Box 45             |
| `general-delivery` |  0.5% |             2,580 | 100.0% (96.4–100.0) | synthetic                                       | General Delivery, Kenai, AK 99611        |
| `military`         |  0.5% |             2,580 | 100.0% (96.4–100.0) | synthetic                                       | PSC 1234, Box 5678, APO AE 09204         |
| **total**          |  100% |       **500,000** |                     |                                                 |                                          |

<!-- datasets:end -->

Share is each dataset's share of the training examples; the eval sets have the same mix. The
shipped model is trained on the first 500,000 examples of the blend. Most synthetic examples end
with the city, state and ZIP of a real libpostal address. Random formatting noise (case,
punctuation, spacing, typos) is added to the examples.

## Training data and accuracy by type

How the training data breaks down by address type, error type, extra text and region, and how
accurate the shipped model is on each part. Each example is put in a category by its gold labels,
dataset and formatting noise (`src/eval/dimensions.ts`).

<!-- breakdown:start: generated by pnpm readme from 2026-11-10T16-29-44__crf__full-test -->

Training share is the share of the 500,000 training examples with that value.
Exact match is on 20,000 held-out test examples, with a 95% interval;
a wide interval means there are too few examples to say more.
`pnpm slices 2026-11-10T16-29-44__crf__full-test --by <dimension>` reproduces each table.

**By address type** (`kind`):

| value              | meaning                                    | training share | test examples |         exact match |
| ------------------ | ------------------------------------------ | -------------: | ------------: | ------------------: |
| `junk`             | no address at all                          |           1.3% |           268 |   99.6% (97.9–99.9) |
| `military`         | PSC 1234 Box 5, APO AE 09204               |           0.5% |           103 | 100.0% (96.4–100.0) |
| `highway-contract` | HC 60 Box 4321                             |           0.7% |           132 | 100.0% (97.2–100.0) |
| `rural-route`      | RR 2 Box 123                               |           0.9% |           175 |   99.4% (96.8–99.9) |
| `general-delivery` | General Delivery, Kenai, AK                |           0.5% |           104 | 100.0% (96.4–100.0) |
| `po-box`           | PO Box 123                                 |           3.5% |           731 |   99.2% (98.2–99.6) |
| `milepost`         | Mile 14.5 Parks Hwy                        |           1.1% |           210 |   99.5% (97.4–99.9) |
| `street`           | 123 Main St                                |          61.6% |        12,142 |   98.9% (98.7–99.1) |
| `street-no-number` | Main St, a village street, an intersection |          13.4% |         2,668 |   97.9% (97.3–98.4) |
| `landmark`         | Teacher Housing, directions to the place   |           0.3% |            31 |   58.1% (40.8–73.6) |
| `place-only`       | a city, state, ZIP or country alone        |          16.2% |         3,436 |   99.4% (99.1–99.6) |
| `other`            | none of the above                          |           0.0% |             0 |                   – |

**By error type** (`error`; an example can have several, so shares add up to more than 100%):

| value           | meaning                                            | training share | test examples |       exact match |
| --------------- | -------------------------------------------------- | -------------: | ------------: | ----------------: |
| `none`          | none of these                                      |          43.2% |         8,735 | 98.8% (98.6–99.0) |
| `typo`          | a misspelt or truncated word (vermn, Plac)         |          10.5% |         2,030 | 98.5% (97.8–98.9) |
| `order`         | unit before the house number, ZIP before the state |           2.7% |           541 | 99.4% (98.4–99.8) |
| `joined`        | missing space: Apt4, PO Box55, AK99611, St.Apt     |           6.4% |         1,254 | 99.8% (99.3–99.9) |
| `line-break`    | a line break before the city                       |           3.4% |           617 | 98.9% (97.7–99.4) |
| `punctuation`   | extra periods: St. N.                              |           2.1% |           434 | 99.1% (97.7–99.6) |
| `case`          | all lowercase or all uppercase                     |           5.8% |         1,183 | 98.4% (97.5–99.0) |
| `missing-city`  | an address line with no city                       |          14.7% |         2,997 | 98.8% (98.3–99.1) |
| `missing-state` | an address line with no state                      |          17.6% |         3,590 | 98.6% (98.2–99.0) |
| `missing-zip`   | an address line with no ZIP                        |          38.8% |         7,759 | 98.9% (98.6–99.1) |

**By text besides the address** (`extra`; an example can have several, so shares add up to more than 100%):

| value             | meaning                                    | training share | test examples |       exact match |
| ----------------- | ------------------------------------------ | -------------: | ------------: | ----------------: |
| `none`            | the address alone                          |          93.1% |        18,653 | 98.9% (98.7–99.0) |
| `recipient`       | a name or C/O line (Recipient)             |           0.3% |            71 | 94.4% (86.4–97.8) |
| `other-text`      | other text around the address (NotAddress) |           5.4% |         1,034 | 98.4% (97.4–99.0) |
| `only-other-text` | no address at all                          |           1.3% |           268 | 99.6% (97.9–99.9) |

**By region** (`region`):

| value       | meaning                     | training share | test examples |         exact match |
| ----------- | --------------------------- | -------------: | ------------: | ------------------: |
| `alaska`    | AK                          |           5.3% |         1,096 |   95.0% (93.5–96.1) |
| `west`      | Census West, without AK     |          18.1% |         3,569 |   99.2% (98.9–99.5) |
| `midwest`   | Census Midwest              |          14.3% |         2,836 |   98.8% (98.4–99.2) |
| `south`     | Census South, with DC       |          30.3% |         6,092 |   99.2% (99.0–99.4) |
| `northeast` | Census Northeast            |          13.0% |         2,546 |   99.3% (98.9–99.6) |
| `territory` | PR, VI, GU, AS, MP          |           0.0% |            11 |   81.8% (52.3–94.9) |
| `military`  | AA, AE, AP                  |           0.5% |           102 | 100.0% (96.4–100.0) |
| `none`      | no state or ZIP in the text |          18.5% |         3,748 |   98.8% (98.4–99.1) |

<!-- breakdown:end -->

## How it works and how it's measured

I approached this with an "eval first" methodology. I defined two things:

- the dataset that I wanted to consider
- a collection of evals to optimize against: accuracy, confidence ranking, speed, memory, size,
  training cost, etc

Then, once I set an agent loose to hillclimb on these evals.
What it ended up with is a linear-chain CRF over word tokens with hashed features.
For more info, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License and data attribution

The code is MIT-licensed. The embedded model was trained on OpenStreetMap and OpenAddresses data;
if you ship this package in an app, you need to include an attribution. See
[LICENSING.md](https://github.com/NickCrews/nerdress/blob/main/LICENSING.md) for the text and
details.
