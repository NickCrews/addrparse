/**
 * Writes the generated sections of README.md from a saved run: the training data by dataset, and
 * the training mix and test accuracy by dimension (`src/eval/dimensions.ts`). Each section sits
 * between `<!-- <name>:start -->` and `<!-- <name>:end -->` markers; the rest of the README is
 * hand-written.
 *
 *   pnpm readme [--run <ref>] [--check]
 *
 * The run defaults to the latest `crf` run of the full suite on the test split with the default
 * training blend, as CONTRIBUTING.md has a release scored. `--check` exits 1 if README.md is out
 * of date instead of writing it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ROOT } from "../src/data/paths.ts";
import { dimension, orderedValues } from "../src/eval/dimensions.ts";
import { findRun, loadRuns, trainBlendOf, type RunResult } from "../src/eval/results.ts";
import { sliceName } from "../src/eval/slices.ts";
import { wilson } from "../src/eval/stats.ts";

export const README_PATH = join(ROOT, "README.md");

/** What each dataset is and an example of it, for the dataset table. */
export const DATASET_NOTES: Record<string, { about: string; example: string }> = {
  openaddresses: {
    about: "libpostal: OpenAddresses government data",
    example: "123 Main St, Springfield, IL 62704",
  },
  osm: {
    about: "libpostal: OpenStreetMap addresses",
    example: "45 Oak Ave Apt 2, Portland, OR 97214",
  },
  ways: {
    about: "libpostal: OpenStreetMap street and its place",
    example: "Sled Ct, Palm Coast, Florida",
  },
  places: {
    about: "libpostal: OpenStreetMap place names",
    example: "Willistown, Chester County, PA",
  },
  "ak-voterfile": {
    about: "Alaska voter file, hand- and rule-labeled",
    example: "HOUSE #6, KASIGLUK, AK 99609",
  },
  "ak-apoc": {
    about: "Alaska campaign finance, rule- and hand-labeled",
    example: "3705 Arctic, PMB 1579, Anchorage, Alaska",
  },
  embedded: {
    about: "synthetic: an address inside other text",
    example: "Mail to 12 Main St, thanks",
  },
  junk: { about: "synthetic: text with no address", example: "N/A; same as above; 555-0123" },
  "po-box": { about: "synthetic", example: "PO Box 123, P.O. Box, POB, Drawer" },
  "rural-route": { about: "synthetic", example: "RR 2 Box 123, Rural Route 2, RFD 3" },
  milepost: { about: "synthetic", example: "Mile 14.5 Parks Hwy, MP 82 Sterling Hwy" },
  "highway-contract": { about: "synthetic", example: "HC 60 Box 4321, HCR 1 Box 45" },
  "general-delivery": { about: "synthetic", example: "General Delivery, Kenai, AK 99611" },
  military: { about: "synthetic", example: "PSC 1234, Box 5678, APO AE 09204" },
};

/** Dimensions in the README; the website has them all. */
const README_DIMENSIONS = ["kind", "error", "extra", "region"];

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

/** A markdown table padded the way oxfmt formats one, so `pnpm fmt` leaves it unchanged. */
export function markdownTable(head: string[], rows: string[][], align: ("l" | "r")[]): string {
  const width = head.map((h, i) => Math.max(3, h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => (align[i] === "r" ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join(" | ")} |`;
  const rule = `| ${width.map((w, i) => (align[i] === "r" ? "-".repeat(w - 1) + ":" : "-".repeat(w))).join(" | ")} |`;
  return [line(head), rule, ...rows.map(line)].join("\n");
}

/** "99.3% (99.1–99.5)", or a dash without examples. */
function exactWithInterval(run: RunResult, slice: string): string {
  const s = run.metrics.accuracy?.slices[slice];
  if (!s) return "–";
  const [lo, hi] = wilson(s.exactMatch, s.examples);
  return `${pct(s.exactMatch)} (${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)})`;
}

function requireMix(run: RunResult) {
  const mix = run.data.trainMix;
  if (!mix) throw new Error(`${run.runId} has no training mix; rerun it with \`pnpm eval\``);
  return mix;
}

function datasetSection(run: RunResult): string {
  const mix = requireMix(run);
  const counts = mix.counts.source ?? {};
  const names = Object.keys(counts).sort((a, b) => counts[b]! - counts[a]!);
  const missing = names.filter((n) => !DATASET_NOTES[n]);
  if (missing.length)
    throw new Error(`add ${missing.join(", ")} to DATASET_NOTES in docs/readme.ts`);
  const rows = names.map((n) => [
    `\`${n}\``,
    pct(counts[n]! / mix.examples),
    int(counts[n]!),
    exactWithInterval(run, sliceName("source", n)),
    DATASET_NOTES[n]!.about,
    DATASET_NOTES[n]!.example,
  ]);
  rows.push(["**total**", "100%", `**${int(mix.examples)}**`, "", "", ""]);
  return markdownTable(
    [
      "dataset",
      "share",
      "training examples",
      `${run.config.split} exact match`,
      "source",
      "example",
    ],
    rows,
    ["l", "r", "r", "r", "l", "l"],
  );
}

function breakdownSection(run: RunResult): string {
  const mix = requireMix(run);
  const n = run.config.evalExamples;
  const parts = [
    [
      `Training share is the share of the ${int(mix.examples)} training examples with that value.`,
      `Exact match is on ${int(n)} held-out ${run.config.split} examples, with a 95% interval;`,
      "a wide interval means there are too few examples to say more.",
      `\`pnpm slices ${run.runId} --by <dimension>\` reproduces each table.`,
    ].join("\n"),
  ];
  for (const name of README_DIMENSIONS) {
    const d = dimension(name);
    const counts = mix.counts[d.name] ?? {};
    const values = orderedValues(d, counts);
    const rows = values.map((v) => {
      const s = run.metrics.accuracy?.slices[sliceName(d.name, v)];
      return [
        `\`${v}\``,
        d.notes?.[v] ?? "",
        pct((counts[v] ?? 0) / mix.examples),
        s ? int(s.examples) : "0",
        exactWithInterval(run, sliceName(d.name, v)),
      ];
    });
    parts.push(
      `**${d.title}** (\`${d.name}\`${d.exclusive ? "" : "; an example can have several, so shares add up to more than 100%"}):`,
      markdownTable(["value", "meaning", "training share", "test examples", "exact match"], rows, [
        "l",
        "l",
        "r",
        "r",
        "r",
      ]),
    );
  }
  return parts.join("\n\n");
}

const SECTIONS: Record<string, (run: RunResult) => string> = {
  datasets: datasetSection,
  breakdown: breakdownSection,
};

/** `readme` with each generated section replaced; throws if a section's markers are missing. */
export function renderReadme(readme: string, run: RunResult): string {
  let out = readme;
  for (const [name, render] of Object.entries(SECTIONS)) {
    const re = new RegExp(`<!-- ${name}:start[^>]*-->[\\s\\S]*?<!-- ${name}:end -->`);
    if (!re.test(out)) throw new Error(`README.md has no <!-- ${name}:start --> section`);
    const start = `<!-- ${name}:start: generated by pnpm readme from ${run.runId} -->`;
    out = out.replace(re, () => `${start}\n\n${render(run)}\n\n<!-- ${name}:end -->`);
  }
  return out;
}

/** The latest crf full-suite test run on the default blend, as a release is scored. */
export function releaseRun(): RunResult {
  const run = loadRuns()
    .filter(
      (r) =>
        r.impl === "crf" &&
        r.suite === "full" &&
        r.config.split === "test" &&
        trainBlendOf(r) === "default" &&
        r.data.trainMix,
    )
    .at(-1);
  if (!run) {
    throw new Error(
      "no crf full test run with a training mix; run `pnpm eval crf --suite full --split test`",
    );
  }
  return run;
}

if (import.meta.main) {
  const { values: opts } = parseArgs({
    options: { run: { type: "string" }, check: { type: "boolean", default: false } },
  });
  const run = opts.run ? findRun(opts.run) : releaseRun();
  const before = readFileSync(README_PATH, "utf8");
  const after = renderReadme(before, run);
  if (opts.check) {
    if (before !== after) {
      console.error(`README.md is out of date with ${run.runId}; run \`pnpm readme\``);
      process.exit(1);
    }
    console.log(`README.md is up to date with ${run.runId}`);
  } else {
    writeFileSync(README_PATH, after);
    console.log(`README.md: generated sections from ${run.runId}`);
  }
}
