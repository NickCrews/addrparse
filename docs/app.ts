/**
 * The page's script: hash-routed tabs and the playground. Bundled into the page by build.ts.
 * Routes are `#<tab>` or `#<tab>/<section>`, which scrolls to the element `<tab>-<section>`.
 */
import type { Span } from "../src/types.ts";
import { entsHtml, esc } from "./html.ts";
import type { PageData } from "./page-data.ts";
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
//
// A table with one input cell per address in the left column. Each input cell spans a gold row
// (when the text is a preset row from the dev split) and a predicted row. The input cells are
// editable: Enter splits a row, Backspace at the start joins it to the one above, and a paste
// of several lines becomes several rows. The last input cell is always empty, for a new row.

interface Result {
  spans: Span[];
  confidence?: number;
}

const MAX_ROWS = 2000;
const impl = data.embedded[0]?.impl;
let parse: ((text: string) => Result) | undefined;
let loadError: string | undefined;
/** Parses of the current rows, by text, so an edit re-parses only the row it changed. */
let results = new Map<string, Result>();
let texts: string[] = [];
/** Benchmark parses repeat until this much time has passed, so short inputs time accurately. */
const BENCH_MS = 20;
/** How long input must pause before the benchmark runs. */
const BENCH_DELAY_MS = 250;
/** Time spent parsing before the first timed render, so the first reading isn't of cold code. */
const WARMUP_MS = 200;

const presetsEl = $("pg-presets");
const status = $("pg-status");
const tableEl = $<HTMLTableElement>("pg-table");
/** Id of the loaded preset, until the rows are edited. */
let preset = "";

for (const set of data.demo.sets) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.preset = set.id;
  b.textContent = set.title;
  presetsEl.append(b);
}
presetsEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-preset]");
  if (b) loadDemo(b.dataset.preset!);
});

function showPreset(id: string) {
  preset = id;
  for (const b of presetsEl.querySelectorAll<HTMLElement>("[data-preset]"))
    b.setAttribute("aria-pressed", String(b.dataset.preset === id));
}

function loadDemo(id: string) {
  const set = data.demo.sets.find((s) => s.id === id);
  if (set) texts = [...set.texts];
  showPreset(set ? id : "");
  render();
}

/** Unselects the preset once the rows no longer equal it. */
function syncPreset() {
  const set = data.demo.sets.find((s) => s.id === preset);
  if (set && set.texts.join("\n") !== texts.join("\n")) showPreset("");
}

function result(text: string): Result | undefined {
  if (!parse || !text.trim()) return undefined;
  let r = results.get(text);
  if (!r) results.set(text, (r = parse(text)));
  return r;
}

/**
 * Parses every row, in passes over all of them until BENCH_MS has passed, and returns the
 * number of rows and the mean milliseconds per pass.
 */
function parseAll(): { n: number; ms: number } | undefined {
  const lines = texts.filter((t) => t.trim());
  if (!parse || !lines.length) return undefined;
  let passes = 0;
  const t0 = performance.now();
  let elapsed = 0;
  do {
    for (const t of lines) parse(t);
    passes++;
    elapsed = performance.now() - t0;
  } while (elapsed < BENCH_MS);
  return { n: lines.length, ms: elapsed / passes };
}

const sig = (x: number, digits: number) =>
  x.toLocaleString("en-US", { maximumSignificantDigits: digits });

function benchText(b: { n: number; ms: number } | undefined): string {
  if (!b) return "";
  const rate = (b.n / b.ms) * 1000;
  return (
    `parsed ${b.n.toLocaleString("en-US")} ${b.n === 1 ? "address" : "addresses"} in ` +
    `${sig(b.ms, 2)} ms (${sig(rate, 2)} addrs/sec)`
  );
}

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

const goldOf = (text: string) => data.demo.rows[text];

/** Labels that appear in some row's prediction or gold, in label order. */
function usedLabels(): string[] {
  const used = new Set<string>();
  for (const t of texts) {
    result(t)?.spans.forEach((s) => used.add(s.label));
    goldOf(t)?.gold.forEach((s) => used.add(s.label));
  }
  return data.labels.filter((l) => used.has(l));
}

function inputCell(i: number, text: string, rows: number): string {
  return (
    `<td class="pg-in"${rows > 1 ? ` rowspan="${rows}"` : ""}>` +
    `<div class="pg-edit" contenteditable="plaintext-only" spellcheck="false" ` +
    `data-i="${i}" data-placeholder="${i ? "Another address" : "Type or paste addresses"}">` +
    `${esc(text)}</div></td>`
  );
}

/** Label columns of the table as last rendered. */
let columns: string[] = [];

/**
 * Row `i`'s cells after its input cell: those in the first `<tr>`, the `<tr>`s after it, and
 * how many `<tr>`s the input cell spans.
 */
function rowParts(text: string): { span: number; first: string; rest: string } {
  const width = columns.length + 3;
  if (!text.trim()) return { span: 1, first: `<td colspan="${width}"></td>`, rest: "" };
  const gold = goldOf(text);
  const res = result(text);
  let goldCells = "";
  if (gold) {
    goldCells =
      `<th scope="row">gold</th><td class="pg-ner">${entsHtml(text, gold.gold)}</td><td></td>` +
      columns.map((l) => `<td>${esc(cellText(text, gold.gold, l))}</td>`).join("");
  }
  const ok = gold && impl ? gold.exact[impl] : undefined;
  const mark =
    ok === undefined
      ? ""
      : ok
        ? ' <span class="ok" title="exact match with gold">✓</span>'
        : ' <span class="bad" title="differs from gold">✗</span>';
  let pred = `<th scope="row">predicted${mark}</th>`;
  if (!res) {
    pred += `<td colspan="${width - 1}" class="dim">${loadError ? esc(loadError) : "loading model…"}</td>`;
  } else {
    pred +=
      `<td class="pg-ner">${entsHtml(text, res.spans)}</td>` +
      `<td class="num">${res.confidence === undefined ? "–" : res.confidence.toFixed(3)}</td>`;
    for (const l of columns) {
      const v = cellText(text, res.spans, l);
      const cls = !gold ? "" : v !== cellText(text, gold.gold, l) ? "cell-bad" : v ? "cell-ok" : "";
      pred += `<td${cls ? ` class="${cls}"` : ""}>${esc(v)}</td>`;
    }
  }
  return gold
    ? { span: 2, first: goldCells, rest: `<tr>${pred}</tr>` }
    : { span: 1, first: pred, rest: "" };
}

function headHtml(): string {
  let withGold = 0;
  let exact = 0;
  for (const t of texts) {
    const ok = t.trim() && impl ? goldOf(t)?.exact[impl] : undefined;
    if (ok === undefined) continue;
    withGold++;
    exact += Number(ok);
  }
  return (
    `<thead><tr><th>input</th>` +
    (withGold
      ? `<th title="rows whose prediction equals gold">${exact}/${withGold} exact</th>`
      : "<th></th>") +
    `<th>parsed</th><th class="num">conf.</th>` +
    columns.map((l) => `<th><mark class="lab" data-label="${l}">${l}</mark></th>`).join("") +
    `</tr></thead>`
  );
}

/** Rebuilds the whole table, keeping the focused input cell's caret. */
function render() {
  const active = document.activeElement as HTMLElement | null;
  const focusAt = active?.dataset.i === undefined ? undefined : Number(active.dataset.i);
  const caret = focusAt === undefined ? 0 : caretOffset(active!);

  // Keep only the current rows' parses, so edits don't accumulate.
  const keep = new Map<string, Result>();
  for (const t of texts) {
    const r = results.get(t);
    if (r) keep.set(t, r);
  }
  results = keep;
  columns = usedLabels();
  let body = "";
  texts.forEach((text, i) => {
    const { span, first, rest } = rowParts(text);
    body += `<tbody data-row="${i}"><tr>${inputCell(i, text, span)}${first}</tr>${rest}</tbody>`;
  });
  if (texts.length < MAX_ROWS) {
    const { first } = rowParts("");
    body += `<tbody class="pg-new"><tr>${inputCell(texts.length, "", 1)}${first}</tr></tbody>`;
  }
  tableEl.innerHTML = headHtml() + body;

  if (focusAt !== undefined) {
    const el = tableEl.querySelector<HTMLElement>(`[data-i="${focusAt}"]`);
    if (el) setCaret(el, caret);
  }
  scheduleBench();
}

/**
 * Redraws row `i` after its text changed, leaving its input cell in place so typing keeps its
 * caret. Falls back to a full render when the edit adds a row or changes the label columns.
 */
function renderRow(i: number) {
  const tbody = tableEl.querySelector<HTMLElement>(`tbody[data-row="${i}"]`);
  const input = tbody?.querySelector<HTMLTableCellElement>("td.pg-in");
  const before = columns.join();
  columns = usedLabels();
  if (!tbody || !input || columns.join() !== before) return render();
  const { span, first, rest } = rowParts(texts[i]!);
  const tr = input.parentElement!;
  while (tr.lastElementChild !== input) tr.lastElementChild!.remove();
  while (tbody.lastElementChild !== tr) tbody.lastElementChild!.remove();
  input.rowSpan = span;
  tr.insertAdjacentHTML("beforeend", first);
  tbody.insertAdjacentHTML("beforeend", rest);
  const head = headHtml();
  const thead = tableEl.querySelector("thead")!;
  if (thead.outerHTML !== head) thead.outerHTML = head;
  scheduleBench();
}

let benchTimer: ReturnType<typeof setTimeout> | undefined;
/** Times parsing all rows once input pauses, so the benchmark never delays an update. */
function scheduleBench() {
  clearTimeout(benchTimer);
  benchTimer = setTimeout(() => {
    status.textContent = [
      benchText(parseAll()),
      texts.length >= MAX_ROWS ? `at most ${MAX_ROWS} rows` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }, BENCH_DELAY_MS);
}

// --- Editing ---------------------------------------------------------------------------------

function caretOffset(el: HTMLElement): number {
  const sel = getSelection();
  if (!sel?.rangeCount) return el.textContent!.length;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function setCaret(el: HTMLElement, offset: number) {
  el.focus();
  const r = document.createRange();
  const t = el.firstChild;
  if (t?.nodeType === Node.TEXT_NODE) r.setStart(t, Math.min(offset, t.textContent!.length));
  else r.setStart(el, 0);
  r.collapse(true);
  const sel = getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Puts focus on input cell `i` at `offset`, after the next render. */
function focusAfterRender(i: number, offset: number) {
  render();
  const el = tableEl.querySelector<HTMLElement>(`[data-i="${i}"]`);
  if (el) setCaret(el, offset);
}

const editOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>(".pg-edit");

tableEl.addEventListener("input", (e) => {
  const el = editOf(e);
  if (!el) return;
  const i = Number(el.dataset.i);
  const isNew = i === texts.length;
  texts[i] = (el.textContent ?? "").replace(/[\r\n]+/g, " ");
  syncPreset();
  if (isNew) render();
  else renderRow(i);
});

tableEl.addEventListener("paste", (e) => {
  const el = editOf(e);
  if (!el) return;
  e.preventDefault();
  const pasted = e.clipboardData?.getData("text/plain") ?? "";
  const i = Number(el.dataset.i);
  const text = el.textContent ?? "";
  const sel = getSelection()!;
  const start = caretOffset(el);
  const end = start + (sel.rangeCount ? sel.getRangeAt(0).toString().length : 0);
  const lines = pasted.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  lines[0] = text.slice(0, start) + lines[0];
  const last = lines.length - 1;
  const caret = lines[last]!.length;
  lines[last] += text.slice(end);
  texts.splice(i, 1, ...lines);
  texts = texts.slice(0, MAX_ROWS);
  syncPreset();
  focusAfterRender(Math.min(i + last, texts.length - 1), caret);
});

tableEl.addEventListener("keydown", (e) => {
  const el = editOf(e);
  if (!el || e.isComposing) return;
  const i = Number(el.dataset.i);
  const text = el.textContent ?? "";
  const at = caretOffset(el);
  const collapsed = getSelection()?.isCollapsed ?? true;
  if (e.key === "Enter") {
    e.preventDefault();
    if (texts.length >= MAX_ROWS) return;
    texts.splice(i, 1, text.slice(0, at), text.slice(at));
    syncPreset();
    focusAfterRender(i + 1, 0);
  } else if (e.key === "Backspace" && at === 0 && collapsed && i > 0) {
    e.preventDefault();
    const prev = texts[i - 1]!;
    texts.splice(i - 1, 2, prev + text);
    syncPreset();
    focusAfterRender(i - 1, prev.length);
  } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey) {
    const next = tableEl.querySelector<HTMLElement>(
      `[data-i="${i + (e.key === "ArrowUp" ? -1 : 1)}"]`,
    );
    if (!next) return;
    e.preventDefault();
    setCaret(next, Math.min(at, next.textContent!.length));
  }
});

// --- Buttons ---------------------------------------------------------------------------------

function tsv(): string {
  const columns = usedLabels();
  const anyGold = texts.some((t) => goldOf(t));
  const clean = (s: string) => s.replace(/[\t\n\r]+/g, " ");
  const head = ["text"];
  if (anyGold) head.push(...columns.map((l) => `gold:${l}`));
  head.push(...columns.map((l) => `predicted:${l}`), "confidence");
  const lines = [head.join("\t")];
  for (const t of texts) {
    if (!t.trim()) continue;
    const res = result(t);
    const cells = [clean(t)];
    if (anyGold) cells.push(...columns.map((l) => clean(cellText(t, goldOf(t)?.gold, l))));
    cells.push(...columns.map((l) => clean(cellText(t, res?.spans, l))));
    cells.push(res?.confidence === undefined ? "" : String(res.confidence));
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
  status.textContent = `copied ${text.split("\n").length - 2} rows as TSV`;
});

// --- Start -----------------------------------------------------------------------------------

loadDemo(data.demo.sets[0]?.id ?? "");
const model = data.embedded[0];
if (!model) loadError = "no model embedded in this page";
else
  loadEmbedded(model).then(
    (p) => {
      parse = (t) => {
        const r = p.parse(t);
        return Array.isArray(r) ? { spans: r } : r;
      };
      // The model is decoded on the first call, and the engine optimizes the parser only after
      // it has run for a while; parse the preset rows for WARMUP_MS first so neither is timed.
      const warmup = data.demo.sets.flatMap((d) => d.texts);
      const t0 = performance.now();
      while (performance.now() - t0 < WARMUP_MS) for (const t of warmup) parse(t);
      render();
    },
    (e: unknown) => {
      loadError = `failed to load the model: ${e instanceof Error ? e.message : String(e)}`;
      render();
    },
  );
