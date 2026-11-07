/**
 * General delivery: mail held at a post office for pickup, addressed "General Delivery" and the
 * office's city, state and ZIP. The whole designator is USPSBoxType, with no USPSBoxID.
 */
import { pickWeighted, type GeneratedDataset } from "../src/data/datasets.ts";
import { ALASKA, withLocality } from "./_forms.ts";

const FORMS = {
  "General Delivery": 68,
  "GENERAL DELIVERY": 20,
  "general delivery": 2,
  "Gen Delivery": 4,
  "Gen. Delivery": 3,
  "General Del": 3,
};

export default {
  description: "General delivery: General Delivery, Kenai, AK 99611",
  count: 25_000,
  generate(ctx) {
    const form = pickWeighted(ctx.rng, FORMS);
    return withLocality(ctx, [[form, "USPSBoxType"]], 0.95, { state: ALASKA, preferState: 0.3 });
  },
} satisfies GeneratedDataset;
