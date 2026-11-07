/**
 * Milepost addresses, where a place on a highway is given by its distance marker instead of a
 * house number: "Mile 14.5 Parks Hwy", "MP 82 Sterling Hwy", "Glenn Hwy Mile 37", "MP 23", and
 * outside Alaska "Mile Marker 12 Hwy 93". The marker word is AddressNumberPrefix and its number
 * AddressNumber. Alaska's named highways get Alaska localities.
 */
import { int, pick, pickWeighted, type GeneratedDataset, type Part } from "../src/data/datasets.ts";
import { ALASKA, withLocality } from "./_forms.ts";

const PREFIXES = {
  Mile: 50,
  MILE: 10,
  Mi: 4,
  "Mi.": 2,
  MP: 14,
  Milepost: 10,
  "Mile Post": 4,
  "Mile Marker": 4,
  MM: 2,
};

/** Alaska highways and roads addressed by milepost, as [name, post type]. */
const ALASKA_ROADS: readonly (readonly [string, string])[] = [
  ["Parks", "Hwy"],
  ["Glenn", "Hwy"],
  ["Old Glenn", "Hwy"],
  ["Sterling", "Hwy"],
  ["Seward", "Hwy"],
  ["Richardson", "Hwy"],
  ["Steese", "Hwy"],
  ["Elliott", "Hwy"],
  ["Alaska", "Hwy"],
  ["Edgerton", "Hwy"],
  ["Denali", "Hwy"],
  ["Dalton", "Hwy"],
  ["Taylor", "Hwy"],
  ["Haines", "Hwy"],
  ["Kenai Spur", "Hwy"],
  ["Hope", "Hwy"],
  ["Palmer Wasilla", "Hwy"],
  ["Knik Goose Bay", "Rd"],
  ["Big Lake", "Rd"],
  ["Nash", "Rd"],
  ["Chena Hot Springs", "Rd"],
  ["Petersville", "Rd"],
  ["Hatcher Pass", "Rd"],
  ["Edgerton", "Rd"],
  ["Copper River", "Hwy"],
  ["Tok Cutoff", ""],
];

const HIGHWAY_TYPES = { Hwy: 60, Highway: 25, HWY: 12, "Hwy.": 3 };
const PRE_TYPES = { Hwy: 30, Highway: 20, "US Hwy": 12, "US Highway": 8, "State Route": 8 };
const UNITS = { Lot: 3, Spc: 2, Space: 1, Trlr: 1, Unit: 2, Apt: 1, "#": 1 };

/** A milepost number: whole miles up to 450, 40% of the time with tenths ("14.5"). */
function mile(rng: () => number): string {
  const n = rng() < 0.7 ? int(rng, 1, 150) : int(rng, 151, 450);
  return rng() < 0.4 ? `${n}.${int(rng, 0, 9)}` : String(n);
}

export default {
  description: "Mileposts: Mile 14.5 Parks Hwy, MP 82 Sterling Hwy, Glenn Hwy Mile 37",
  count: 40_000,
  generate(ctx) {
    const { rng } = ctx;
    const alaska = rng() < 0.75;
    let road: Part[];
    if (alaska) {
      const [name, type] = pick(rng, ALASKA_ROADS);
      const t = type === "Hwy" ? pickWeighted(rng, HIGHWAY_TYPES) : type;
      road = [[name, "StreetName"]];
      if (t) road.push(" ", [t, "StreetNamePostType"]);
    } else {
      const number = String(rng() < 0.7 ? int(rng, 1, 99) : int(rng, 100, 499));
      road = [[pickWeighted(rng, PRE_TYPES), "StreetNamePreType"], " ", [number, "StreetName"]];
    }
    const marker: Part[] = [
      [pickWeighted(rng, PREFIXES), "AddressNumberPrefix"],
      " ",
      [mile(rng), "AddressNumber"],
    ];
    const order = rng();
    // A marker alone ("MP 23") when the road is understood, as on a form's second line.
    const line: Part[] =
      order < 0.06
        ? marker
        : order < 0.82
          ? [...marker, " ", ...road]
          : [...road, rng() < 0.5 ? " " : ", ", ...marker];
    if (rng() < 0.08) {
      const unit = pickWeighted(rng, UNITS);
      const sep = rng() < 0.6 ? ", " : " ";
      const id = String(int(rng, 1, 40));
      // "#23" is all OccupancyIdentifier, as in usaddress and the unit-joined noise.
      if (unit === "#") line.push(sep, [`#${id}`, "OccupancyIdentifier"]);
      else line.push(sep, [unit, "OccupancyType"], " ", [id, "OccupancyIdentifier"]);
    }
    return withLocality(ctx, line, 0.75, alaska ? { state: ALASKA } : {});
  },
} satisfies GeneratedDataset;
