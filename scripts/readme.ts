/**
 * Fills the numbers in README.md from a committed run, so they describe the published model.
 *
 *   pnpm readme                 # rewrite README.md's numbers from results/readme.json
 *   pnpm readme --pin <runId>   # point results/readme.json at a run, then rewrite README.md
 *
 * Each number in README.md sits between `<!-- gen:<name> -->` and `<!-- /gen -->`; VALUES below
 * defines the names. Edit the prose around a marker in README.md, and the number's format here.
 *
 * `--pin` takes a full-suite crf run on the test split at a clean commit
 * (`pnpm eval crf --suite full --split test`). It needs the built data and the run's cached
 * model, and records what the run doesn't hold: the model's sha256, the gzipped size of the
 * package built from it, and the training examples per dataset.
 *
 * `readmeProblems()` is what test/readme.test.ts and `pnpm package --suite full` check: README.md
 * is what this script would write, and the pinned run used the current crf code and data inputs.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { DATASET_WEIGHTS, SUITES } from "../eval.config.ts";
import { bundlePackage } from "../package/bundle.ts";
import { listDatasets } from "../src/data/datasets.ts";
import { defaultWeights, hashSplit, readManifest } from "../src/data/load.ts";
import { mixOrder } from "../src/data/mix.ts";
import { MODELS_DIR, RESULTS_DIR, ROOT, RUNS_DIR } from "../src/data/paths.ts";
import { implSourceHash } from "../src/eval/impl.ts";
import { sha256 } from "../src/eval/models.ts";
import type { RunResult } from "../src/eval/results.ts";

export const README_PATH = join(ROOT, "README.md");
export const PIN_PATH = join(RESULTS_DIR, "readme.json");
const IMPL = "crf";
const SUITE = SUITES.full;

/** results/readme.json: the run README.md quotes, and what `--pin` measured alongside it. */
export interface ReadmePin {
  /** A run id in results/runs/. */
  run: string;
  /** `implSourceHash("crf")` when pinned; equals the run's. */
  implHash: string;
  /** `dataInputsHash()` when pinned. */
  inputsHash: string;
  /** sha256 of the run's model, which `pnpm package --suite full` must embed. */
  modelSha256: string;
  /** index.js of the package built with the run's model, gzipped. */
  packageGzipBytes: number;
  /** Examples per dataset in the run's training set. */
  trainExamples: Record<string, number>;
}

/** The source and an example of each dataset, for the README's datasets table. */
const DATASET_DOCS: Record<string, { source: string; example: string }> = {
  openaddresses: {
    source: "libpostal: OpenAddresses government data",
    example: "123 Main St, Springfield, IL 62704",
  },
  osm: {
    source: "libpostal: OpenStreetMap addresses",
    example: "45 Oak Ave Apt 2, Portland, OR 97214",
  },
  ways: {
    source: "libpostal: OpenStreetMap street and its place",
    example: "Sled Ct, Palm Coast, Florida",
  },
  places: {
    source: "libpostal: OpenStreetMap place names",
    example: "Willistown, Chester County, PA",
  },
  "ak-voterfile": {
    source: "Alaska voter file, hand- and rule-labeled",
    example: "HOUSE #6, KASIGLUK, AK 99609",
  },
  "ak-apoc": {
    source: "Alaska campaign finance, rule- and hand-labeled",
    example: "3705 Arctic, PMB 1579, Anchorage, Alaska",
  },
  embedded: {
    source: "synthetic: an address inside other text",
    example: "Mail to 12 Main St, thanks",
  },
  junk: { source: "synthetic: text with no address", example: "N/A; same as above; 555-0123" },
  "po-box": { source: "synthetic", example: "PO Box 123, P.O. Box, POB, Drawer" },
  "rural-route": { source: "synthetic", example: "RR 2 Box 123, Rural Route 2, RFD 3" },
  milepost: { source: "synthetic", example: "Mile 14.5 Parks Hwy, MP 82 Sterling Hwy" },
  "highway-contract": { source: "synthetic", example: "HC 60 Box 4321, HCR 1 Box 45" },
  "general-delivery": { source: "synthetic", example: "General Delivery, Kenai, AK 99611" },
  military: { source: "synthetic", example: "PSC 1234, Box 5678, APO AE 09204" },
};

interface Context {
  pin: ReadmePin;
  run: RunResult;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const count = (v: number) => v.toLocaleString("en-US");

function accuracy(run: RunResult) {
  const a = run.metrics.accuracy;
  if (!a) throw new Error(`run ${run.runId} has no accuracy metrics`);
  return a;
}

/** Each README marker's text. */
const VALUES: Record<string, (c: Context) => string> = {
  "exact-match": ({ run }) => pct(accuracy(run).exactMatch),
  "token-accuracy": ({ run }) => pct(accuracy(run).tokenAccuracy),
  "exact-at-90": ({ run }) => {
    const p = accuracy(run).riskCoverage?.exactAtCoverage.find((p) => p.coverage === 0.9);
    if (!p) throw new Error(`run ${run.runId} has no exact match at 90% coverage`);
    return pct(p.exactMatch);
  },
  "typo-exact-match": ({ run }) => {
    const s = accuracy(run).slices["noise=typo"];
    if (!s) throw new Error(`run ${run.runId} has no noise=typo slice`);
    return pct(s.exactMatch);
  },
  "package-gzip": ({ pin }) => `${Math.round(pin.packageGzipBytes / 1024)} KB`,
  throughput: ({ run }) => {
    const t = run.metrics.throughput?.["1"];
    if (!t) throw new Error(`run ${run.runId} has no 1-thread throughput`);
    return `${Math.round(t.callsPerSec / 1000)}k`;
  },
  "load-ms": ({ run }) => {
    const m = run.metrics.memory;
    if (!m) throw new Error(`run ${run.runId} has no memory metrics`);
    return `${Math.max(1, Math.round(m.loadMs))} ms`;
  },
  "eval-examples": ({ run }) => count(run.config.evalExamples),
  machine: ({ run }) => `${run.machine.cores}-core ${run.machine.cpu}, Node ${run.machine.node}`,
  run: ({ run }) => `\`${run.runId}\``,
  "train-examples": ({ run }) => count(run.config.trainExamples),
  datasets: ({ pin }) => `\n\n${datasetsTable(pin.trainExamples)}\n\n`,
};

/** Datasets with real addresses first, then the synthetic address forms, each by size. */
function datasetsTable(examples: Record<string, number>): string {
  const synthetic = new Set(
    listDatasets()
      .filter((d) => d.kind === "generated")
      .map((d) => d.name),
  );
  const total = Object.values(examples).reduce((a, b) => a + b, 0);
  const names = Object.keys(examples).sort(
    (a, b) =>
      Number(synthetic.has(a)) - Number(synthetic.has(b)) ||
      examples[b]! - examples[a]! ||
      a.localeCompare(b),
  );
  const rows = names.map((name) => {
    const docs = DATASET_DOCS[name];
    if (!docs) throw new Error(`add dataset ${name} to DATASET_DOCS in scripts/readme.ts`);
    const n = examples[name]!;
    return [
      `\`${name}\``,
      `${((n / total) * 100).toFixed(1)}%`,
      count(n),
      docs.source,
      docs.example,
    ];
  });
  return markdownTable(
    ["dataset", "share", "training examples", "source", "example"],
    ["left", "right", "right", "left", "left"],
    [...rows, ["**total**", "100%", `**${count(total)}**`, "", ""]],
  );
}

/** A table padded the way oxfmt formats one. */
function markdownTable(header: string[], align: ("left" | "right")[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(3, ...all.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => (align[i] === "right" ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join(" | ")} |`;
  const rule = `| ${widths.map((w, i) => (align[i] === "right" ? "-".repeat(w - 1) + ":" : "-".repeat(w))).join(" | ")} |`;
  return [line(header), rule, ...rows.map(line)].join("\n");
}

const MARKER = /<!-- gen:([a-z0-9-]+) -->([\s\S]*?)<!-- \/gen -->/g;

/** `text` with each marker's contents replaced by its value. */
export function render(text: string, values: Record<string, () => string>): string {
  return text.replace(MARKER, (_, name: string) => {
    const value = values[name];
    if (!value) throw new Error(`README.md: unknown marker gen:${name}`);
    return `<!-- gen:${name} -->${value()}<!-- /gen -->`;
  });
}

/** README.md without its markers, for the npm package. */
export const stripMarkers = (text: string) =>
  text.replace(MARKER, (_, _name: string, value: string) => value);

/**
 * Hash of the committed inputs to the training data that `implSourceHash` doesn't cover:
 * datasets/, overrides/, the dataset weights, and the full suite's size and seed.
 */
export function dataInputsHash(): string {
  const h = createHash("sha256");
  for (const dir of ["datasets", "overrides"]) {
    const files = readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .map((f) => join(ROOT, dir, f))
      .filter((p) => /\.(ts|jsonl)$/.test(p))
      .sort();
    for (const p of files) h.update(relative(ROOT, p)).update(readFileSync(p));
  }
  h.update(JSON.stringify(DATASET_WEIGHTS));
  h.update(JSON.stringify([SUITE.trainExamples, SUITE.seed]));
  return h.digest("hex").slice(0, 16);
}

export function readPin(): ReadmePin {
  return JSON.parse(readFileSync(PIN_PATH, "utf8")) as ReadmePin;
}

function readRun(id: string): RunResult {
  const path = join(RUNS_DIR, `${id}.json`);
  if (!existsSync(path)) throw new Error(`no run ${relative(ROOT, path)}`);
  return JSON.parse(readFileSync(path, "utf8")) as RunResult;
}

/** README.md as this script would write it from results/readme.json. */
export function renderReadme(text = readFileSync(README_PATH, "utf8")): string {
  const ctx = { pin: readPin(), run: readRun(readPin().run) };
  return render(
    text,
    Object.fromEntries(Object.entries(VALUES).map(([k, f]) => [k, () => f(ctx)])),
  );
}

const RERUN =
  "run `pnpm eval crf --suite full --split test`, then `pnpm readme --pin <its run id>`";

/** Why README.md's numbers may not describe the current model; empty when they do. */
export function readmeProblems(): string[] {
  const problems: string[] = [];
  const pin = readPin();
  if (pin.implHash !== implSourceHash(IMPL)) {
    problems.push(`the crf code or shared src/ changed since run ${pin.run}; ${RERUN}`);
  }
  if (pin.inputsHash !== dataInputsHash()) {
    problems.push(
      `datasets/, overrides/ or the dataset weights changed since run ${pin.run}; ` +
        `rebuild the data (\`pnpm data:build\`), then ${RERUN}`,
    );
  }
  if (renderReadme() !== readFileSync(README_PATH, "utf8")) {
    problems.push("README.md's numbers differ from results/readme.json; run `pnpm readme`");
  }
  return problems;
}

/** Checks `id` is a run README.md can quote and measures what it needs beyond the run. */
async function pin(id: string): Promise<ReadmePin> {
  const run = readRun(id);
  const fail = (why: string) => {
    throw new Error(`run ${id} ${why}`);
  };
  if (run.impl !== IMPL) fail(`is of ${run.impl}, not ${IMPL}`);
  if (run.suite !== "full" || run.config.split !== "test")
    fail("is not on the full suite's test split");
  if (run.data.trainBlend) fail(`trained on blend ${run.data.trainBlend}, not the default`);
  if (!run.git.sha || run.git.dirty) fail("was made with uncommitted changes");
  if (run.implHash !== implSourceHash(IMPL)) fail("used other crf code or shared src/ than now");

  const weights = defaultWeights();
  const trainHash = await hashSplit("train", run.config.trainExamples, weights);
  if (trainHash !== run.data.trainHash) fail("trained on other data than data/ holds now");

  const key = sha256(
    [run.implHash, trainHash, run.config.seed, run.config.trainExamples].join("|"),
  );
  const modelPath = join(MODELS_DIR, IMPL, `${key.slice(0, 16)}.bin`);
  if (!existsSync(modelPath)) fail(`has no cached model at ${relative(ROOT, modelPath)}`);
  const model = readFileSync(modelPath);

  const dir = mkdtempSync(join(tmpdir(), "nerdress-readme-"));
  let packageGzipBytes: number;
  try {
    await bundlePackage(model, join(dir, "index.js"));
    packageGzipBytes = gzipSync(readFileSync(join(dir, "index.js"))).length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const manifest = readManifest();
  const names = Object.keys(weights);
  const trainExamples: Record<string, number> = {};
  let n = 0;
  for (const { source } of mixOrder(
    names.map((d) => manifest.datasets[d]!.train),
    names.map((d) => weights[d]!),
  )) {
    if (n++ >= run.config.trainExamples) break;
    trainExamples[names[source]!] = (trainExamples[names[source]!] ?? 0) + 1;
  }

  return {
    run: id,
    implHash: run.implHash,
    inputsHash: dataInputsHash(),
    modelSha256: createHash("sha256").update(model).digest("hex"),
    packageGzipBytes,
    trainExamples,
  };
}

if (import.meta.main) {
  const { values: opts } = parseArgs({ options: { pin: { type: "string" } } });
  if (opts.pin) {
    writeFileSync(PIN_PATH, JSON.stringify(await pin(opts.pin), null, 2) + "\n");
    console.log(`pinned ${opts.pin} in ${relative(ROOT, PIN_PATH)}`);
  }
  writeFileSync(README_PATH, renderReadme());
  for (const p of readmeProblems()) console.error(`warning: ${p}`);
}
