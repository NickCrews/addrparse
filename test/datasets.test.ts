import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { blendLabel, parseWeights, resolveBlend } from "../src/data/blend.ts";
import {
  fromParts,
  listDatasets,
  toParts,
  type GeneratedDataset,
  type Part,
} from "../src/data/datasets.ts";
import { checked, parseLabeled } from "../src/data/labeled.ts";
import { blendedLines } from "../src/data/load.ts";
import { seededRng } from "../src/data/noise.ts";
import { datasetPath, manifestPath, ROOT } from "../src/data/paths.ts";

const registry = listDatasets();
const all = registry.map((d) => d.name);

describe("listDatasets", () => {
  it("lists the libpostal and not-address datasets, then datasets/ files", () => {
    assert.deepEqual(all.slice(0, 6), [
      "openaddresses",
      "osm",
      "ways",
      "places",
      "junk",
      "embedded",
    ]);
    for (const name of ["po-box", "rural-route", "general-delivery", "milepost", "military"]) {
      assert.ok(all.includes(name), name);
    }
    assert.ok(!all.includes("_forms"), "files starting with _ are helpers");
  });

  it("tags datasets by kind and reads .jsonl files as labeled", () => {
    const dir = mkdtempSync(join(tmpdir(), "addrparse-datasets-"));
    writeFileSync(join(dir, "mine.jsonl"), "");
    writeFileSync(join(dir, "gen.ts"), "");
    const ds = listDatasets(dir);
    assert.deepEqual(ds.find((d) => d.name === "mine")?.tags, ["labeled"]);
    assert.deepEqual(ds.find((d) => d.name === "gen")?.tags, ["synthetic"]);
    assert.deepEqual(ds.find((d) => d.name === "osm")?.tags, ["libpostal"]);
  });

  it("rejects names that can't be a slice or CLI token", () => {
    const dir = mkdtempSync(join(tmpdir(), "addrparse-datasets-"));
    writeFileSync(join(dir, "My Data.jsonl"), "");
    assert.throws(() => listDatasets(dir), /lowercase/);
  });
});

describe("resolveBlend", () => {
  it("defaults to DATASET_WEIGHTS over the available datasets", () => {
    const w = resolveBlend({}, ["openaddresses", "osm", "po-box"], registry);
    assert.deepEqual(Object.keys(w), ["openaddresses", "osm", "po-box"]);
    assert.equal(w.openaddresses, 1);
  });

  it("keeps only `use` and drops `without`, by name or tag", () => {
    const w = resolveBlend({ use: ["libpostal", "po-box"], without: ["ways"] }, all, registry);
    assert.deepEqual(Object.keys(w), ["openaddresses", "osm", "places", "po-box"]);
    const none = resolveBlend({ without: ["synthetic", "not-address"] }, all, registry);
    assert.deepEqual(Object.keys(none), ["openaddresses", "osm", "ways", "places"]);
  });

  it("overrides weights, and weight 0 drops a dataset", () => {
    const w = resolveBlend({ weights: { "po-box": 0.5, military: 0 } }, all, registry);
    assert.equal(w["po-box"], 0.5);
    assert.ok(!("military" in w));
  });

  it("rejects unknown names and blends that leave nothing", () => {
    assert.throws(() => resolveBlend({ without: ["nope"] }, all, registry), /not a dataset or tag/);
    assert.throws(() => resolveBlend({ weights: { nope: 1 } }, all, registry), /not a dataset/);
    assert.throws(() => resolveBlend({ use: ["labeled"] }, all, registry), /every dataset/);
  });
});

describe("blendLabel", () => {
  it("is default for an empty blend and stable otherwise", () => {
    assert.equal(blendLabel({ use: [], without: [], weights: {} }), "default");
    assert.equal(
      blendLabel({ without: ["synthetic", "junk"], weights: { osm: 2, "po-box": 0 } }),
      "without=junk,synthetic+osm=2+po-box=0",
    );
  });
  it("parses --mix pairs", () => {
    assert.deepEqual(parseWeights(["po-box=0.5", "osm=0"]), { "po-box": 0.5, osm: 0 });
    assert.throws(() => parseWeights(["po-box"]), /expected/);
    assert.throws(() => parseWeights(["po-box=-1"]), /expected/);
  });
});

describe("blendedLines", () => {
  const dir = mkdtempSync(join(tmpdir(), "addrparse-blend-"));
  const write = (split: string, name: string, n: number) => {
    mkdirSync(join(dir, split), { recursive: true });
    const lines = Array.from({ length: n }, (_, i) => `{"id":"${name}:${i}"}\n`).join("");
    writeFileSync(datasetPath(split as "train", name, dir), lines);
  };
  write("train", "osm", 6);
  write("train", "po-box", 2);
  writeFileSync(
    manifestPath(dir),
    JSON.stringify({
      datasets: { osm: { train: 6, dev: 0, test: 0 }, "po-box": { train: 2, dev: 0, test: 0 } },
    }),
  );
  const ids = async (n: number, w: Record<string, number>) =>
    (await blendedLines("train", n, w, dir)).map((l) => (JSON.parse(l.line) as { id: string }).id);

  it("interleaves datasets by weight, then continues with the rest", async () => {
    assert.deepEqual(await ids(6, { osm: 1, "po-box": 0.5 }), [
      "osm:0",
      "osm:1",
      "po-box:0",
      "osm:2",
      "osm:3",
      "po-box:1",
    ]);
    assert.deepEqual((await ids(8, { osm: 1, "po-box": 0.5 })).slice(6), ["osm:4", "osm:5"]);
  });

  it("leaves out datasets with no weight", async () => {
    assert.deepEqual(await ids(3, { osm: 1 }), ["osm:0", "osm:1", "osm:2"]);
  });

  it("fails when the blend has too few examples", async () => {
    await assert.rejects(() => ids(9, { osm: 1, "po-box": 1 }), /only 8 examples/);
  });
});

describe("parts", () => {
  it("round-trips text and spans", () => {
    const parts: Part[] = [
      ["PO Box", "USPSBoxType"],
      " ",
      ["12", "USPSBoxID"],
      ", ",
      ["Kenai", "PlaceName"],
    ];
    const { text, spans } = fromParts(parts);
    assert.equal(text, "PO Box 12, Kenai");
    assert.deepEqual(toParts(text, spans), parts);
  });
  it("rejects spans with whitespace at an edge", () => {
    assert.throws(
      () =>
        checked([
          ["PO Box ", "USPSBoxType"],
          ["12", "USPSBoxID"],
        ]),
      /whitespace/,
    );
  });
});

describe("parseLabeled", () => {
  it("reads [text, label] pairs and {start, end, label} spans", () => {
    const src = [
      `{"text": "RR 2 Box 5, Nome, AK", "spans": [["RR", "USPSBoxGroupType"], ["2", "USPSBoxGroupID"], ["Box", "USPSBoxType"], ["5", "USPSBoxID"], ["Nome", "PlaceName"], ["AK", "StateName"]]}`,
      "",
      `{"id": "x", "text": "General Delivery", "spans": [{"start": 0, "end": 16, "label": "USPSBoxType"}]}`,
    ].join("\n");
    const [a, b] = parseLabeled(src, "mine");
    assert.equal(a!.id, "mine:1");
    assert.equal(a!.source, "mine");
    assert.deepEqual(a!.spans[3], { start: 9, end: 10, label: "USPSBoxID" });
    assert.equal(b!.id, "x");
  });

  it("names the line of a bad example", () => {
    assert.throws(
      () => parseLabeled(`{"text": "a b", "spans": [["a", "Nope"]]}`, "mine", "mine.jsonl"),
      /mine\.jsonl:1: .*unknown label Nope/,
    );
    assert.throws(
      () => parseLabeled(`\n{"text": "a b", "spans": [["c", "PlaceName"]]}`, "mine", "mine.jsonl"),
      /mine\.jsonl:2: .*not found/,
    );
  });
});

describe("generated datasets", () => {
  const locality: Part[] = [
    ", ",
    ["Kenai", "PlaceName"],
    ", ",
    ["AK", "StateName"],
    " ",
    ["99611", "ZipCode"],
  ];
  const street: Part[] = [
    ["12", "AddressNumber"],
    " ",
    ["Main", "StreetName"],
    " ",
    ["St", "StreetNamePostType"],
  ];
  for (const d of registry.filter((d) => d.kind === "generated")) {
    it(`${d.name} makes valid, deterministic examples`, async () => {
      const def = (await import(d.path!)).default as GeneratedDataset;
      assert.ok(def.description && def.count > 0);
      const make = (i: number) => {
        const rng = seededRng(`${d.name}:${i}`);
        const parts = def.generate({
          rng,
          locality: () => [...locality],
          street: () => [...street],
        });
        return parts && checked(parts);
      };
      for (let i = 0; i < 500; i++) assert.deepEqual(make(i), make(i));
    });
  }
});

describe("datasets/README.md", () => {
  it("exists, for people adding a dataset", () => {
    assert.ok(existsSync(join(ROOT, "datasets", "README.md")));
  });
});
