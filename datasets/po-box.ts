/**
 * PO boxes as people write them on forms: "PO Box 123", "P.O. Box 123", "POB 123", "Box 123",
 * "PO Drawer 5", sometimes after a street line ("12 Main St, PO Box 5"), usually followed by a
 * real city, state and ZIP.
 */
import { pickWeighted, type GeneratedDataset, type Part } from "../src/data/datasets.ts";
import { ALASKA, boxNumber, withLocality } from "./_forms.ts";

const BOX_TYPES = {
  "PO Box": 38,
  "P.O. Box": 18,
  "PO BOX": 12,
  "Po Box": 3,
  "P O Box": 4,
  "P.O.Box": 2,
  POB: 3,
  Box: 10,
  BOX: 2,
  "Post Office Box": 4,
  Pobox: 1,
  "PO Drawer": 2,
  "P.O. Drawer": 1,
  Drawer: 1,
};

export default {
  description: "PO boxes: PO Box 123, P.O. Box, POB, Box, PO Drawer, after a street line or alone",
  count: 60_000,
  generate(ctx) {
    const { rng } = ctx;
    let type: string = pickWeighted(rng, BOX_TYPES);
    if (rng() < 0.04) type += " #";
    const box: Part[] = [[type, "USPSBoxType"], " ", [boxNumber(rng), "USPSBoxID"]];
    // A street line and a box both, as when a form's two address lines are joined.
    const line = rng() < 0.08 ? [...ctx.street(), rng() < 0.7 ? ", " : " ", ...box] : box;
    return withLocality(ctx, line, 0.75, { state: ALASKA, preferState: 0.2 });
  },
} satisfies GeneratedDataset;
