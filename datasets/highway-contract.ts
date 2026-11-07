/**
 * Highway contract route boxes, common in rural Alaska and the West: "HC 60 Box 4321",
 * "HCR 1 Box 45", "Highway Contract Route 2 Box 9", and the older "Star Route", which may have no
 * number ("Star Route Box 12").
 */
import { int, pickWeighted, type GeneratedDataset, type Part } from "../src/data/datasets.ts";
import { ALASKA, routeBox, routeSeparator, withLocality } from "./_forms.ts";

const ROUTES = {
  HC: 50,
  HCR: 20,
  "H.C.": 3,
  "Highway Contract": 4,
  "Highway Contract Route": 3,
  "Star Route": 6,
  "Star Rt": 2,
  "STAR ROUTE": 2,
};

export default {
  description: "Highway contract routes: HC 60 Box 4321, HCR 1 Box 45, Star Route Box 12",
  count: 25_000,
  generate(ctx) {
    const { rng } = ctx;
    const route = pickWeighted(rng, ROUTES);
    const line: Part[] = [[route, "USPSBoxGroupType"]];
    if (!route.toLowerCase().startsWith("star") || rng() < 0.5) {
      const id = String(rng() < 0.5 ? int(rng, 1, 9) : int(rng, 10, 99));
      line.push(" ", [id, "USPSBoxGroupID"]);
    }
    line.push(routeSeparator(rng), ...routeBox(rng));
    return withLocality(ctx, line, 0.8, { state: ALASKA, preferState: 0.4 });
  },
} satisfies GeneratedDataset;
