/**
 * Renders the page's static HTML at build time: the Home, Metrics and Models tabs and the
 * playground's skeleton (docs/app.ts makes it interactive). Every number comes from the run
 * files, data/stats.json or a parse made during the build.
 */
import { LABELS, LABEL_NAMES, type Label } from "../src/labels.ts";
import { TARGET_EXACT_MATCH } from "../src/eval/accuracy.ts";
import { HEADLINE, type Metric } from "../src/eval/headline.ts";
import type { RunResult } from "../src/eval/results.ts";
import type { Span } from "../src/types.ts";
import { DATASET_WEIGHTS } from "../eval.config.ts";
import { esc, spansHtml } from "./html.ts";
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
  /** The model attribution paragraph from CONTRIBUTING.md, as plain text. */
  attribution: string;
  example: {
    text: string;
    spans: Span[];
    /** Span text → a note shown next to that span. */
    notes: Record<string, string>;
  };
  demo: { sets: number; rows: number };
  generated: { at: string; git: string };
}

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
  const ex = ctx.example;
  const labelRows = LABEL_NAMES.map((l) => {
    const [meaning, example] = LABELS[l].split(/: (?=[^:]*$)/);
    return [`<mark class="lab" data-label="${l}">${l}</mark>`, esc(meaning!), esc(example ?? "")];
  });
  return `
<section id="tab-home" class="tab" data-tab="home">
<h1>addrparse</h1>
<p class="lede">Parse US addresses into labeled parts using pure typescript, with exceptional accurary and performance.</p>

<h2 id="home-example">Example</h2>
<pre class="input">${esc(ex.text)}</pre>
<p>is parsed to a sequence of tokens:</p>
<p class="parsed">${spansHtml(ex.text, ex.spans)}</p>
${table(
  ["label", "text", "start", "end", "note"],
  ex.spans.map((s) => {
    const text = ex.text.slice(s.start, s.end);
    return [
      `<mark class="lab" data-label="${s.label}">${s.label}</mark>`,
      esc(text),
      String(s.start),
      String(s.end),
      esc(ex.notes[text] ?? ""),
    ];
  }),
  { align: ["l", "l", "r", "r", "l"] },
)}

<h2 id="home-goals">What</h2>
${list([
  "99.87% per-token accuracy, 98.45% exact match.",
  "Run anywhere: Zero dependencies, pure typescript, 338 KB gzipped model size.",
  "Performant: ~78k/sec per thread, 29us p99 latency, peak memory of 18Mb (all on M1 Mac).",
  "Say how sure each parse is, so a caller can accept confident parses and review the rest.",
  "Recognize text that is not an address and label it <code>NotAddress</code> instead of forcing a parse.",
  "Every claim backed by a saved, reproducible measurement (the Metrics tab).",
])}

<h2 id="home-labels">Labels</h2>
<p>Names follow <a href="https://github.com/datamade/usaddress">usaddress</a>, which follows the
FGDC United States Thoroughfare, Landmark, and Postal Address Data Standard.</p>
${table(["label", "meaning", "example"], labelRows, { cls: "labels" })}

<h2 id="home-usage">Usage</h2>
<p>The <code>addrparse</code> npm package is the <code>crf</code> parser with its model embedded:</p>
<pre><code>npm install addrparse</code></pre>
<pre><code>import { parse } from "addrparse";

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

function trainingData(s: DataStats, suite: string): string {
  const sources = Object.keys(s.linesReadBySource);
  const rejected = (src: string) => sum(Object.values(s.rejectedBySource[src] ?? {}));
  const total = sum(Object.values(s.bySource));
  const others = Object.keys(s.bySource).filter((src) => !sources.includes(src));
  const sourceRows = [
    ...[...sources, ...others].map((src) => {
      const read = sources.includes(src);
      const n = s.bySource[src] ?? 0;
      const kind = s.datasets?.[src]?.kind === "labeled" ? "labeled" : "synthetic";
      return [
        read ? code(src) : `${code(src)} (${kind})`,
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
      int(s.linesRead),
      int(sum(Object.values(s.rejected))),
      int(s.duplicates),
      int(total),
      "",
    ],
  ];
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
<p>Most examples come from libpostal's parser training data (snapshot ${code(s.libpostalSnapshot)}), filtered to
the US, relabeled into the label set above, deduplicated and split by a hash of the address. Synthetic
datasets add address forms libpostal's data barely has: PO boxes as people write them, rural and highway
contract routes, general delivery, mileposts and military mail. Each dataset is stored on its own, and a
split is interleaved from them by weight when it is loaded, so every prefix of a split has the same mix.</p>
${table(
  ["source", "weight", "lines read", "rejected", "duplicates", "examples", "share"],
  sourceRows,
  { align: ["l", "r", "r", "r", "r", "r", "r"] },
)}
${list([
  `${code("openaddresses")}: government address points (number, street, city, state, ZIP).`,
  `${code("osm")}: OpenStreetMap addresses, often with units, PO boxes and countries.`,
  `${code("ways")}: OpenStreetMap streets with a place, no house number.`,
  `${code("places")}: OpenStreetMap places alone (city, state, ZIP).`,
  `${code("junk")}: synthetic text that is not an address (placeholders, emails, phone numbers, names, ordinary words), all NotAddress; made after ${pct(s.notAddress.junkRate, 0)} of address examples.`,
  `${code("embedded")}: a real address inside other text ("Mail to … thanks"); made from ${pct(s.notAddress.embeddedRate, 0)} of address examples.`,
  ...Object.entries(s.datasets ?? {})
    .filter(([, d]) => d.description)
    .map(([name, d]) => `${code(name)}: ${esc(d.description!)}.`),
])}
<h3>Splits</h3>
${table(
  ["split", "examples", "share"],
  Object.entries(s.bySplit).map(([k, n]) => [code(k), int(n), pct(n / s.examples)]),
  { align: ["l", "r", "r"] },
)}
<p>Hill-climbing uses dev only. Test is scored rarely so it stays an unbiased estimate. The ${code(suite)} suite trains on the first examples of train and scores the first examples of dev.</p>
<h3>Formatting noise</h3>
<p>After splitting, seeded transforms rewrite some examples (text and labels together), so robustness to
messy input is measured. ${int(s.noise.clean)} examples are left clean.</p>
${table(["transform", "rate", "examples"], noiseRows, { align: ["l", "r", "r"] })}
<h3>Label counts</h3>
${table(["label", "spans"], labelRows, { align: ["l", "r"] })}
<h3>Rejected lines</h3>
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

function metricsTab(ctx: PageContext): string {
  const s = ctx.stats;
  return `
<section id="tab-metrics" class="tab" data-tab="metrics">
<h1>Metrics and data</h1>
<p>Every parser is trained and measured by the same harness (<code>pnpm eval</code>). Each
measurement runs in a fresh process; every run is saved with its configuration, data hashes, code
version and machine. The numbers are in the comparison table on the Models tab.</p>

<h2 id="metrics-what">What is measured, and why</h2>
${METRIC_GROUPS.map(
  (g) =>
    `<h3>${esc(g.title)}</h3><p>${esc(g.why)}</p><p class="metric-names">${g.metrics.map(code).join(" ")}</p>`,
).join("\n")}
<p>Suite ${code(ctx.suite)}: trained on ${int(ctx.trainExamples)} examples, scored on
${int(ctx.evalExamples)} dev examples, seed ${ctx.seed}. Speed and memory are measured only for the
TypeScript parsers; the references run as Python subprocesses, whose timings aren't comparable.</p>

<h2 id="metrics-data">Training data</h2>
${s ? trainingData(s, ctx.suite) : "<p>data/stats.json not found when this page was built.</p>"}

<h2 id="metrics-gold">Gold labels</h2>
${goldSection(s)}

<h2 id="metrics-non-goals">Non-goals</h2>
${list([
  "Addresses outside the US.",
  "Validation: whether an address exists or receives mail.",
  "Geocoding: coordinates for an address.",
  "Standardization: rewriting Street as ST or filling in a missing ZIP. Spans point into the input text unchanged.",
  "Names of people or businesses; they are NotAddress or left unlabeled.",
  "Intersections and landmarks as their own labels.",
])}

<h2 id="metrics-machines">Machines</h2>
<p>Timings are from these machines. Runs on different machines aren't directly comparable.</p>
${machines(ctx)}

<h2 id="metrics-licenses">Data and licenses</h2>
<p>The code is MIT-licensed. The models embedded in this page, and the demo examples in the
playground, are made from data under the Open Database License and other terms:</p>
<blockquote class="attribution">${linkify(ctx.attribution)}</blockquote>
${list([
  `Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0</a>.`,
  `Address data from <a href="https://openaddresses.io">OpenAddresses</a> and its government sources, under each source's terms.`,
  `Via <a href="https://github.com/openvenues/libpostal">libpostal</a>'s parser training data, snapshot ${code(s?.libpostalSnapshot ?? "unknown")}.`,
  `The method of making the training data is <a href="https://github.com/NickCrews/addrparse/tree/main/src/data">src/data/</a> in the repository.`,
  "The demo examples are a small extract of the dev split, which is a Derivative Database of OpenStreetMap under ODbL 1.0.",
])}
<p>This is a reading of the licenses, not legal advice; see the repository's CONTRIBUTING.md.</p>
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
  return `
<h2 id="models-playground">Playground</h2>
<p>Paste addresses, one per line. ${Object.keys(ctx.embedded).map(code).join(" and ")} run in this page
with the embedded models. The Python references can't run here; their columns are filled only for demo
rows, from their eval run.</p>
<div class="pg-controls">
  <label class="field">Demo set
    <select id="pg-demo"><option value="">(your own text)</option></select>
  </label>
  <p id="pg-demo-desc" class="dim"></p>
  <textarea id="pg-input" rows="8" wrap="off" spellcheck="false" placeholder="One address per line"></textarea>
  <div class="pg-row">
    <fieldset id="pg-models"><legend>Models</legend></fieldset>
    <label class="check"><input type="checkbox" id="pg-empty"> show empty label columns</label>
    <label class="check"><input type="checkbox" id="pg-diff"> only rows where models disagree</label>
  </div>
  <div class="pg-row">
    <button id="pg-copy" type="button">Copy as TSV</button>
    <span id="pg-status" class="dim" role="status"></span>
  </div>
</div>
<p class="dim">Demo sets are ${ctx.demo.sets} seeded samples (${ctx.demo.rows} rows) from the dev split, picked
by running the models at build time. Their gold labels have the noise described under Metrics → Gold
labels, so a cell marked wrong may be right.</p>
<div id="pg-detail" class="pg-detail" hidden></div>
<div class="table-wrap pg-wrap"><table id="pg-table" class="pg"></table></div>`;
}

function modelsTab(ctx: PageContext): string {
  const impls = ctx.runs.map((r) => r.impl);
  for (const i of Object.keys(ctx.embedded)) if (!impls.includes(i)) impls.push(i);
  return `
<section id="tab-models" class="tab" data-tab="models">
<h1>Models</h1>
<p><a href="#models/playground">Jump to the playground</a></p>
<h2 id="models-compare">Comparison</h2>
<p>Latest ${code(ctx.suite)} run of each parser on the dev split. Best value per row in bold; ↓ means
lower is better. A dash means not measured (references are measured for accuracy only).</p>
${comparison(ctx)}
${detail(ctx)}
<details><summary>Runs</summary>${runCaption(ctx)}</details>

<h2 id="models-each">Parsers</h2>
${impls.map((i) => modelCard(ctx, i)).join("\n")}
${playground(ctx)}
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
<title>addrparse</title>
<meta name="description" content="US address parsers in TypeScript: usage, metrics and an in-browser playground.">
<style>${assets.css}${hueCss}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="#home">addrparse</a>
  <nav>
    <a href="#home" data-nav="home">Home</a>
    <a href="#metrics" data-nav="metrics">Metrics</a>
    <a href="#models" data-nav="models">Models &amp; playground</a>
  </nav>
</header>
<main>
${home(ctx)}
${metricsTab(ctx)}
${modelsTab(ctx)}
</main>
<footer>
Built ${esc(ctx.generated.at)} from ${code(ctx.generated.git)} by <code>pnpm docs</code>.
Models trained on data © OpenStreetMap contributors (ODbL) and OpenAddresses sources;
<a href="#metrics/licenses">details</a>.
</footer>
<script id="page-data" type="application/json">${assets.data}</script>
<script>${assets.js}</script>
</body>
</html>
`;
}
