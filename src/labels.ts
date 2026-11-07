/**
 * Output labels. Names follow usaddress, which follows the FGDC United States Thoroughfare,
 * Landmark, and Postal Address Data Standard. See src/data/refine.ts for how each one is derived
 * from libpostal's coarser labels.
 */
export const LABELS = {
  AddressNumber: "House number: 123, 123A, 45-29",
  AddressNumberSuffix:
    "Letter, letter+digit or fraction as its own word after the number: 12 B, 12 1/2",
  StreetNamePreModifier: "Word before a pre-typed road that is not part of its name: Old Highway 9",
  StreetNamePreDirectional: "Directional before the street name: N, Northwest",
  StreetNamePreType: "Street type before the name: Highway 9, County Road 1147",
  StreetName: "The street name itself: Main, Martin Luther King",
  StreetNamePostType: "Street type after the name: St, Avenue",
  StreetNamePostDirectional: "Directional after the street type: Main St NE",
  OccupancyType: "Unit designator: Apt, Suite, #, Floor, / F; or a numberless level: Basement, Gf",
  OccupancyIdentifier: "Unit number: 4B, 2009",
  USPSBoxType: "PO box designator: PO Box, P.O. Box",
  USPSBoxID: "PO box number",
  PlaceName: "City or town",
  StateName: "State, abbreviated or spelled out",
  ZipCode: "ZIP or ZIP+4",
  CountryName: "Country",
  NotAddress: "Text that is not part of an address; lets a model abstain",
} as const;

export type Label = keyof typeof LABELS;

export const LABEL_NAMES = Object.keys(LABELS) as Label[];

export function isLabel(s: string): s is Label {
  return Object.hasOwn(LABELS, s);
}
