/**
 * Renders the page's static HTML at build time: the Home, Datasets, Metrics and Models tabs and the
 * playground's skeleton on Home (docs/app.ts makes it interactive). Every number comes from the run
 * files, data/stats.json or a parse made during the build.
 */
import { LABELS, LABEL_NAMES, type Label } from "../src/labels.ts";
import { TARGET_EXACT_MATCH } from "../src/eval/accuracy.ts";
import { HEADLINE, type Metric } from "../src/eval/headline.ts";
import type { RunResult } from "../src/eval/results.ts";
import { DATASET_WEIGHTS } from "../eval.config.ts";
import { esc } from "./html.ts";
import { DATASET_GROUPS, DATASET_NOTES } from "./dataset-notes.ts";
import { IMPL_NOTES } from "./impl-notes.ts";

export interface DataStats {
  libpostalSnapshot: string;
  /** What each dataset is; `description` is set for `datasets/` files that have one. */
  datasets?: Record<string, { kind: string; description?: string }>;
  limits: Record<string, number>;
  notAddress: { junkRate: number; embeddedRate: number; seed: number };
  linesRead: number;
  examples: number;
  duplicates: number;
  rejected: Record<string, number>;
  linesReadBySource: Record<string, number>;
  duplicatesBySource: Record<string, number>;
  rejectedBySource: Record<string, Record<string, number>>;
  overrides: { entries: number; stale: number; examples: number };
  bySplit: Record<string, number>;
  bySource: Record<string, number>;
  notes: Record<string, number>;
  noise: {
    rates: Record<string, number>;
    clean: number;
    collisions: number;
    applied: Record<string, number>;
  };
  labels: Record<string, number>;
}

export interface PageContext {
  suite: string;
  seed: number;
  trainExamples: number;
  evalExamples: number;
  /** Latest run per impl, in display order. */
  runs: RunResult[];
  /** Impls without a run of this suite. */
  missingRuns: string[];
  /** Per impl: why its run may not describe the embedded model or the current eval set. */
  runNotes: Record<string, string[]>;
  /** Models embedded in the page: raw and gzip bytes. */
  embedded: Record<string, { bytes: number; gzipBytes: number }>;
  stats?: DataStats;
  /** The model attribution paragraph from LICENSING.md, as plain text. */
  attribution: string;
  /** Preset sets sampled from the dev split, and the distinct texts in them. */
  demo: { sets: number; rows: number };
  generated: { at: string; git: string };
}

const REPO_URL = "https://github.com/NickCrews/nerdress";

// ---------------------------------------------------------------------------------------------
// Helpers

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`;
const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);

/** Hue of each label's highlight, set as `--h` on its `[data-label]` elements. */
const LABEL_HUES: Record<Label, number> = Object.fromEntries(
  LABEL_NAMES.map((l, i) => [
    l,
    l === "NotAddress" ? -1 : Math.round((i * 360) / (LABEL_NAMES.length - 1)),
  ]),
) as Record<Label, number>;

function table(
  head: string[],
  rows: string[][],
  opts: { align?: ("l" | "r")[]; cls?: string } = {},
): string {
  const a = (i: number) => (opts.align?.[i] === "r" ? ' class="num"' : "");
  return (
    `<div class="table-wrap"><table${opts.cls ? ` class="${opts.cls}"` : ""}>` +
    `<thead><tr>${head.map((h, i) => `<th${a(i)}>${h}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c, i) => `<td${a(i)}>${c}</td>`).join("")}</tr>`).join("") +
    `</tbody></table></div>`
  );
}

const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const code = (s: string) => `<code>${esc(s)}</code>`;
const linkify = (s: string) =>
  esc(s).replace(/https?:\/\/[^\s)]+[^\s).,]/g, (u) => `<a href="${u}">${u}</a>`);

const runOf = (ctx: PageContext, impl: string) => ctx.runs.find((r) => r.impl === impl);
const isReference = (r: RunResult) => !!r.metrics.reference;
const metric = (name: string) => HEADLINE.find((m) => m.name === name)!;
const fmt = (m: Metric, r: RunResult | undefined) => {
  const v = r ? m.get(r) : undefined;
  return v === undefined ? "–" : m.format(v);
};

// ---------------------------------------------------------------------------------------------
// Home

function home(ctx: PageContext): string {
  const labelRows = LABEL_NAMES.map((l) => {
    const [meaning, example] = LABELS[l].split(/: (?=[^:]*$)/);
    return [`<mark class="lab" data-label="${l}">${l}</mark>`, esc(meaning!), esc(example ?? "")];
  });
  const crf = runOf(ctx, "crf");
  const crfMetric = (name: string) => fmt(metric(name), crf);
  return `
<section id="tab-home" class="tab" data-tab="home">
<h1>nerdress</h1>
<p class="lede">Parse US addresses into labeled parts using pure typescript, with exceptional accurary and performance.</p>
<p>The name is NER (named-entity recognition) + address.</p>

${playground(ctx)}

<h2 id="home-goals">What</h2>
${list([
  ...(crf
    ? [
        `${crfMetric("token accuracy")} per-token accuracy, ${crfMetric("exact match")} exact match (<code>crf</code>, ${esc(crf.config.split)} split).`,
        `Run anywhere: Zero dependencies, pure typescript, ${crfMetric("model size gzip")} gzipped model size.`,
        `Performant: ${crfMetric("throughput/s 1 thread")}/sec per thread, ${crfMetric("latency p99 µs")} µs p99 latency, ${crfMetric("infer RSS over baseline")} peak memory (on ${esc(crf.machine.cpu)}).`,
      ]
    : []),
  "Say how sure each parse is, so a caller can accept confident parses and review the rest.",
  "Recognize text that is not an address and label it <code>NotAddress</code> instead of forcing a parse.",
  "Every claim backed by a saved, reproducible measurement (the Metrics tab).",
])}

<h2 id="home-labels">Labels</h2>
<p>Names follow <a href="https://github.com/datamade/usaddress">usaddress</a>, which follows the
FGDC United States Thoroughfare, Landmark, and Postal Address Data Standard.</p>
${table(["label", "meaning", "example"], labelRows, { cls: "labels" })}

<h2 id="home-usage">Usage</h2>
<p>The <code>nerdress</code> npm package is the <code>crf</code> parser with its model embedded:</p>
<pre><code>npm install nerdress</code></pre>
<pre><code>import { parse } from "nerdress";

const { spans, confidence } = parse("12 N Main St Apt 4, Springfield, IL 62701");
// spans: [{ start: 0, end: 2, label: "AddressNumber", text: "12" }, …]
// confidence: probability that the whole labeling is right, in [0, 1]</code></pre>
${list([
  "Spans are character ranges <code>[start, end)</code> of the input, sorted and non-overlapping. Text outside every span (spaces, commas) has no label.",
  "Parsing has no side effects and needs no network or file access. The model is decoded on the first call.",
  "To abstain, treat a parse as unusable when its confidence is below a threshold, or when every span is <code>NotAddress</code>. The Metrics tab shows what each threshold costs.",
])}

<h2 id="home-status">Status</h2>
${list([
  "The npm package ships only <code>crf</code>. The other parsers run from a clone of the repository.",
  "US addresses only.",
])}
</section>`;
}

// ---------------------------------------------------------------------------------------------
// Metrics

const METRIC_GROUPS: { title: string; metrics: string[]; why: string }[] = [
  {
    title: "Exact match (headline)",
    metrics: ["exact match"],
    why: "Share of addresses where every span is right. A parse with one wrong label is a wrong record downstream, so this is the number that matches what a user experiences.",
  },
  {
    title: "Partial credit",
    metrics: ["token accuracy", "span F1", "coarse exact match"],
    why: "How close the wrong parses are. Token accuracy counts words with the right label; span F1 counts spans with the right boundaries and label. Coarse exact match collapses the street, the unit and the PO box to one label each, for callers that only need those as wholes, and to compare with libpostal, whose fields are that coarse.",
  },
  {
    title: "Confidence and abstention",
    metrics: [
      "exact @ 90% coverage",
      "exact @ 80% coverage",
      "exact @ 50% coverage",
      "risk–coverage AURC",
      `coverage @ ${TARGET_EXACT_MATCH * 100}% exact`,
      "junk abstained",
      "addresses abstained",
    ],
    why: `Whether the confidence can be trusted. Sort parses by confidence and keep the top N%: exact @ N% coverage is the accuracy of what is kept. AURC averages the error rate over every cut (lower is better). Coverage @ ${TARGET_EXACT_MATCH * 100}% exact is how much can be accepted automatically at that accuracy. Junk abstained is the share of non-address text labeled entirely NotAddress; addresses abstained is the share of real addresses wrongly labeled that way.`,
  },
  {
    title: "Speed",
    metrics: [
      "latency p50 µs",
      "latency p99 µs",
      "latency µs/token",
      "throughput/s 1 thread",
      "throughput/s 4 threads",
    ],
    why: "Time per parse on one thread after warmup, and parses per second with one and four worker threads. Decides whether parsing can happen as the user types, or how long a batch job takes.",
  },
  {
    title: "Size and memory",
    metrics: [
      "model size",
      "model size gzip",
      "bundle size",
      "bundle size gzip",
      "model load ms",
      "model heap",
      "infer heap peak",
      "infer RSS over baseline",
    ],
    why: "What a browser downloads (model plus minified parser code), how long the model takes to load, and the memory it holds while parsing.",
  },
  {
    title: "Training cost",
    metrics: [
      "train seconds",
      "train examples/s",
      "train heap peak",
      "train RSS over baseline",
      "train allocated",
    ],
    why: "Time and memory to train a model. Matters to anyone retraining on their own data.",
  },
];

function sourceTable(s: DataStats): string {
  const sources = Object.keys(s.linesReadBySource);
  const rejected = (src: string) => sum(Object.values(s.rejectedBySource[src] ?? {}));
  const total = sum(Object.values(s.bySource));
  const others = Object.keys(s.bySource).filter((src) => !sources.includes(src));
  const rows = [
    ...[...sources, ...others].map((src) => {
      const read = sources.includes(src);
      const n = s.bySource[src] ?? 0;
      return [
        DATASET_NOTES[src] || s.datasets?.[src]?.description
          ? `<a href="#datasets/${esc(src)}">${code(src)}</a>`
          : code(src),
        esc(datasetKind(s, src)),
        String(DATASET_WEIGHTS[src] ?? 1),
        read ? int(s.linesReadBySource[src]!) : "–",
        read ? int(rejected(src)) : "–",
        int(s.duplicatesBySource[src] ?? 0),
        int(n),
        pct(n / total),
      ];
    }),
    [
      "total",
      "",
      "",
      int(s.linesRead),
      int(sum(Object.values(s.rejected))),
      int(s.duplicates),
      int(total),
      "",
    ],
  ];
  return table(
    ["dataset", "kind", "weight", "lines read", "rejected", "duplicates", "examples", "share"],
    rows,
    { align: ["l", "l", "r", "r", "r", "r", "r", "r"] },
  );
}

function datasetKind(s: DataStats | undefined, name: string): string {
  if (s?.linesReadBySource[name] !== undefined) return "libpostal";
  if (name === "junk" || name === "embedded") return "not-address";
  return s?.datasets?.[name]?.kind ?? "synthetic";
}

function datasetSection(s: DataStats | undefined, name: string): string {
  const n = DATASET_NOTES[name];
  const description = s?.datasets?.[name]?.description;
  const examples = s?.bySource[name];
  const total = s ? sum(Object.values(s.bySource)) : 0;
  const facts = [
    `weight ${DATASET_WEIGHTS[name] ?? 1}`,
    ...(examples !== undefined
      ? [`${int(examples)} examples`, `${pct(examples / total)} of all`]
      : []),
    ...(name === "junk" && s
      ? [`made after ${pct(s.notAddress.junkRate, 0)} of address examples`]
      : []),
    ...(name === "embedded" && s
      ? [`made from ${pct(s.notAddress.embeddedRate, 0)} of address examples`]
      : []),
  ];
  return `
<h3 id="datasets-${esc(name)}">${code(name)}</h3>
<p class="dim">${facts.join(" · ")}</p>
${n ? `<p>${esc(n.what)}</p>` : description ? `<p>${esc(description)}.</p>` : ""}
${n ? `<p><strong>Why:</strong> ${esc(n.why)}</p>` : ""}
${n?.weaknesses.length ? `<p><strong>Weaknesses:</strong></p>${list(n.weaknesses.map(esc))}` : ""}`;
}

function sources(s: DataStats | undefined): string {
  const grouped = new Set(DATASET_GROUPS.flatMap((g) => g.datasets));
  const others = Object.keys(s?.bySource ?? {}).filter((d) => !grouped.has(d));
  return [
    ...DATASET_GROUPS.map(
      (g) => `
<h3 id="datasets-${g.id}">${esc(g.title)}</h3>
<p>${esc(g.intro)}</p>
<p><strong>Weaknesses of all of them:</strong></p>
${list(g.weaknesses.map(esc))}
${g.datasets.map((d) => datasetSection(s, d)).join("\n")}`,
    ),
    ...(others.length
      ? [
          `<h3 id="datasets-other">Other datasets</h3>${others.map((d) => datasetSection(s, d)).join("\n")}`,
        ]
      : []),
  ].join("\n");
}

function splitsAndNoise(s: DataStats, suite: string): string {
  const noiseRows = Object.entries(s.noise.rates).map(([n, rate]) => [
    code(n),
    pct(rate, 0),
    int(s.noise.applied[n] ?? 0),
  ]);
  const labelRows = Object.entries(s.labels)
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => [`<mark class="lab" data-label="${esc(l)}">${esc(l)}</mark>`, int(n)]);
  const rejectedRows = Object.entries(s.rejected)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => [code(r), int(n)]);
  return `
<h2 id="datasets-splits">Splits</h2>
<p>Every dataset is split into train, dev and test by a hash of the address, so the same address is
always in the same split.</p>
${table(
  ["split", "examples", "share"],
  Object.entries(s.bySplit).map(([k, n]) => [code(k), int(n), pct(n / s.examples)]),
  { align: ["l", "r", "r"] },
)}
<p>Hill-climbing uses dev only. Test is scored rarely so it stays an unbiased estimate. The ${code(suite)} suite trains on the first examples of train and scores the first examples of dev.</p>

<h2 id="datasets-noise">Formatting noise</h2>
<p>After splitting, seeded transforms rewrite some examples of the libpostal and synthetic datasets
(text and labels together), so robustness to messy input is measured. ${int(s.noise.clean)} examples
are left clean.</p>
${table(["transform", "rate", "examples"], noiseRows, { align: ["l", "r", "r"] })}

<h2 id="datasets-labels">Label counts</h2>
${table(["label", "spans"], labelRows, { align: ["l", "r"] })}

<h2 id="datasets-rejected">Rejected lines</h2>
<p>libpostal lines dropped while relabeling, by reason.</p>
${table(["reason", "lines"], rejectedRows, { align: ["l", "r"] })}`;
}

function goldSection(s: DataStats | undefined): string {
  const all = Object.entries(s?.notes ?? {}).sort((a, b) => b[1] - a[1]);
  const notes = all.filter(([n]) => !n.startsWith("dropped:"));
  const dropped = all.filter(([n]) => n.startsWith("dropped:"));
  return `
<p>libpostal labels a whole street as one field (<code>road</code>) and a unit as another. The gold
labels split those fields into this label set with fixed rules (directional and type lexicons,
position), then check the result against counts over the whole corpus. Fields outside the label set
(suburb, county, building name) are removed from the text. A few lines have hand-checked labels
${s ? `(${int(s.overrides.examples)} examples)` : ""}.</p>
<p>Known limitations:</p>
${list([
  "Every rule that makes a judgment call records a note on the example. The <code>gold=heuristic</code> slice (Models tab) is the examples with such a note; parsers score lower there partly because the gold is less certain.",
  "libpostal adds deliberate noise to its data: abbreviations, truncations and misspellings (Wst, Roa, Aprt). Some are recognized and labeled; some leave a wrong gold label.",
  "Conventions follow libpostal's data, not usaddress's hand labels; usaddress loses points here for labeling some things differently, not only for mistakes.",
  "libpostal was trained on these same lines, dev and test included.",
  "Gold for the playground's demo rows has the same noise: a model marked wrong may be right.",
])}
${
  s
    ? `<details><summary>Heuristic notes (examples)</summary>${table(
        ["note", "examples"],
        notes.map(([n, c]) => [code(n), int(c)]),
        { align: ["l", "r"] },
      )}</details>
<details><summary>Fields removed from the text (examples)</summary>${table(
        ["field", "examples"],
        dropped.map(([n, c]) => [code(n.slice("dropped:".length)), int(c)]),
        { align: ["l", "r"] },
      )}</details>`
    : ""
}`;
}

function machines(ctx: PageContext): string {
  const seen = new Map<string, { m: RunResult["machine"]; uses: Set<string> }>();
  const add = (m: RunResult["machine"] | undefined, use: string) => {
    if (!m) return;
    const key = [m.cpu, m.cores, m.memoryGB, m.os, m.node].join("|");
    const e = seen.get(key) ?? { m, uses: new Set<string>() };
    e.uses.add(use);
    seen.set(key, e);
  };
  for (const r of ctx.runs) {
    add(r.machine, `${r.impl} eval`);
    add(r.metrics.training?.measured?.machine, `${r.impl} training`);
  }
  return table(
    ["CPU", "cores", "memory", "OS", "Node", "used for"],
    [...seen.values()].map(({ m, uses }) => [
      esc(m.cpu),
      String(m.cores),
      `${m.memoryGB} GB`,
      esc(m.os),
      esc(m.node),
      [...uses].join(", "),
    ]),
    { align: ["l", "r", "r", "l", "l", "l"] },
  );
}

function datasetsTab(ctx: PageContext): string {
  const s = ctx.stats;
  return `
<section id="tab-datasets" class="tab" data-tab="datasets">
<h1>Datasets</h1>

<h2 id="datasets-summary">Summary</h2>
<p>Training and eval examples come from four kinds of dataset:</p>
${list([
  `<a href="#datasets/libpostal">libpostal's training data</a> (snapshot ${code(s?.libpostalSnapshot ?? "unknown")}): US addresses from OpenStreetMap and OpenAddresses, relabeled into this label set. Most of the examples.`,
  `<a href="#datasets/not-address">Text that is not an address</a>: synthetic junk, and addresses wrapped in other text, so a parser can abstain.`,
  `<a href="#datasets/synthetic">Synthetic address forms</a>: PO boxes, rural and highway contract routes, general delivery, mileposts and military mail, which libpostal's data barely has.`,
  `<a href="#datasets/labeled">Real addresses from Alaska</a>: voter-file and campaign finance addresses with the rural forms and form-entry mess the others lack.`,
])}
<p>Each dataset is stored on its own. A split is interleaved from them by weight when it is loaded, so
every prefix of a split has the same mix. The eval set always uses the default weights below; a
training run can use another blend (see <a href="${REPO_URL}/blob/main/datasets/README.md">datasets/README.md</a>),
and the <code>source=&lt;dataset&gt;</code> slices on the Models tab show how each dataset's examples fared.</p>
${s ? sourceTable(s) : "<p>data/stats.json not found when this page was built.</p>"}

<h2 id="datasets-sources">Sources</h2>
${sources(s)}

<h2 id="datasets-gold">Gold labels</h2>
${goldSection(s)}
${s ? splitsAndNoise(s, ctx.suite) : ""}

<h2 id="datasets-licenses">Licenses</h2>
<p>The code is MIT-licensed. The models embedded in this page, and the demo examples in the
playground, are made from data under the Open Database License and other terms:</p>
<blockquote class="attribution">${linkify(ctx.attribution)}</blockquote>
${list([
  `Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0</a>.`,
  `Address data from <a href="https://openaddresses.io">OpenAddresses</a> and its government sources, under each source's terms.`,
  `Via <a href="https://github.com/openvenues/libpostal">libpostal</a>'s parser training data, snapshot ${code(s?.libpostalSnapshot ?? "unknown")}.`,
  `The method of making the training data is <a href="${REPO_URL}/tree/main/src/data">src/data/</a> in the repository.`,
  "The demo examples are a small extract of the dev split, which is a Derivative Database of OpenStreetMap under ODbL 1.0.",
])}
<p>This is a reading of the licenses, not legal advice; see <a href="${REPO_URL}/blob/main/LICENSING.md">LICENSING.md</a>.</p>
</section>`;
}

function metricsTab(ctx: PageContext): string {
  return `
<section id="tab-metrics" class="tab" data-tab="metrics">
<h1>Metrics</h1>
<p>Every parser is trained and measured by the same harness (<code>pnpm eval</code>). Each
measurement runs in a fresh process; every run is saved with its configuration, data hashes, code
version and machine. The numbers are in the comparison table on the Models tab, and the data they
are measured on is on the Datasets tab.</p>

<h2 id="metrics-what">What is measured, and why</h2>
${METRIC_GROUPS.map(
  (g) =>
    `<h3>${esc(g.title)}</h3><p>${esc(g.why)}</p><p class="metric-names">${g.metrics.map(code).join(" ")}</p>`,
).join("\n")}
<p>Suite ${code(ctx.suite)}: trained on ${int(ctx.trainExamples)} examples, scored on
${int(ctx.evalExamples)} dev examples, seed ${ctx.seed}. Speed and memory are measured only for the
TypeScript parsers; the references run as Python subprocesses, whose timings aren't comparable.</p>

<h2 id="metrics-non-goals">Non-goals</h2>
${list([
  "Addresses outside the US.",
  "Validation: whether an address exists or receives mail.",
  "Geocoding: coordinates for an address.",
  "Standardization: rewriting Street as ST or filling in a missing ZIP. Spans point into the input text unchanged.",
  "Intersections as their own label.",
])}

<h2 id="metrics-machines">Machines</h2>
<p>Timings are from these machines. Runs on different machines aren't directly comparable.</p>
${machines(ctx)}
</section>`;
}

// ---------------------------------------------------------------------------------------------
// Models

function comparison(ctx: PageContext): string {
  const runs = ctx.runs;
  const rows: string[][] = [];
  for (const m of HEADLINE) {
    const values = runs.map((r) => m.get(r));
    if (values.every((v) => v === undefined)) continue;
    const ranked = values.filter((v): v is number => v !== undefined);
    const best = m.better === "higher" ? Math.max(...ranked) : Math.min(...ranked);
    const distinct = new Set(ranked).size > 1;
    rows.push([
      esc(m.name) + (m.better === "lower" ? ' <span class="dim">↓</span>' : ""),
      ...values.map((v) =>
        v === undefined
          ? '<span class="dim">–</span>'
          : distinct && v === best
            ? `<strong class="best">${esc(m.format(v))}</strong>`
            : esc(m.format(v)),
      ),
    ]);
  }
  const head = runs.map(
    (r) => `${esc(r.impl)}${isReference(r) ? '<br><span class="dim">reference</span>' : ""}`,
  );
  return table(["metric", ...head], rows, {
    align: ["l", ...runs.map(() => "r" as const)],
    cls: "compare",
  });
}

function detail(ctx: PageContext): string {
  const runs = ctx.runs.filter((r) => r.metrics.accuracy);
  const perLabel = LABEL_NAMES.map((l) => [
    `<mark class="lab" data-label="${l}">${l}</mark>`,
    ...runs.map((r) => {
      const p = r.metrics.accuracy!.perLabel[l];
      return p && p.gold + p.predicted > 0 ? pct(p.f1, 1) : "–";
    }),
  ]);
  const sliceNames = Object.keys(runs[0]?.metrics.accuracy?.slices ?? {});
  const slices = sliceNames.map((n) => [
    code(n),
    int(runs[0]!.metrics.accuracy!.slices[n]!.examples),
    ...runs.map((r) => {
      const s = r.metrics.accuracy!.slices[n];
      return s ? pct(s.exactMatch, 1) : "–";
    }),
  ]);
  const curved = ctx.runs.filter((r) => r.metrics.learningCurve?.length);
  const sizes = [
    ...new Set(curved.flatMap((r) => r.metrics.learningCurve!.map((p) => p.trainExamples))),
  ].sort((a, b) => a - b);
  const curve = sizes.map((n) => [
    int(n),
    ...curved.map((r) => {
      const p = r.metrics.learningCurve!.find((p) => p.trainExamples === n);
      return p ? pct(p.exactMatch, 2) : "–";
    }),
  ]);
  const names = runs.map((r) => esc(r.impl));
  return `
<details><summary>Span F1 per label</summary>
${table(["label", ...names], perLabel, { align: ["l", ...runs.map(() => "r" as const)] })}</details>
<details><summary>Exact match per slice</summary>
<p>Slices are subsets of the dev eval set (<code>src/eval/slices.ts</code>): by source, by which labels the gold has, by formatting noise, by whether the gold rests on a heuristic.</p>
${table(["slice", "examples", ...names], slices, { align: ["l", "r", ...runs.map(() => "r" as const)] })}</details>
${
  curve.length
    ? `<details><summary>Exact match by training-set size</summary>
${table(["train examples", ...curved.map((r) => esc(r.impl))], curve, { align: ["l", ...curved.map(() => "r" as const)] })}</details>`
    : ""
}`;
}

function runCaption(ctx: PageContext): string {
  const items = ctx.runs.map((r) => {
    const sha = r.git.sha ? r.git.sha.slice(0, 7) + (r.git.dirty ? "+dirty" : "") : "unknown";
    const notes = ctx.runNotes[r.impl] ?? [];
    return `${code(r.impl)}: run ${code(r.runId)} at ${code(sha)}${notes.length ? ` <span class="warn">(${notes.map(esc).join("; ")})</span>` : ""}`;
  });
  if (ctx.missingRuns.length)
    items.push(`No ${code(ctx.suite)} run: ${ctx.missingRuns.map(code).join(", ")}`);
  return list(items);
}

function modelCard(ctx: PageContext, impl: string): string {
  const n = IMPL_NOTES[impl];
  const r = runOf(ctx, impl);
  const keys = [
    "exact match",
    "risk–coverage AURC",
    "latency p50 µs",
    "model size gzip",
    "train seconds",
  ]
    .map(metric)
    .filter((m) => r && m.get(r) !== undefined);
  const size = ctx.embedded[impl];
  return `
<article class="model" id="models-${impl}">
<h3>${esc(impl)}${r && isReference(r) ? ' <span class="tag">reference, Python</span>' : ""}${size ? ' <span class="tag">runs in this page</span>' : ""}</h3>
${n ? `<p><strong>${esc(n.summary)}</strong></p><p>${esc(n.architecture)}</p>` : ""}
${
  keys.length
    ? `<dl class="kv">${keys.map((m) => `<div><dt>${esc(m.name)}</dt><dd>${esc(fmt(m, r))}</dd></div>`).join("")}</dl>`
    : ""
}
${n ? `<div class="procon"><div><h4>Pros</h4>${list(n.pros.map(esc))}</div><div><h4>Cons</h4>${list(n.cons.map(esc))}</div></div><p><strong>Use it for:</strong> ${esc(n.use)}</p>` : ""}
${size ? `<p class="dim">Embedded model: ${kb(size.bytes)} (${kb(size.gzipBytes)} gzip).</p>` : ""}
</article>`;
}

function playground(ctx: PageContext): string {
  const impl = Object.keys(ctx.embedded)[0] ?? "crf";
  return `
<div class="pg-bleed">
<h2 id="home-playground">Try it</h2>
<div class="pg-row">
  <div id="pg-presets" class="pg-buttons"></div>
  <span id="pg-status" class="dim" role="status"></span>
  <button id="pg-copy" type="button">Copy as TSV</button>
</div>
<div class="table-wrap pg-wrap"><table id="pg-table" class="pg"></table></div>
</div>`;
}

function modelsTab(ctx: PageContext): string {
  const impls = ctx.runs.map((r) => r.impl);
  for (const i of Object.keys(ctx.embedded)) if (!impls.includes(i)) impls.push(i);
  return `
<section id="tab-models" class="tab" data-tab="models">
<h1>Models</h1>
<h2 id="models-compare">Comparison</h2>
<p>Latest ${code(ctx.suite)} run of each parser on the dev split. Best value per row in bold; ↓ means
lower is better. A dash means not measured (references are measured for accuracy only).</p>
${comparison(ctx)}
${detail(ctx)}
<details><summary>Runs</summary>${runCaption(ctx)}</details>

<h2 id="models-each">Parsers</h2>
${impls.map((i) => modelCard(ctx, i)).join("\n")}
</section>`;
}

// ---------------------------------------------------------------------------------------------

export function renderPage(ctx: PageContext, assets: { css: string; js: string; data: string }) {
  const hueCss = LABEL_NAMES.map((l) => `[data-label="${l}"]{--h:${LABEL_HUES[l]}}`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>nerdress</title>
<meta name="description" content="US address parsers in TypeScript: usage, metrics and an in-browser playground.">
<style>${assets.css}${hueCss}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="#home">nerdress</a>
  <nav>
    <a href="#home" data-nav="home">Home</a>
    <a href="#datasets" data-nav="datasets">Datasets</a>
    <a href="#metrics" data-nav="metrics">Metrics</a>
    <a href="#models" data-nav="models">Models</a>
  </nav>
  <a class="repo" href="${REPO_URL}">GitHub</a>
</header>
<main>
${home(ctx)}
${datasetsTab(ctx)}
${metricsTab(ctx)}
${modelsTab(ctx)}
</main>
<footer>
Built ${esc(ctx.generated.at)} from ${code(ctx.generated.git)} by <code>pnpm docs</code>.
Models trained on data © OpenStreetMap contributors (ODbL) and OpenAddresses sources;
<a href="#datasets/licenses">details</a>.
Source on <a href="${REPO_URL}">GitHub</a>.
</footer>
<script id="page-data" type="application/json">${assets.data}</script>
<script>${assets.js}</script>
</body>
</html>
`;
}
