/**
 * libpostal's parser training data: gzip'd TSV lines of `language \t country \t tagged`,
 * where `tagged` is space-separated `token/label`. Two labels are separators, not components:
 * `SEP` is literal punctuation from the address template (usually ",") and `FSEP` marks a
 * boundary between fields that the template rendered as a line break (its token text is "|").
 */
export const LIBPOSTAL_SNAPSHOT = "20170304";

export const LIBPOSTAL_FILES = {
  openaddresses: "openaddresses_formatted_addresses_tagged.random.tsv.gz",
  osm: "formatted_addresses_tagged.random.tsv.gz",
} as const;

export type LibpostalSource = keyof typeof LIBPOSTAL_FILES;

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
