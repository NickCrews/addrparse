/**
 * The page's script: hash-routed tabs and the playground. Bundled into the page by build.ts.
 * Routes are `#<tab>` or `#<tab>/<section>`, which scrolls to the element `<tab>-<section>`.
 */
import type { Span } from "../src/types.ts";
import type { DemoRow, PageData } from "./page-data.ts";
import { loadEmbedded } from "./parsers.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const data = JSON.parse($("page-data").textContent!) as PageData;

// ---------------------------------------------------------------------------------------------
// Tabs

const TABS = [...document.querySelectorAll<HTMLElement>("section.tab")].map((s) => s.dataset.tab!);

function route() {
  const [tab0, section] = location.hash.slice(1).split("/");
  const tab = TABS.includes(tab0!) ? tab0! : "home";
  for (const s of document.querySelectorAll<HTMLElement>("section.tab")) {
    s.hidden = s.dataset.tab !== tab;
  }
  for (const a of document.querySelectorAll<HTMLElement>("[data-nav]")) {
    if (a.dataset.nav === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const target = section ? document.getElementById(`${tab}-${section}`) : null;
  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route();

// ---------------------------------------------------------------------------------------------
// Playground

interface Result {
  spans: Span[];
  confidence?: number;
}
type Parse = (text: string) => Result;

const MAX_LINES = 2000;
const parsers: Record<string, Parse> = {};
const input = $<HTMLTextAreaElement>("pg-input");
const demoSelect = $<HTMLSelectElement>("pg-demo");
const status = $("pg-status");
const tableEl = $<HTMLTableElement>("pg-table");
const detail = $("pg-detail");
const showEmpty = $<HTMLInputElement>("pg-empty");
const onlyDiff = $<HTMLInputElement>("pg-diff");

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

// Model checkboxes.
const modelBox = $("pg-models");
for (const m of data.models) {
  const label = document.createElement("label");
  label.className = "check";
  label.innerHTML =
    `<input type="checkbox" value="${esc(m.impl)}" checked> ${esc(m.impl)}` +
    (m.inPage ? "" : ' <span class="dim">(demo rows only)</span>');
  modelBox.append(label);
}
const selected = () =>
  [...modelBox.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value);

// Demo sets, grouped.
const groups = new Map<string, HTMLOptGroupElement>();
for (const set of data.demo.sets) {
  let g = groups.get(set.group);
  if (!g) {
    g = document.createElement("optgroup");
    g.label = set.group;
    groups.set(set.group, g);
    demoSelect.append(g);
  }
  const o = document.createElement("option");
  o.value = set.id;
  o.textContent = `${set.title} (${set.texts.length})`;
  g.append(o);
}
function loadDemo(id: string) {
  const set = data.demo.sets.find((s) => s.id === id);
  $("pg-demo-desc").textContent = set?.description ?? "";
  if (set) input.value = set.texts.join("\n");
  render();
}
demoSelect.addEventListener("change", () => loadDemo(demoSelect.value));

/** A span's text with surrounding whitespace and `,`/`;` removed, as the scorer compares spans. */
function cellText(text: string, spans: readonly Span[] | undefined, label: string): string {
  if (!spans) return "";
  return spans
    .filter((s) => s.label === label)
    .sort((a, b) => a.start - b.start)
    .map((s) => text.slice(s.start, s.end).replace(/^[\s,;]+|[\s,;]+$/g, ""))
    .filter(Boolean)
    .join(" · ");
}

function spansHtml(text: string, spans: readonly Span[]): string {
  let out = "";
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    out += esc(text.slice(at, s.start));
    out += `<mark class="lab" data-label="${s.label}" title="${s.label}">${esc(text.slice(s.start, s.end))}</mark>`;
    at = s.end;
  }
  return out + esc(text.slice(at));
}

interface Row {
  text: string;
  demo?: DemoRow;
  /** Per selected model; undefined when the model can't parse this text here. */
  results: Record<string, Result | undefined>;
}

let rows: Row[] = [];
let columns: string[] = [];

function computeRows(models: string[]): Row[] {
  const lines = input.value.split("\n").filter((l) => l.trim());
  return lines.slice(0, MAX_LINES).map((text) => {
    const demo = data.demo.rows[text];
    const results: Row["results"] = {};
    for (const m of models) {
      const p = parsers[m];
      results[m] = p ? p(text) : demo?.spans[m] ? { spans: demo.spans[m] } : undefined;
    }
    return { text, demo, results };
  });
}

/** Columns where the available models give different text. */
function disagreements(row: Row, models: string[]): Set<string> {
  const out = new Set<string>();
  const avail = models.filter((m) => row.results[m]);
  if (avail.length < 2) return out;
  for (const l of data.labels) {
    const vals = new Set(avail.map((m) => cellText(row.text, row.results[m]!.spans, l)));
    if (vals.size > 1) out.add(l);
  }
  return out;
}

function render() {
  const models = selected().filter((m) => data.models.some((x) => x.impl === m));
  rows = computeRows(models);
  const used = new Set<string>();
  for (const r of rows) {
    for (const res of Object.values(r.results)) res?.spans.forEach((s) => used.add(s.label));
    r.demo?.gold.forEach((s) => used.add(s.label));
  }
  columns = data.labels.filter((l) => showEmpty.checked || used.has(l));
  const anyGold = rows.some((r) => r.demo);

  const head =
    `<thead><tr><th>model</th>${anyGold ? '<th title="exact match with gold">gold?</th>' : ""}` +
    `<th class="num">conf.</th>` +
    columns.map((l) => `<th><mark class="lab" data-label="${l}">${l}</mark></th>`).join("") +
    `</tr></thead>`;
  const width = columns.length + (anyGold ? 3 : 2);
  let body = "";
  let shown = 0;
  let disagreeRows = 0;
  const exactCounts: Record<string, [number, number]> = {};
  rows.forEach((r, i) => {
    const diff = disagreements(r, models);
    if (diff.size) disagreeRows++;
    for (const m of models) {
      const ex = r.demo?.exact[m];
      if (ex === undefined || !r.results[m]) continue;
      const c = (exactCounts[m] ??= [0, 0]);
      c[0] += Number(ex);
      c[1]++;
    }
    if (onlyDiff.checked && !diff.size) return;
    shown++;
    body +=
      `<tbody data-row="${i}"><tr class="input"><td colspan="${width}">` +
      `<button type="button" class="linkish" data-inspect="${i}">${i + 1}. ${esc(r.text)}</button></td></tr>`;
    if (r.demo) {
      body +=
        `<tr class="gold"><th scope="row">gold</th>${anyGold ? "<td></td>" : ""}<td></td>` +
        columns.map((l) => `<td>${esc(cellText(r.text, r.demo!.gold, l))}</td>`).join("") +
        `</tr>`;
    }
    for (const m of models) {
      const res = r.results[m];
      const ex = r.demo?.exact[m];
      const mark =
        !res || ex === undefined
          ? ""
          : ex
            ? '<span class="ok" title="exact match">✓</span>'
            : '<span class="bad" title="differs from gold">✗</span>';
      body += `<tr><th scope="row">${esc(m)}</th>${anyGold ? `<td>${mark}</td>` : ""}`;
      if (!res) {
        body += `<td colspan="${columns.length + 1}" class="dim">not available for this text</td></tr>`;
        continue;
      }
      body += `<td class="num">${res.confidence === undefined ? "–" : res.confidence.toFixed(3)}</td>`;
      for (const l of columns) {
        const v = cellText(r.text, res.spans, l);
        let cls = "";
        if (r.demo)
          cls = v === cellText(r.text, r.demo.gold, l) ? (v ? "cell-ok" : "") : "cell-bad";
        else if (diff.has(l)) cls = "cell-diff";
        body += `<td${cls ? ` class="${cls}"` : ""}>${esc(v)}</td>`;
      }
      body += `</tr>`;
    }
    body += `</tbody>`;
  });
  tableEl.innerHTML = rows.length ? head + body : "";

  const lines = input.value.split("\n").filter((l) => l.trim()).length;
  const parts = [`${rows.length} rows`];
  if (lines > MAX_LINES) parts.push(`first ${MAX_LINES} of ${lines} lines`);
  if (models.length > 1) parts.push(`models disagree on ${disagreeRows}`);
  for (const [m, [ok, n]] of Object.entries(exactCounts)) parts.push(`${m} ${ok}/${n} exact`);
  if (onlyDiff.checked) parts.push(`showing ${shown}`);
  status.textContent = parts.join(" · ");
}

function inspect(i: number) {
  const r = rows[i];
  if (!r) return;
  const lines: string[] = [];
  if (r.demo) lines.push(`<dt>gold</dt><dd>${spansHtml(r.text, r.demo.gold)}</dd>`);
  for (const [m, res] of Object.entries(r.results)) {
    if (!res) continue;
    const conf =
      res.confidence === undefined ? "" : ` <span class="dim">${res.confidence.toFixed(3)}</span>`;
    lines.push(`<dt>${esc(m)}${conf}</dt><dd>${spansHtml(r.text, res.spans)}</dd>`);
  }
  detail.innerHTML =
    `<div class="pg-detail-head"><strong>Row ${i + 1}</strong>` +
    `<button type="button" id="pg-detail-close" aria-label="Close">×</button></div>` +
    `<dl>${lines.join("")}</dl>`;
  detail.hidden = false;
  $("pg-detail-close").addEventListener("click", () => (detail.hidden = true));
  detail.scrollIntoView({ block: "nearest" });
}
tableEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-inspect]");
  if (b) inspect(Number(b.dataset.inspect));
});

function tsv(): string {
  const models = selected();
  const anyGold = rows.some((r) => r.demo);
  const clean = (s: string) => s.replace(/[\t\n\r]+/g, " ");
  const head = ["text"];
  if (anyGold) head.push(...columns.map((l) => `gold:${l}`));
  for (const m of models) head.push(...columns.map((l) => `${m}:${l}`), `${m}:confidence`);
  const lines = [head.join("\t")];
  for (const r of rows) {
    const cells = [clean(r.text)];
    if (anyGold) cells.push(...columns.map((l) => clean(cellText(r.text, r.demo?.gold, l))));
    for (const m of models) {
      const res = r.results[m];
      cells.push(...columns.map((l) => clean(cellText(r.text, res?.spans, l))));
      cells.push(res?.confidence === undefined ? "" : String(res.confidence));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n") + "\n";
}

$("pg-copy").addEventListener("click", async () => {
  const text = tsv();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  status.textContent = `copied ${rows.length} rows as TSV`;
});

let timer: ReturnType<typeof setTimeout> | undefined;
input.addEventListener("input", () => {
  if (
    demoSelect.value &&
    input.value !== data.demo.sets.find((s) => s.id === demoSelect.value)?.texts.join("\n")
  ) {
    demoSelect.value = "";
    $("pg-demo-desc").textContent = "";
  }
  clearTimeout(timer);
  timer = setTimeout(render, 200);
});
for (const el of [modelBox, showEmpty, onlyDiff]) el.addEventListener("change", render);

status.textContent = "loading models…";
Promise.all(
  data.embedded.map(async (m) => {
    const p = await loadEmbedded(m);
    parsers[m.impl] = (t) => {
      const r = p.parse(t);
      return Array.isArray(r) ? { spans: r } : r;
    };
  }),
).then(
  () => {
    const first = data.demo.sets[0];
    if (first) demoSelect.value = first.id;
    loadDemo(demoSelect.value);
  },
  (e: unknown) => {
    status.textContent = `failed to load models: ${e instanceof Error ? e.message : String(e)}`;
  },
);
