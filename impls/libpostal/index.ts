/**
 * Reference: libpostal (https://github.com/openvenues/libpostal), a CRF trained on OSM and
 * OpenAddresses, run in Python via `uv` and the `postal` bindings (pinned in predict.py and
 * predict.py.lock). Needs the libpostal C library and its ~2 GB data directory; see CONTRIBUTING.md.
 *
 * libpostal was trained on the same tagged lines our gold labels come from (src/data), so its
 * score is an optimistic upper reference, not a held-out one.
 *
 * libpostal's fields are coarse (the whole street is `road`), so each field is split into our
 * labels by the same rules that derive the gold labels from libpostal's training data
 * (src/data/refine.ts): `road` → StreetNamePre/PostDirectional, StreetNamePre/PostType,
 * StreetName; `unit`, `level` → OccupancyType/Identifier; `po_box` → USPSBoxGroupType/ID,
 * USPSBoxType/ID. The fine
 * labels therefore score libpostal plus those rules; the coarse metrics score libpostal alone.
 * Fields our gold removes from the text (suburb, house, ...) get no label.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeAdjacent } from "../../src/eval/accuracy.ts";
import { refineOccupancy, refinePoBox, refineRoad } from "../../src/data/refine.ts";
import {
  alignPieces,
  collectPredictions,
  lockedVersions,
  runJsonLines,
} from "../../src/eval/reference.ts";
import type { Label } from "../../src/labels.ts";
import { tokenize } from "../../src/tokens.ts";
import type { ReferenceImpl, Span } from "../../src/types.ts";

/** libpostal fields with one label for every token, as in src/data/refine.ts. */
const SIMPLE: Record<string, Label> = {
  house_number: "AddressNumber",
  city: "PlaceName",
  state: "StateName",
  postcode: "ZipCode",
  country: "CountryName",
  category: "NotAddress",
  near: "NotAddress",
};

/** Our labels for the whitespace tokens of one libpostal field, or undefined to leave it unlabeled. */
function fieldLabels(field: string, tokens: string[]): Label[] | undefined {
  const notes: string[] = [];
  const simple = SIMPLE[field];
  if (simple) return tokens.map(() => simple);
  if (field === "road") return refineRoad(tokens, notes);
  if (field === "unit" || field === "level") return refineOccupancy(tokens, notes);
  if (field === "po_box") return refinePoBox(tokens, notes);
  return undefined;
}

/** Spans of one parse_address result. */
export function toSpans(text: string, fields: readonly [string, string][]) {
  const ranges = alignPieces(
    text,
    fields.map(([value]) => value),
  );
  const spans: Span[] = [];
  let unaligned = 0;
  fields.forEach(([, field], i) => {
    const r = ranges[i];
    if (!r) return void unaligned++;
    const tokens = tokenize(text.slice(r.start, r.end));
    const labels = fieldLabels(
      field,
      tokens.map((t) => text.slice(r.start + t.coreStart, r.start + t.coreEnd)),
    );
    tokens.forEach((t, k) => {
      const label = labels?.[k];
      if (label) spans.push({ start: r.start + t.coreStart, end: r.start + t.coreEnd, label });
    });
  });
  return { spans: mergeAdjacent(text, spans), unaligned };
}

/** LIBPOSTAL_DATA_DIR, or the data directory of a Homebrew install. */
function dataDir(): string {
  if (process.env.LIBPOSTAL_DATA_DIR) return process.env.LIBPOSTAL_DATA_DIR;
  let prefix: string;
  try {
    prefix = execFileSync("brew", ["--prefix", "libpostal"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("libpostal not found: `brew install libpostal` or set LIBPOSTAL_DATA_DIR");
  }
  // homebrew-core installs the data to share/libpostal; some taps to share/libpostal-data/libpostal.
  const dirs = [
    join(prefix, "share", "libpostal"),
    join(prefix, "share", "libpostal-data", "libpostal"),
  ];
  const found = dirs.find((d) => existsSync(join(d, "address_parser")));
  if (!found) throw new Error(`no libpostal data in ${dirs.join(" or ")}; set LIBPOSTAL_DATA_DIR`);
  return found;
}

/** Versions of the parser model and base data, which the C library and bindings don't pin. */
function modelVersions(dir: string): Record<string, string> {
  const read = (f: string) => {
    try {
      return readFileSync(join(dir, f), "utf8").trim();
    } catch {
      return "unknown";
    }
  };
  return {
    libpostalParserModel: read("parser_model_file_version"),
    libpostalBaseData: read("base_data_file_version"),
  };
}

const impl: ReferenceImpl = {
  async predict(texts, ctx) {
    const LIBPOSTAL_DATA_DIR = dataDir();
    ctx.log(`  libpostal: parsing ${texts.length.toLocaleString("en-US")} texts in Python`);
    const out = await runJsonLines(
      "uv",
      ["run", "--quiet", "--locked", "--script", "predict.py"],
      texts,
      {
        cwd: import.meta.dirname,
        env: { ...process.env, LIBPOSTAL_DATA_DIR },
      },
    );
    const { unaligned, ...prediction } = collectPredictions(texts, out, toSpans);
    const versions = lockedVersions(join(import.meta.dirname, "predict.py.lock"));
    return {
      ...prediction,
      info: { ...versions, ...modelVersions(LIBPOSTAL_DATA_DIR), unaligned },
    };
  },
};
export default impl;
