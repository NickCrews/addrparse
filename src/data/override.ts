/**
 * Prints `overrides/gold.jsonl` lines for raw libpostal lines, with their current labels, to edit
 * by hand and append to the file. Each query is an example id ("osm:6") or a case-insensitive
 * substring of the refined text. Matches include lines the build rejects.
 *
 *   pnpm data:override <id|text>... [--limit 20]
 *
 * stdout gets the JSON lines; stderr gets each line's id, split, notes and rejection.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkGold, GoldIndex, loadOverrides, overrideTemplate } from "./gold.ts";
import { LIBPOSTAL_FILES, type LibpostalSource } from "./libpostal.ts";
import { lineKey, refineLine, splitFor } from "./lines.ts";
import { rawPath } from "./paths.ts";
import type { RefineResult } from "./refine.ts";

const { values, positionals: queries } = parseArgs({
  allowPositionals: true,
  options: { limit: { type: "string", default: "20" } },
});
if (queries.length === 0) {
  console.error("usage: pnpm data:override <id|text>... [--limit 20]");
  process.exit(1);
}
const limit = Number(values.limit);
const isId = (q: string) => /^[a-z]+:\d+$/.test(q);
const needles = queries.filter((q) => !isId(q)).map((q) => q.toLowerCase());
const ids = new Set(queries.filter(isId));

const overrides = loadOverrides();
const index = new GoldIndex();
const matches: { id: string; line: string; result: RefineResult }[] = [];
const sources = (Object.keys(LIBPOSTAL_FILES) as LibpostalSource[]).filter((s) =>
  existsSync(rawPath(s)),
);
const overriddenTexts = new Set([...overrides.values()].map((o) => o.text));
for (const source of sources) {
  const lines = readFileSync(rawPath(source), "utf8").split("\n").filter(Boolean);
  lines.forEach((line, i) => {
    const result = refineLine(line);
    if (!result) return;
    if (result.ok) index.add(result);
    const id = `${source}:${i}`;
    const text = result.ok ? result.text.toLowerCase() : "";
    const hit = ids.has(id) || (text && needles.some((n) => text.includes(n)));
    if (hit && matches.length < limit) matches.push({ id, line, result });
  });
}

for (const { id, line, result } of matches) {
  if (!result.ok) {
    console.error(`# ${id}: refine rejects it (${result.reason}); no override possible`);
    continue;
  }
  const key = lineKey(line);
  const check = checkGold(result, index);
  const spans = check.spans ?? result.spans;
  const notes = [...new Set([...result.notes, ...check.notes])].join(" ") || "-";
  const existing = overrides.has(key)
    ? " already in overrides/gold.jsonl"
    : overriddenTexts.has(result.text)
      ? " overridden by another line's entry with this text"
      : "";
  const rejected = check.reject ? ` rejected=${check.reject}` : "";
  console.error(
    `# ${id} split=${splitFor({ ...result, spans })} notes=${notes}${rejected}${existing}`,
  );
  console.log(JSON.stringify(overrideTemplate(key, { text: result.text, spans })));
}
