/**
 * Helpers for reference implementations (`ReferenceImpl`): running a batch subprocess and
 * turning the token strings it returns back into character spans of the input.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Label } from "../labels.ts";
import { mergeAdjacent } from "./accuracy.ts";
import type { Span } from "../types.ts";

/**
 * Runs `command`, writes each input as one JSON string per line to its stdin, and returns one
 * parsed JSON value per stdout line. Rejects when the process fails or the line counts differ.
 */
export function runJsonLines(
  command: string,
  args: readonly string[],
  inputs: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<unknown[]> {
  const child = spawn(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  child.stdin.end(inputs.map((t) => JSON.stringify(t) + "\n").join(""));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-10).join("\n");
        return reject(
          new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}\n${tail}`),
        );
      }
      const lines = stdout.split("\n").filter(Boolean);
      if (lines.length !== inputs.length) {
        return reject(new Error(`${command}: ${inputs.length} inputs but ${lines.length} outputs`));
      }
      resolve(lines.map((l) => JSON.parse(l) as unknown));
    });
  });
}

/** Lowercase, accents removed; every other character is dropped unless it's a letter or digit. */
function fold(s: string): { chars: string; index: number[] } {
  let chars = "";
  const index: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const folded = s[i]!.normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    for (const ch of folded) {
      chars += ch;
      index.push(i);
    }
  }
  return { chars, index };
}

/**
 * Locates each piece in `text`, left to right, and returns its `[start, end)` or undefined
 * when it can't be found after the previous piece. Matching ignores case, accents, whitespace
 * and punctuation, since parsers return normalized tokens ("southwest ek ro", "Ro,"); a match
 * then widens over edge punctuation that is in the piece ("St." covers the period, "Ro," doesn't
 * cover the comma). A piece of only punctuation ("#", "&") is matched literally.
 */
export function alignPieces(
  text: string,
  pieces: readonly string[],
): ({ start: number; end: number } | undefined)[] {
  const t = fold(text);
  let cursor = 0; // offset into `text`
  return pieces.map((piece) => {
    const p = fold(piece).chars;
    if (!p) {
      const literal = piece.trim();
      const start = literal ? text.indexOf(literal, cursor) : -1;
      if (start < 0) return undefined;
      cursor = start + literal.length;
      return { start, end: cursor };
    }
    const from = t.index.findIndex((i) => i >= cursor);
    if (from < 0) return undefined;
    const at = t.chars.indexOf(p, from);
    if (at < 0) return undefined;
    let start = t.index[at]!;
    let end = t.index[at + p.length - 1]! + 1;
    // Widen over edge punctuation the piece itself has ("St.", "#5"), which matching skipped.
    const own = (ch: string | undefined) =>
      ch !== undefined && /[^\s\p{L}\p{N},;]/u.test(ch) && piece.includes(ch);
    while (start > cursor && own(text[start - 1])) start--;
    while (own(text[end])) end++;
    cursor = end;
    return { start, end };
  });
}

/**
 * Spans from `[piece, label]` pairs a parser returned in text order. Consecutive pieces with the
 * same label merge as in mergeAdjacent, but never across a piece mapped to no label ("Elm & Oak"
 * with `&` unlabeled stays two spans), the rule spansFromTokens applies. Pieces that can't be
 * aligned are skipped; `unaligned` counts them.
 */
export function spansFromPieces(
  text: string,
  pieces: readonly (readonly [string, string])[],
  mapLabel: (label: string, piece: string) => Label | undefined,
): { spans: Span[]; unaligned: number } {
  const ranges = alignPieces(
    text,
    pieces.map(([p]) => p),
  );
  const spans: Span[] = [];
  let unaligned = 0;
  let mergeable = false;
  pieces.forEach(([piece, native], i) => {
    const r = ranges[i];
    if (!r) return void unaligned++;
    const label = mapLabel(native, piece);
    if (!label) return void (mergeable = false);
    const merged = mergeable ? mergeAdjacent(text, [spans.at(-1)!, { ...r, label }]) : [];
    if (merged.length === 1) spans[spans.length - 1] = merged[0]!;
    else spans.push({ ...r, label });
    mergeable = true;
  });
  return { spans, unaligned };
}

/** `{ package: version }` of every package in a uv lockfile (`uv lock --script`). */
export function lockedVersions(lockPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lock = readFileSync(lockPath, "utf8");
  for (const m of lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

/**
 * Collects a subprocess's per-text outputs: an array is a parse, anything else
 * (`{"error": ...}`) a failure that gets empty spans. `firstError` names the failed text by its
 * index in `texts`.
 */
export function collectPredictions<T>(
  texts: readonly string[],
  outputs: readonly unknown[],
  toSpans: (text: string, parse: T) => { spans: Span[]; unaligned: number },
) {
  const spans: Span[][] = [];
  let parseErrors = 0;
  let firstError: string | undefined;
  let unaligned = 0;
  outputs.forEach((r, i) => {
    if (!Array.isArray(r)) {
      parseErrors++;
      // The index, not the text, so committed run files hold no example text.
      firstError ??= `text ${i}: ${JSON.stringify(r)}`;
      spans.push([]);
      return;
    }
    const s = toSpans(texts[i]!, r as T);
    unaligned += s.unaligned;
    spans.push(s.spans);
  });
  return { spans, parseErrors, firstError, unaligned };
}
