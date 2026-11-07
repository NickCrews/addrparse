/**
 * libpostal's parser training data: gzip'd TSV lines of `language \t country \t tagged`,
 * where `tagged` is space-separated `token/label`. Two labels are separators, not components:
 * `SEP` is literal punctuation from the address template (usually ",") and `FSEP` marks a
 * boundary between fields that the template rendered as a line break (its token text is "|").
 */
export const LIBPOSTAL_SNAPSHOT = "20170304";

/**
 * - openaddresses, osm: full addresses.
 * - ways: OSM street names with the place they are in ("Sled Ct | Palm Coast, Florida"), no
 *   house number.
 * - places: OSM place names alone ("Willistown, Chester County, PA"), sometimes with a ZIP.
 */
export const LIBPOSTAL_FILES = {
  openaddresses: "openaddresses_formatted_addresses_tagged.random.tsv.gz",
  osm: "formatted_addresses_tagged.random.tsv.gz",
  ways: "formatted_ways_tagged.random.tsv.gz",
  places: "formatted_places_tagged.random.tsv.gz",
} as const;

export type LibpostalSource = keyof typeof LIBPOSTAL_FILES;

/**
 * US lines per source that `pnpm data:fetch` downloads and `pnpm data:build` reads; override
 * with `--limit <source>=<n>`. In proportion to SOURCE_WEIGHTS, so all sources run out together.
 */
export const SOURCE_LIMITS: Record<LibpostalSource, number> = {
  openaddresses: 600_000,
  osm: 600_000,
  ways: 90_000,
  places: 60_000,
};

/**
 * Relative share of each source among the lines build.ts reads, in the order it reads them: when
 * two sources have the same text, the one read first keeps it. Each source is written to its own
 * dataset, so these don't set the training mix; `DATASET_WEIGHTS` in eval.config.ts does.
 */
export const SOURCE_WEIGHTS: Record<LibpostalSource, number> = {
  openaddresses: 1,
  osm: 1,
  ways: 0.15,
  places: 0.1,
};

export function isSource(s: string): s is LibpostalSource {
  return Object.hasOwn(LIBPOSTAL_FILES, s);
}

/** Parses `source=number` pairs, as given to `--limit`. */
export function parseSourceNumbers(
  pairs: readonly string[],
): Partial<Record<LibpostalSource, number>> {
  const out: Partial<Record<LibpostalSource, number>> = {};
  for (const pair of pairs) {
    const [source, value, ...rest] = pair.split("=");
    if (!source || !isSource(source) || rest.length) {
      throw new Error(
        `${pair}: expected <source>=<number>, source one of ${Object.keys(LIBPOSTAL_FILES).join(", ")}`,
      );
    }
    const n = Number(value);
    if (value === undefined || value === "" || !Number.isFinite(n) || n < 0) {
      throw new Error(`${pair}: ${value} is not a non-negative number`);
    }
    out[source] = n;
  }
  return out;
}

export function libpostalUrl(source: LibpostalSource): string {
  return `https://archive.org/download/libpostal-parser-training-data-${LIBPOSTAL_SNAPSHOT}/${LIBPOSTAL_FILES[source]}`;
}

export interface LpToken {
  text: string;
  label: string;
}

export interface LpLine {
  language: string;
  country: string;
  tokens: LpToken[];
}

export function parseLine(line: string): LpLine | undefined {
  const [language, country, tagged] = line.split("\t");
  if (language === undefined || country === undefined || !tagged) return undefined;
  const tokens: LpToken[] = [];
  for (const piece of tagged.split(" ")) {
    if (!piece) continue;
    const slash = piece.lastIndexOf("/");
    if (slash <= 0) return undefined;
    tokens.push({ text: piece.slice(0, slash), label: piece.slice(slash + 1) });
  }
  return { language, country, tokens };
}
