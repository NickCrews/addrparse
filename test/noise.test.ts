import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  addNoise,
  applyNoise,
  fromPieces,
  NOISE_NAMES,
  NOISE_RATES,
  seededRng,
  toPieces,
  type NoiseName,
} from "../src/data/noise.ts";
import { ROOT, splitPath } from "../src/data/paths.ts";
import type { Label } from "../src/labels.ts";
import type { Example, Span } from "../src/types.ts";

/** Builds an example from [text, label] fields joined by the given separators. */
function build(fields: [string, Label][], seps: string[]): Example {
  let text = "";
  const spans: Span[] = [];
  fields.forEach(([t, label], i) => {
    if (i > 0) text += seps[i - 1] ?? " ";
    spans.push({ start: text.length, end: text.length + t.length, label });
    text += t;
  });
  return { id: text, text, spans, source: "test" };
}

const kenai = build(
  [
    ["123", "AddressNumber"],
    ["N", "StreetNamePreDirectional"],
    ["Main", "StreetName"],
    ["St", "StreetNamePostType"],
    ["Apt", "OccupancyType"],
    ["4B", "OccupancyIdentifier"],
    ["Kenai", "PlaceName"],
    ["AK", "StateName"],
    ["99611", "ZipCode"],
  ],
  [" ", " ", " ", ", ", " ", ", ", ", ", " "],
);

const fields = (ex: { text: string; spans: Span[] }) =>
  ex.spans.map((s) => [ex.text.slice(s.start, s.end), s.label]);

function noised(ex: Example, name: NoiseName, seed = "x") {
  const out = applyNoise(ex, name, seededRng(seed));
  assert.ok(out, `${name} did not apply`);
  return out;
}

describe("transforms", () => {
  it("unit-first moves the unit before the house number", () => {
    const out = noised(kenai, "unit-first");
    assert.match(out.text, /^Apt 4B,? 123 N Main St, Kenai, AK 99611$/);
    assert.deepEqual(fields(out).slice(0, 3), [
      ["Apt", "OccupancyType"],
      ["4B", "OccupancyIdentifier"],
      ["123", "AddressNumber"],
    ]);
  });

  it("unit-joined removes the space between unit type and number", () => {
    const ex = build(
      [
        ["9", "AddressNumber"],
        ["Elm", "StreetName"],
        ["#", "OccupancyType"],
        ["4", "OccupancyIdentifier"],
      ],
      [" ", " ", " "],
    );
    const out = noised(ex, "unit-joined");
    assert.equal(out.text, "9 Elm #4");
    assert.deepEqual(fields(out).slice(2), [
      ["#", "OccupancyType"],
      ["4", "OccupancyIdentifier"],
    ]);
  });

  it("unit-joined skips a letter type before a letter identifier", () => {
    assert.equal(
      applyNoise(kenai, "unit-joined", seededRng("x"))?.text,
      "123 N Main St, Apt4B, Kenai, AK 99611",
    );
    const ex = build(
      [
        ["Apt", "OccupancyType"],
        ["B", "OccupancyIdentifier"],
      ],
      [" "],
    );
    assert.equal(applyNoise(ex, "unit-joined", seededRng("x")), undefined);
  });

  it("drop-zip and drop-state remove the field and its separator", () => {
    assert.equal(noised(kenai, "drop-zip").text, "123 N Main St, Apt 4B, Kenai, AK");
    assert.equal(noised(kenai, "drop-state").text, "123 N Main St, Apt 4B, Kenai 99611");
  });

  it("drop never removes the only span", () => {
    const zip = build([["99611", "ZipCode"]], []);
    assert.equal(applyNoise(zip, "drop-zip", seededRng("x")), undefined);
  });

  it("zip-before-state swaps adjacent state and ZIP", () => {
    assert.equal(noised(kenai, "zip-before-state").text, "123 N Main St, Apt 4B, Kenai, 99611 AK");
  });

  it("newline breaks the line before the city", () => {
    assert.equal(noised(kenai, "newline").text, "123 N Main St, Apt 4B\nKenai, AK 99611");
  });

  it("extra-punct adds periods inside abbreviation spans", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const out = noised(kenai, "extra-punct", seed);
      const dotted = fields(out).filter(([t]) => t!.endsWith("."));
      assert.ok(dotted.length > 0);
      for (const [t] of dotted) assert.ok(["N.", "St.", "Apt."].includes(t!), `${t}`);
    }
  });

  it("extra-punct leaves whole words alone", () => {
    const ex = build(
      [
        ["12", "AddressNumber"],
        ["West", "StreetNamePreDirectional"],
        ["Elm", "StreetName"],
        ["Road", "StreetNamePostType"],
        ["Way", "StreetNamePostType"],
      ],
      [" ", " ", " ", " "],
    );
    assert.equal(applyNoise(ex, "extra-punct", seededRng("x")), undefined);
  });

  it("lowercase and uppercase change case only", () => {
    assert.equal(noised(kenai, "lowercase").text, kenai.text.toLowerCase());
    assert.equal(noised(kenai, "uppercase").text, kenai.text.toUpperCase());
    const caps = build([["MAIN", "StreetName"]], []);
    assert.equal(applyNoise(caps, "uppercase", seededRng("x")), undefined);
  });

  it("recase keeps spans exact when a character changes length", () => {
    // "ß".toUpperCase() is "SS".
    const ex = build(
      [
        ["Straße", "StreetName"],
        ["Kenai", "PlaceName"],
      ],
      [", "],
    );
    assert.deepEqual(fields(noised(ex, "uppercase")), [
      ["STRASSE", "StreetName"],
      ["KENAI", "PlaceName"],
    ]);
  });
});

describe("fromPieces", () => {
  it("round-trips toPieces", () => {
    assert.deepEqual(fromPieces(toPieces(kenai.text, kenai.spans)), {
      text: kenai.text,
      spans: kenai.spans,
    });
  });

  it("keeps same-label neighbours as separate spans", () => {
    const out = fromPieces([
      { text: "" },
      { text: "Basement", label: "OccupancyType" },
      { text: " " },
      { text: "Lot", label: "OccupancyType" },
      { text: "" },
    ]);
    assert.deepEqual(out.spans, [
      { start: 0, end: 8, label: "OccupancyType" },
      { start: 9, end: 12, label: "OccupancyType" },
    ]);
  });
});

// Property test over random addresses: whatever noise is applied, every span covers exactly the
// text its label claims and every character outside spans is a separator.

const WORDS: Partial<Record<Label, string[]>> = {
  AddressNumber: ["1", "123", "4500", "12A"],
  StreetNamePreDirectional: ["N", "SW", "North"],
  StreetName: ["Main", "Martin Luther King", "Elm", "Straße", "O'Malley"],
  StreetNamePostType: ["St", "Avenue", "Rd", "Blvd"],
  StreetNamePostDirectional: ["NE", "W"],
  OccupancyType: ["Apt", "#", "Unit", "Apt #", "Suite", "Floor"],
  OccupancyIdentifier: ["4", "4B", "B", "201"],
  USPSBoxType: ["PO Box"],
  USPSBoxID: ["77"],
  PlaceName: ["Kenai", "Mount Vernon", "St. Louis", "Anchorage"],
  StateName: ["AK", "Alaska", "N.J"],
  ZipCode: ["99611", "99501-1234"],
  CountryName: ["USA"],
};
const ORDER: Label[][] = [
  [
    "AddressNumber",
    "StreetNamePreDirectional",
    "StreetName",
    "StreetNamePostType",
    "StreetNamePostDirectional",
  ],
  ["OccupancyType", "OccupancyIdentifier"],
  // A second unit-type field, e.g. "Basement Lot": same-label spans that must stay separate.
  ["OccupancyType"],
  ["USPSBoxType", "USPSBoxID"],
  ["PlaceName"],
  ["StateName"],
  ["ZipCode"],
  ["CountryName"],
];

function randomExample(rng: () => number, n: number): Example {
  const parts: [string, Label][] = [];
  const seps: string[] = [];
  const fieldSep = rng() < 0.6 ? ", " : " ";
  for (const group of ORDER) {
    if (rng() < 0.3) continue;
    let first = true;
    for (const label of group) {
      if (rng() < 0.25) continue;
      const opts = WORDS[label]!;
      if (parts.length) seps.push(first ? fieldSep : " ");
      parts.push([opts[Math.floor(rng() * opts.length)]!, label]);
      first = false;
    }
  }
  if (parts.length === 0) parts.push(["Kenai", "PlaceName"]);
  return { ...build(parts, seps), id: String(n) };
}

function checkInvariants(ex: Example) {
  const { text, spans } = ex;
  spans.forEach((s, i) => {
    assert.ok(s.start < s.end, `empty span in ${JSON.stringify(text)}`);
    assert.ok(s.start >= 0 && s.end <= text.length);
    if (i > 0) assert.ok(spans[i - 1]!.end <= s.start, `overlap in ${JSON.stringify(text)}`);
    const t = text.slice(s.start, s.end);
    assert.equal(t, t.trim(), `span has edge whitespace in ${JSON.stringify(text)}`);
  });
  let at = 0;
  for (const s of [...spans, { start: text.length, end: text.length }]) {
    assert.match(text.slice(at, s.start), /^[\s,]*$/, `unlabeled text in ${JSON.stringify(text)}`);
    at = s.end;
  }
}

/** Multiset of [label, text] after an optional per-span mapping. */
const bag = (ex: { text: string; spans: Span[] }, f = (s: string) => s) =>
  fields(ex)
    .map(([t, l]) => `${l}\t${f(t!)}`)
    .sort();

/**
 * Clean examples from the built dev split, or from the committed fixture when there is no built
 * data (CI), so real shapes are covered too.
 */
function devExamples(n: number): Example[] {
  const path = existsSync(splitPath("dev"))
    ? splitPath("dev")
    : join(ROOT, "test/fixtures/data/dev.jsonl");
  const lines = readFileSync(path, "utf8").split("\n", n * 2);
  return lines
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Example)
    .filter((ex) => !ex.noise)
    .slice(0, n);
}

describe("noise property", () => {
  const rng = seededRng("property");
  const real = devExamples(3000);
  const examples = [...Array.from({ length: 3000 }, (_, n) => randomExample(rng, n)), ...real];

  for (const name of NOISE_NAMES) {
    it(`${name} keeps every span on exactly its text`, () => {
      let applied = 0;
      for (const ex of examples) {
        checkInvariants(ex);
        const out = applyNoise(ex, name, seededRng(ex.id));
        if (!out) continue;
        applied++;
        checkInvariants({ ...ex, ...out });
        const before = bag(ex);
        const after = bag(out);
        switch (name) {
          case "unit-first": {
            assert.deepEqual(after, before);
            const labels = out.spans.map((s) => s.label);
            const unit = labels.findIndex((l) => l.startsWith("Occupancy"));
            assert.ok(unit >= 0 && unit < labels.indexOf("AddressNumber"));
            const rest = (ls: Label[]) => ls.filter((l) => !l.startsWith("Occupancy"));
            assert.deepEqual(rest(labels), rest(ex.spans.map((s) => s.label)));
            break;
          }
          case "zip-before-state": {
            assert.deepEqual(after, before);
            const labels = out.spans.map((s) => s.label);
            assert.equal(labels[labels.indexOf("ZipCode") + 1], "StateName");
            break;
          }
          case "newline":
            assert.deepEqual(after, before);
            assert.equal((out.text.match(/\n/g) ?? []).length, 1);
            assert.deepEqual(
              out.spans.map((s) => s.label),
              ex.spans.map((s) => s.label),
            );
            break;
          case "unit-joined":
            assert.deepEqual(after, before);
            assert.equal(out.text.replace(/\s/g, ""), ex.text.replace(/\s/g, ""));
            break;
          case "drop-zip":
          case "drop-state": {
            const label = name === "drop-zip" ? "ZipCode" : "StateName";
            assert.deepEqual(
              after,
              before.filter((k) => !k.startsWith(`${label}\t`)),
            );
            break;
          }
          case "extra-punct": {
            // Each span is unchanged or gains one trailing period.
            assert.equal(out.spans.length, ex.spans.length);
            const pairs = ex.spans.map((s, i) => {
              const o = out.spans[i]!;
              assert.equal(o.label, s.label);
              return [ex.text.slice(s.start, s.end), out.text.slice(o.start, o.end)];
            });
            assert.ok(pairs.every(([b, a]) => a === b || a === `${b}.`));
            assert.ok(pairs.some(([b, a]) => a !== b));
            break;
          }
          case "lowercase":
            assert.deepEqual(
              after,
              bag(ex, (t) => t.toLowerCase()),
            );
            break;
          case "uppercase":
            assert.deepEqual(
              after,
              bag(ex, (t) => t.toUpperCase()),
            );
            break;
          case "typo": {
            const changed = ex.spans.filter((s, i) => {
              const o = out.spans[i]!;
              return (
                s.label !== o.label ||
                ex.text.slice(s.start, s.end) !== out.text.slice(o.start, o.end)
              );
            });
            assert.equal(out.spans.length, ex.spans.length);
            assert.equal(changed.length, 1);
            assert.ok(Math.abs(out.text.length - ex.text.length) <= 1);
            break;
          }
        }
      }
      assert.ok(applied > 50, `${name} applied to only ${applied} examples`);
    });
  }

  it("addNoise at full rates keeps spans valid and records each transform", () => {
    const all = Object.fromEntries(NOISE_NAMES.map((n) => [n, 1])) as Record<NoiseName, number>;
    for (const ex of examples) {
      const out = addNoise(ex, seededRng(ex.id), all);
      checkInvariants(out);
      assert.ok(!(out.noise?.includes("lowercase") && out.noise.includes("uppercase")));
      if (!out.noise) assert.equal(out, ex);
    }
  });

  it("addNoise at default rates leaves most real examples clean", () => {
    const clean = real.filter((ex) => !addNoise(ex, seededRng(ex.id), NOISE_RATES).noise);
    assert.ok(clean.length / real.length > 0.7);
  });

  it("is deterministic for a given seed", () => {
    for (const ex of examples.slice(0, 200)) {
      assert.deepEqual(addNoise(ex, seededRng(ex.id)), addNoise(ex, seededRng(ex.id)));
    }
  });
});
