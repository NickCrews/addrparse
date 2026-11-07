/** The JSON the build embeds in the page (`<script id="page-data">`) for the playground. */
import type { Span } from "../src/types.ts";
import type { EmbeddedModel } from "./parsers.ts";

export interface DemoSet {
  id: string;
  /** Dropdown group, e.g. "Slices". */
  group: string;
  title: string;
  description: string;
  texts: string[];
}

export interface DemoRow {
  gold: Span[];
  /** Whether each model's parse equals gold, as `pnpm eval` scores it. */
  exact: Record<string, boolean>;
  /** Parses of models that can't run in the page (the Python references), from their eval run. */
  spans: Record<string, Span[]>;
}

export interface PageData {
  labels: string[];
  /** Every model the playground offers, in display order. */
  models: { impl: string; inPage: boolean }[];
  embedded: EmbeddedModel[];
  demo: { sets: DemoSet[]; rows: Record<string, DemoRow> };
}
