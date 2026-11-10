/**
 * Builds the user documentation as one self-contained HTML file: prose, tables from the run
 * files and data/stats.json, and a playground that parses with the trained models embedded in
 * the page.
 *
 *   pnpm docs [--suite full] [--out docs/dist/index.html]
 *
 * Models come from the eval harness's cache (src/eval/models.ts) for the suite's training size
 * and seed, and are trained first when missing, so the page is reproducible from this command.
 * Metrics are the latest run of each impl for the suite on the dev split. Playground rows are
 * handpicked (docs/examples.ts) or from the dev split, never test.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { SUITES, type SuiteName } from "../eval.config.ts";
import { defaultWeights, hashSplit, loadExamples } from "../src/data/load.ts";
import { DATA_STATS_PATH, ROOT } from "../src/data/paths.ts";
import { mixOfSplit } from "../src/eval/dimensions.ts";
import { implSourceHash, listImpls } from "../src/eval/impl.ts";
import { ensureModel, gitInfo } from "../src/eval/models.ts";
import { loadRuns, trainBlendOf, type RunResult } from "../src/eval/results.ts";
import { LABEL_NAMES } from "../src/labels.ts";
import { asScoredParse, type ScoredParse, type Span } from "../src/types.ts";
import { readAttribution } from "./attribution.ts";
import { pickDemo } from "./demo.ts";
import { TOPICS } from "./examples.ts";
import type { PageData } from "./page-data.ts";
import { renderPage, type DataStats, type PageContext } from "./page.ts";
import { LOADERS } from "./parsers.ts";

/** Impls the page leaves out; noop is the harness's floor, not a parser. */
const SKIP = new Set(["noop"]);

const { values: opts } = parseArgs({
  options: {
    suite: { type: "string", default: "full" },
    out: { type: "string", default: join(ROOT, "docs", "dist", "index.html") },
  },
});
if (!(opts.suite! in SUITES)) throw new Error(`unknown suite ${opts.suite}`);
const suite = opts.suite as SuiteName;
const config = SUITES[suite];
const log = (m: string) => process.stderr.write(m + "\n");

// Runs: the latest dev run of each impl for this suite.
const impls = listImpls().filter((i) => !SKIP.has(i));
const latest = new Map<string, RunResult>();
for (const r of loadRuns()) {
  if (
    r.suite === suite &&
    r.config.split === "dev" &&
    impls.includes(r.impl) &&
    trainBlendOf(r) === "default"
  )
    latest.set(r.impl, r);
}

// Eval set: always dev, never test.
const examples = await loadExamples("dev", config.evalExamples);
const evalHash = await hashSplit("dev", config.evalExamples);

const runNotes: Record<string, string[]> = {};
const note = (impl: string, s: string) => (runNotes[impl] ??= []).push(s);

// Models that run in the page: train or reuse the harness's cached model, then parse the eval set.
/** Parses of the dev eval set by each in-page model; the playground uses the first. */
const predictions: { impl: string; spans: Span[][] }[] = [];
const embedded: PageData["embedded"] = [];
const embeddedSizes: PageContext["embedded"] = {};
const parsers: Record<string, (text: string) => ScoredParse> = {};
for (const impl of Object.keys(LOADERS)) {
  if (!impls.includes(impl)) continue;
  log(`${impl}: model for ${suite} (${config.trainExamples} examples, seed ${config.seed})`);
  const implHash = implSourceHash(impl);
  const m = await ensureModel({
    impl,
    implHash,
    n: config.trainExamples,
    seed: config.seed,
    weights: defaultWeights(),
    log,
  });
  const bytes = readFileSync(m.model);
  const gz = gzipSync(bytes, { level: 9 });
  embedded.push({ impl, gzipBase64: gz.toString("base64") });
  embeddedSizes[impl] = { bytes: bytes.byteLength, gzipBytes: gz.byteLength };
  const parser = LOADERS[impl]!(new Uint8Array(bytes));
  parsers[impl] = (t) => asScoredParse(parser.parse(t));
  predictions.push({
    impl,
    spans: examples.map((ex) => parsers[impl]!(ex.text).spans),
  });
  const run = latest.get(impl);
  if (run && (run.implHash !== implHash || run.data.trainHash !== m.trainHash)) {
    note(impl, "run is of a different model than the one embedded");
  }
}

for (const [impl, run] of latest) {
  if (run.data.evalHash !== evalHash)
    note(impl, "scored on a different dev set than the current one");
}

// Display order: trained impls by exact match, then references by exact match.
const exactOf = (r: RunResult) => r.metrics.accuracy?.exactMatch ?? 0;
const runs = [...latest.values()].sort(
  (a, b) =>
    Number(!!a.metrics.reference) - Number(!!b.metrics.reference) || exactOf(b) - exactOf(a),
);
const shown = predictions[0];
if (!shown) throw new Error(`no in-page model among ${impls.join(", ")}`);
const demo = pickDemo(
  examples,
  shown.spans,
  shown.impl,
  (t) => parsers[shown.impl]!(t).spans,
  TOPICS,
  config.seed,
);
log(`demo: ${demo.sets.length} sets, ${Object.keys(demo.rows).length} rows`);

const stats = existsSync(DATA_STATS_PATH)
  ? (JSON.parse(readFileSync(DATA_STATS_PATH, "utf8")) as DataStats)
  : undefined;

// The training mix of the embedded models: the suite's training prefix of the default blend.
const trainMix = await mixOfSplit("train", config.trainExamples, defaultWeights());

const git = gitInfo();
const ctx: PageContext = {
  suite,
  seed: config.seed,
  trainExamples: config.trainExamples,
  evalExamples: config.evalExamples,
  runs,
  missingRuns: impls.filter((i) => !latest.has(i)),
  runNotes,
  embedded: embeddedSizes,
  stats,
  trainMix,
  attribution: readAttribution(),
  demo: { sets: demo.sets.length, rows: Object.keys(demo.rows).length },
  generated: {
    at: new Date().toISOString().slice(0, 10),
    git: git.sha ? git.sha.slice(0, 7) + (git.dirty ? "+dirty" : "") : "unknown",
  },
};

const pageData: PageData = { labels: LABEL_NAMES, embedded, demo };

const bundled = await build({
  entryPoints: [join(ROOT, "docs", "app.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  logLevel: "silent",
});
const js = bundled.outputFiles[0]!.text.replaceAll("</script", "<\\/script");
const css = readFileSync(join(ROOT, "docs", "style.css"), "utf8");
const data = JSON.stringify(pageData).replaceAll("<", "\\u003c");

const out = resolve(opts.out!);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderPage(ctx, { css, js, data }));
const size = readFileSync(out).byteLength;
log(`wrote ${out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
