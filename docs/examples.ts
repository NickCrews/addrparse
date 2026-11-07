/**
 * The playground's topics, one preset each: the kinds of input the parser is built for.
 * `examples` are handpicked inputs written for the page, labeled by hand in the format of
 * overrides/gold.jsonl; demo.ts adds dev examples that pass `test`. The first topic is loaded
 * when the page opens.
 */
import { resolveSpans } from "../src/data/gold.ts";
import { checkSpans } from "../src/data/labeled.ts";
import type { Label } from "../src/labels.ts";
import type { Example } from "../src/types.ts";

export interface Topic {
  id: string;
  title: string;
  examples: Pick<Example, "text" | "spans">[];
  /** Whether a dev example, by its gold labels and source, belongs to this topic. */
  test(ex: Example): boolean;
}

/** An example from its text and its `[text, label]` pairs in order, as in overrides/gold.jsonl. */
function ex(text: string, pairs: [string, Label][]): Pick<Example, "text" | "spans"> {
  const spans = resolveSpans(text, pairs);
  checkSpans(text, spans);
  return { text, spans };
}

const has = (ex: Example, ...labels: string[]) => ex.spans.some((s) => labels.includes(s.label));
const from = (ex: Example, ...sources: string[]) => sources.includes(ex.source);

export const TOPICS: Topic[] = [
  {
    id: "street",
    title: "Street addresses",
    test: (ex) => has(ex, "AddressNumber") && has(ex, "StreetName") && !has(ex, "NotAddress"),
    examples: [
      ex("CO John SMITH, 123 E St elias stree S,   Oklahoma City, OK 99507-1234", [
        ["CO John SMITH", "NotAddress"],
        ["123", "AddressNumber"],
        ["E", "StreetNamePreDirectional"],
        ["St elias", "StreetName"],
        ["stree", "StreetNamePostType"],
        ["S", "StreetNamePostDirectional"],
        ["Oklahoma City", "PlaceName"],
        ["OK", "StateName"],
        ["99507-1234", "ZipCode"],
      ]),
      ex("1600 Pennsylvania Ave NW, Washington, DC 20500", [
        ["1600", "AddressNumber"],
        ["Pennsylvania", "StreetName"],
        ["Ave", "StreetNamePostType"],
        ["NW", "StreetNamePostDirectional"],
        ["Washington", "PlaceName"],
        ["DC", "StateName"],
        ["20500", "ZipCode"],
      ]),
      ex("350 5th Ave Suite 3300, New York, NY 10118", [
        ["350", "AddressNumber"],
        ["5th", "StreetName"],
        ["Ave", "StreetNamePostType"],
        ["Suite", "OccupancyType"],
        ["3300", "OccupancyIdentifier"],
        ["New York", "PlaceName"],
        ["NY", "StateName"],
        ["10118", "ZipCode"],
      ]),
      ex("12 N Main St Apt 4B, Springfield, IL 62701-1234", [
        ["12", "AddressNumber"],
        ["N", "StreetNamePreDirectional"],
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
        ["Apt", "OccupancyType"],
        ["4B", "OccupancyIdentifier"],
        ["Springfield", "PlaceName"],
        ["IL", "StateName"],
        ["62701-1234", "ZipCode"],
      ]),
      ex("4059 Mt Lee Dr, Hollywood, CA 90068", [
        ["4059", "AddressNumber"],
        ["Mt Lee", "StreetName"],
        ["Dr", "StreetNamePostType"],
        ["Hollywood", "PlaceName"],
        ["CA", "StateName"],
        ["90068", "ZipCode"],
      ]),
      ex("2200 Old Highway 9 Unit 7, Felton, CA 95018", [
        ["2200", "AddressNumber"],
        ["Old", "StreetNamePreModifier"],
        ["Highway", "StreetNamePreType"],
        ["9", "StreetName"],
        ["Unit", "OccupancyType"],
        ["7", "OccupancyIdentifier"],
        ["Felton", "PlaceName"],
        ["CA", "StateName"],
        ["95018", "ZipCode"],
      ]),
      ex("45-29 Bell Blvd, Bayside, NY 11361", [
        ["45-29", "AddressNumber"],
        ["Bell", "StreetName"],
        ["Blvd", "StreetNamePostType"],
        ["Bayside", "PlaceName"],
        ["NY", "StateName"],
        ["11361", "ZipCode"],
      ]),
    ],
  },
  {
    id: "partial",
    title: "Partial addresses",
    test: (ex) =>
      !has(ex, "AddressNumber", "USPSBoxID", "USPSBoxType", "NotAddress") ||
      (has(ex, "AddressNumber") && !has(ex, "PlaceName", "ZipCode", "NotAddress")),
    examples: [
      ex("123 Main St", [
        ["123", "AddressNumber"],
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
      ]),
      ex("Martin Luther King Jr Blvd", [
        ["Martin Luther King Jr", "StreetName"],
        ["Blvd", "StreetNamePostType"],
      ]),
      ex("Sled Ct, Palm Coast, Florida", [
        ["Sled", "StreetName"],
        ["Ct", "StreetNamePostType"],
        ["Palm Coast", "PlaceName"],
        ["Florida", "StateName"],
      ]),
      ex("Anchorage, AK", [
        ["Anchorage", "PlaceName"],
        ["AK", "StateName"],
      ]),
      ex("Springfield, Illinois 62704", [
        ["Springfield", "PlaceName"],
        ["Illinois", "StateName"],
        ["62704", "ZipCode"],
      ]),
      ex("Kenai AK 99611", [
        ["Kenai", "PlaceName"],
        ["AK", "StateName"],
        ["99611", "ZipCode"],
      ]),
      ex("90210", [["90210", "ZipCode"]]),
    ],
  },
  {
    id: "po-box",
    title: "PO boxes",
    test: (ex) => from(ex, "po-box"),
    examples: [
      ex("PO Box 55, Juneau, AK 99802", [
        ["PO Box", "USPSBoxType"],
        ["55", "USPSBoxID"],
        ["Juneau", "PlaceName"],
        ["AK", "StateName"],
        ["99802", "ZipCode"],
      ]),
      ex("P.O. Box 1234, Bethel AK 99559", [
        ["P.O. Box", "USPSBoxType"],
        ["1234", "USPSBoxID"],
        ["Bethel", "PlaceName"],
        ["AK", "StateName"],
        ["99559", "ZipCode"],
      ]),
      ex("POB 77 Nome, AK 99762", [
        ["POB", "USPSBoxType"],
        ["77", "USPSBoxID"],
        ["Nome", "PlaceName"],
        ["AK", "StateName"],
        ["99762", "ZipCode"],
      ]),
      ex("Post Office Box 8, Talkeetna, AK 99676", [
        ["Post Office Box", "USPSBoxType"],
        ["8", "USPSBoxID"],
        ["Talkeetna", "PlaceName"],
        ["AK", "StateName"],
        ["99676", "ZipCode"],
      ]),
      ex("Drawer 3000, Barrow, AK 99723", [
        ["Drawer", "USPSBoxType"],
        ["3000", "USPSBoxID"],
        ["Barrow", "PlaceName"],
        ["AK", "StateName"],
        ["99723", "ZipCode"],
      ]),
    ],
  },
  {
    id: "rural",
    title: "Rural and highway contract routes",
    test: (ex) => from(ex, "rural-route", "highway-contract"),
    examples: [
      ex("RR 2 Box 123, Hartford, KY 42347", [
        ["RR", "USPSBoxGroupType"],
        ["2", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["123", "USPSBoxID"],
        ["Hartford", "PlaceName"],
        ["KY", "StateName"],
        ["42347", "ZipCode"],
      ]),
      ex("Rural Route 4, Box 17A, Ames IA 50010", [
        ["Rural Route", "USPSBoxGroupType"],
        ["4", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["17A", "USPSBoxID"],
        ["Ames", "PlaceName"],
        ["IA", "StateName"],
        ["50010", "ZipCode"],
      ]),
      ex("RFD 3, Bangor, ME 04401", [
        ["RFD", "USPSBoxGroupType"],
        ["3", "USPSBoxGroupID"],
        ["Bangor", "PlaceName"],
        ["ME", "StateName"],
        ["04401", "ZipCode"],
      ]),
      ex("HC 60 Box 4321, Kenai, AK 99611", [
        ["HC", "USPSBoxGroupType"],
        ["60", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["4321", "USPSBoxID"],
        ["Kenai", "PlaceName"],
        ["AK", "StateName"],
        ["99611", "ZipCode"],
      ]),
      ex("HCR 1 Box 45, Paradise Valley, NV 89426", [
        ["HCR", "USPSBoxGroupType"],
        ["1", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["45", "USPSBoxID"],
        ["Paradise Valley", "PlaceName"],
        ["NV", "StateName"],
        ["89426", "ZipCode"],
      ]),
    ],
  },
  {
    id: "milepost",
    title: "Mileposts",
    test: (ex) => from(ex, "milepost"),
    examples: [
      ex("Mile 14.5 Parks Hwy, Wasilla, AK 99654", [
        ["Mile", "AddressNumberPrefix"],
        ["14.5", "AddressNumber"],
        ["Parks", "StreetName"],
        ["Hwy", "StreetNamePostType"],
        ["Wasilla", "PlaceName"],
        ["AK", "StateName"],
        ["99654", "ZipCode"],
      ]),
      ex("MP 82 Sterling Hwy, Soldotna AK", [
        ["MP", "AddressNumberPrefix"],
        ["82", "AddressNumber"],
        ["Sterling", "StreetName"],
        ["Hwy", "StreetNamePostType"],
        ["Soldotna", "PlaceName"],
        ["AK", "StateName"],
      ]),
      ex("Mile 1314 Alaska Highway, Tok, AK 99780", [
        ["Mile", "AddressNumberPrefix"],
        ["1314", "AddressNumber"],
        ["Alaska", "StreetName"],
        ["Highway", "StreetNamePostType"],
        ["Tok", "PlaceName"],
        ["AK", "StateName"],
        ["99780", "ZipCode"],
      ]),
      ex("Milepost 3.5 Edgerton Hwy, Chitina, AK", [
        ["Milepost", "AddressNumberPrefix"],
        ["3.5", "AddressNumber"],
        ["Edgerton", "StreetName"],
        ["Hwy", "StreetNamePostType"],
        ["Chitina", "PlaceName"],
        ["AK", "StateName"],
      ]),
    ],
  },
  {
    id: "other-mail",
    title: "General delivery and military mail",
    test: (ex) => from(ex, "general-delivery", "military"),
    // APO or FPO is the PlaceName and AA, AE or AP the StateName, as in USPS Publication 28.
    examples: [
      ex("General Delivery, Kenai, AK 99611", [
        ["General Delivery", "USPSBoxType"],
        ["Kenai", "PlaceName"],
        ["AK", "StateName"],
        ["99611", "ZipCode"],
      ]),
      ex("GENERAL DELIVERY SITKA AK 99835", [
        ["GENERAL DELIVERY", "USPSBoxType"],
        ["SITKA", "PlaceName"],
        ["AK", "StateName"],
        ["99835", "ZipCode"],
      ]),
      ex("PSC 1234, Box 5678, APO AE 09204", [
        ["PSC", "USPSBoxGroupType"],
        ["1234", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["5678", "USPSBoxID"],
        ["APO", "PlaceName"],
        ["AE", "StateName"],
        ["09204", "ZipCode"],
      ]),
      ex("Unit 2050 Box 4190, APO AP 96278", [
        ["Unit", "USPSBoxGroupType"],
        ["2050", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["4190", "USPSBoxID"],
        ["APO", "PlaceName"],
        ["AP", "StateName"],
        ["96278", "ZipCode"],
      ]),
      ex("CMR 450 Box 12, APO AE 09128", [
        ["CMR", "USPSBoxGroupType"],
        ["450", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["12", "USPSBoxID"],
        ["APO", "PlaceName"],
        ["AE", "StateName"],
        ["09128", "ZipCode"],
      ]),
      ex("PSC 802 Box 74 FPO AE 09499-0074", [
        ["PSC", "USPSBoxGroupType"],
        ["802", "USPSBoxGroupID"],
        ["Box", "USPSBoxType"],
        ["74", "USPSBoxID"],
        ["FPO", "PlaceName"],
        ["AE", "StateName"],
        ["09499-0074", "ZipCode"],
      ]),
    ],
  },
  {
    id: "not-address",
    title: "Not an address",
    test: (ex) => has(ex, "NotAddress"),
    examples: [
      ex("N/A", [["N/A", "NotAddress"]]),
      ex("same as above", [["same as above", "NotAddress"]]),
      ex("(907) 555-0123", [["(907) 555-0123", "NotAddress"]]),
      ex("jane.doe@example.com", [["jane.doe@example.com", "NotAddress"]]),
      ex("unknown", [["unknown", "NotAddress"]]),
      ex("Mail to 12 Main St, Juneau AK 99801, thanks", [
        ["Mail to", "NotAddress"],
        ["12", "AddressNumber"],
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
        ["Juneau", "PlaceName"],
        ["AK", "StateName"],
        ["99801", "ZipCode"],
        ["thanks", "NotAddress"],
      ]),
      ex("call me at 1600 Pennsylvania Ave NW", [
        ["call me at", "NotAddress"],
        ["1600", "AddressNumber"],
        ["Pennsylvania", "StreetName"],
        ["Ave", "StreetNamePostType"],
        ["NW", "StreetNamePostDirectional"],
      ]),
    ],
  },
  {
    id: "noise",
    title: "Formatting noise",
    test: (ex) => !!ex.noise?.length,
    examples: [
      ex("123 MAIN STREET APT 4 ANCHORAGE ALASKA 99501", [
        ["123", "AddressNumber"],
        ["MAIN", "StreetName"],
        ["STREET", "StreetNamePostType"],
        ["APT", "OccupancyType"],
        ["4", "OccupancyIdentifier"],
        ["ANCHORAGE", "PlaceName"],
        ["ALASKA", "StateName"],
        ["99501", "ZipCode"],
      ]),
      ex("123 main st apt 4 anchorage ak 99501", [
        ["123", "AddressNumber"],
        ["main", "StreetName"],
        ["st", "StreetNamePostType"],
        ["apt", "OccupancyType"],
        ["4", "OccupancyIdentifier"],
        ["anchorage", "PlaceName"],
        ["ak", "StateName"],
        ["99501", "ZipCode"],
      ]),
      ex("123  Main   St,,  Anchorage ,AK  99501", [
        ["123", "AddressNumber"],
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
        ["Anchorage", "PlaceName"],
        ["AK", "StateName"],
        ["99501", "ZipCode"],
      ]),
      ex("123 Main Stret Aprt 4, Anchorage AK", [
        ["123", "AddressNumber"],
        ["Main", "StreetName"],
        ["Stret", "StreetNamePostType"],
        ["Aprt", "OccupancyType"],
        ["4", "OccupancyIdentifier"],
        ["Anchorage", "PlaceName"],
        ["AK", "StateName"],
      ]),
      ex("123 W. 4th Ave., Ste. 200, Anchorage, AK 99501", [
        ["123", "AddressNumber"],
        ["W.", "StreetNamePreDirectional"],
        ["4th", "StreetName"],
        ["Ave.", "StreetNamePostType"],
        ["Ste.", "OccupancyType"],
        ["200", "OccupancyIdentifier"],
        ["Anchorage", "PlaceName"],
        ["AK", "StateName"],
        ["99501", "ZipCode"],
      ]),
    ],
  },
];
