/**
 * Military mail (APO, FPO, DPO): "PSC 1234, Box 5678, APO AE 09204", "Unit 2050 Box 4190, APO AP
 * 96278", "CMR 450 Box 12, APO AE 09128". The PSC, Unit or CMR number is the box's route
 * (USPSBoxGroupType, USPSBoxGroupID); APO, FPO or DPO is the PlaceName and AA, AE or AP the
 * StateName, as USPS Publication 28 has them in the city and state positions.
 */
import { int, pick, pickWeighted, type GeneratedDataset, type Part } from "../src/data/datasets.ts";
import { routeBox, routeSeparator } from "./_forms.ts";

const GROUPS = { PSC: 45, Unit: 30, UNIT: 8, CMR: 17 };
const POST_OFFICES = { APO: 70, FPO: 22, DPO: 8 };

/** ZIP ranges of each military "state": AA 340xx, AE 090xx-098xx, AP 962xx-966xx. */
function stateAndZip(rng: () => number): [string, string] {
  const state = pick(rng, ["AE", "AE", "AP", "AA"] as const);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  const zip =
    state === "AA"
      ? `340${pad(int(rng, 0, 99), 2)}`
      : state === "AE"
        ? `09${pad(int(rng, 0, 899), 3)}`
        : `96${int(rng, 2, 6)}${pad(int(rng, 0, 99), 2)}`;
  return [state, rng() < 0.1 ? `${zip}-${pad(int(rng, 0, 9999), 4)}` : zip];
}

export default {
  description: "Military mail: PSC 1234, Box 5678, APO AE 09204; Unit 2050 Box 4190, APO AP 96278",
  count: 25_000,
  generate(ctx) {
    const { rng } = ctx;
    const group = pickWeighted(rng, GROUPS);
    const line: Part[] = [
      [group, "USPSBoxGroupType"],
      " ",
      [String(int(rng, group === "CMR" ? 400 : 1000, 9999)), "USPSBoxGroupID"],
      routeSeparator(rng),
      ...routeBox(rng),
    ];
    const [state, zip] = stateAndZip(rng);
    const sep = rng() < 0.6 ? ", " : " ";
    line.push(sep, [pickWeighted(rng, POST_OFFICES), "PlaceName"]);
    line.push(rng() < 0.8 ? " " : ", ", [state, "StateName"]);
    if (rng() < 0.92) line.push(" ", [zip, "ZipCode"]);
    return line;
  },
} satisfies GeneratedDataset;
