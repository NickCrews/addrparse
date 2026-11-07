/** HTML helpers shared by the build-time renderer (page.ts) and the page's script (app.ts). */
import type { Span } from "../src/types.ts";

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * `text` with each span as a box holding its text and label, in the style of spaCy's displaCy
 * entity view. The stylesheet colors each box by label.
 */
export function entsHtml(text: string, spans: readonly Span[]): string {
  let out = "";
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    out += esc(text.slice(at, s.start));
    out +=
      `<mark class="ent" data-label="${s.label}">${esc(text.slice(s.start, s.end))}` +
      `<span class="ent-label">${s.label}</span></mark>`;
    at = s.end;
  }
  return out + esc(text.slice(at));
}
