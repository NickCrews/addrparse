/** HTML helpers shared by the build-time renderer (page.ts) and the page's script (app.ts). */
import type { Span } from "../src/types.ts";

export const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** `text` with each span wrapped in a `<mark>` that the stylesheet colors by label. */
export function spansHtml(text: string, spans: readonly Span[]): string {
  let out = "";
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    out += esc(text.slice(at, s.start));
    out +=
      `<mark class="lab" data-label="${s.label}" title="${s.label}">` +
      `${esc(text.slice(s.start, s.end))}</mark>`;
    at = s.end;
  }
  return out + esc(text.slice(at));
}
