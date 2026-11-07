/** The JSON the build embeds in the page (`<script id="page-data">`) for the playground. */
import type { Span } from "../src/types.ts";
import type { EmbeddedModel } from "./parsers.ts";

export interface DemoSet {
  id: string;
  title: string;
  texts: string[];
}

export interface DemoRow {
  gold: Span[];
  /** Whether each in-page model's parse equals gold, as `pnpm eval` scores it. */
  exact: Record<string, boolean>;
}

export interface PageData {
  labels: string[];
  /** The playground parses with the first one. */
  embedded: EmbeddedModel[];
  /** Presets in dropdown order; the first is loaded when the page opens. */
  demo: { sets: DemoSet[]; rows: Record<string, DemoRow> };
}
