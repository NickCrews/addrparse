/**
 * Rural route boxes: "RR 2 Box 123", "Rural Route 2, Box 123", "Rt 1 Box 55", "RFD 3 Box 12",
 * "RD 2 Box 40" (Pennsylvania's rural delivery), or a route alone ("RR 4"). Rt, Rte and Route
 * are only written with a box, since "Route 2" alone is a street.
 */
import { int, pickWeighted, type GeneratedDataset, type Part } from "../src/data/datasets.ts";
import { routeBox, routeSeparator, withLocality } from "./_forms.ts";

/** Route words; ALONE are the ones also written without a box. */
const ROUTES = {
  RR: 40,
  "Rural Route": 12,
  "RURAL ROUTE": 4,
  "R.R.": 5,
  "R R": 1,
  Rt: 8,
  "Rt.": 2,
  Rte: 6,
  RT: 3,
  RTE: 2,
  Route: 5,
  RFD: 3,
  RD: 3,
};
const ALONE = new Set(["RR", "Rural Route", "RURAL ROUTE", "R.R.", "R R", "RFD"]);

export default {
  description: "Rural routes: RR 2 Box 123, Rural Route 2, Box 123, Rt 1 Box 55, RFD 3 Box 12",
  count: 30_000,
  generate(ctx) {
    const { rng } = ctx;
    const route = pickWeighted(rng, ROUTES);
    const id = String(rng() < 0.7 ? int(rng, 1, 9) : int(rng, 10, 40));
    const line: Part[] = [[route, "USPSBoxGroupType"], " ", [id, "USPSBoxGroupID"]];
    if (!ALONE.has(route) || rng() < 0.88) line.push(routeSeparator(rng), ...routeBox(rng));
    return withLocality(ctx, line, 0.8);
  },
} satisfies GeneratedDataset;
