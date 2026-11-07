# addrparse

US address parsing, ready for production:

- **Run anywhere:** Pure javascript/typescript, no dependencies
- **Accurate:** 98.25% of held-out test addresses parsed exactly right, 99.85% of words
  labeled right.
- **Small and fast:** ~390 KB gzipped including the model, ~100k/sec, nothing to download or set up.
- **Comprehensive:** Any US physical or mailing address: street addresses, PO boxes, rural and highway contract routes, general
  delivery, mileposts and military mail.
- **Says how sure it is:** `confidence` is the probability that every span is right. Accept
  confident parses and send the rest for review; the 90% most confident test parses are 98.86%
  exactly right.
- **Recognizes non-addresses:** junk is labeled `NotAddress` instead of being forced into a parse.

```js
import { parse } from "addrparse";
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
// confidence: 0.923
```

## API

```sh
npm install addrparse
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
delivery, mileposts and military mail. It does not validate addresses (whether one exists or
gets mail), geocode them, or standardize them (rewrite Street as ST, fill in a missing ZIP);
spans point into the input unchanged. Names of people and businesses are `NotAddress`.

The data is a custom blend from several different sources:

| dataset            | share | training examples | source                                        | example                                 |
| ------------------ | ----: | ----------------: | --------------------------------------------- | --------------------------------------- |
| `openaddresses`    | 45.4% |           226,759 | libpostal: OpenAddresses government data      | 123 Main St, Springfield, IL 62704      |
| `osm`              | 34.5% |           172,336 | libpostal: OpenStreetMap addresses            | 45 Oak Ave Apt 2, Portland, OR 97214    |
| `ways`             |  7.7% |            38,549 | libpostal: OpenStreetMap street and its place | Sled Ct, Palm Coast, Florida            |
| `places`           |  4.1% |            20,408 | libpostal: OpenStreetMap place names          | Willistown, Chester County, PA          |
| `embedded`         |  1.8% |             8,843 | synthetic: an address inside other text       | Mail to 12 Main St, thanks              |
| `junk`             |  1.2% |             6,122 | synthetic: text with no address               | N/A; same as above; 555-0123            |
| `po-box`           |  1.8% |             9,070 | synthetic                                     | PO Box 123, P.O. Box, POB, Drawer       |
| `rural-route`      |  0.9% |             4,535 | synthetic                                     | RR 2 Box 123, Rural Route 2, RFD 3      |
| `milepost`         |  0.9% |             4,535 | synthetic                                     | Mile 14.5 Parks Hwy, MP 82 Sterling Hwy |
| `highway-contract` |  0.7% |             3,401 | synthetic                                     | HC 60 Box 4321, HCR 1 Box 45            |
| `general-delivery` |  0.5% |             2,721 | synthetic                                     | General Delivery, Kenai, AK 99611       |
| `military`         |  0.5% |             2,721 | synthetic                                     | PSC 1234, Box 5678, APO AE 09204        |
| **total**          |  100% |       **500,000** |                                               |                                         |

Share is each dataset's weight in the training and eval sets. The shipped model is trained on the first 500,000 examples of the blend.
Most synthetic examples end with the city, state and ZIP of a real libpostal address.
Random formatting noise (case, punctuation, spacing) is added to the examples.

## How it works and how it's measured

I approached this with an "eval first" methodology. I defined two things:

- the dataset that I wanted to consider
- a collection of evals to optimize against: accuracy, confidence ranking, speed, memory, size,
  training cost, etc

Then, once I set an agent loose to hillclimb on these evals.
What it ended up with is a linear-chain CRF over whitespace tokens with hashed features.
For more info, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License and data attribution

The code is MIT-licensed. The embedded model was trained on data under the Open Database License
and other terms; if you ship this package in an app, keep this attribution in your app's
documentation or about page:

> Trained on address data from © OpenStreetMap contributors, available under the Open Database
> License (https://www.openstreetmap.org/copyright), and from OpenAddresses
> (https://openaddresses.io) and the government sources listed at
> https://github.com/openaddresses/openaddresses/tree/06015e09e15bbcfdaac7d10883665db66c4d1f1c/sources/us,
> including Oregon Metro (ODbL 1.0), via libpostal's training data
> (https://github.com/openvenues/libpostal). The data was relabeled and reformatted by
> https://github.com/NickCrews/addrparse/tree/main/src/data.

The model stores hashed features and weights, not address strings.
