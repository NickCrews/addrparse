import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { toSpans as libpostalSpans } from "../impls/libpostal/index.ts";
import { toSpans as usaddressSpans } from "../impls/usaddress/index.ts";
import {
  alignPieces,
  collectPredictions,
  lockedVersions,
  runJsonLines,
} from "../src/eval/reference.ts";
import type { Span } from "../src/types.ts";

/** `[substring, label]` of each span, for readable assertions. */
const show = (text: string, spans: readonly Span[]) =>
  spans.map((s) => [text.slice(s.start, s.end), s.label]);

describe("alignPieces", () => {
  it("matches pieces ignoring case, accents, whitespace and punctuation", () => {
    const text = "2700 Southwest Ek Ro, São Paulo, OR";
    const ranges = alignPieces(text, ["2700", "southwest ek ro", "sao paulo", "or"]);
    assert.deepEqual(
      ranges.map((r) => r && text.slice(r.start, r.end)),
      ["2700", "Southwest Ek Ro", "São Paulo", "OR"],
    );
  });

  it("matches punctuation-only pieces literally and in order", () => {
    const text = "Apt # 4 # 5";
    const ranges = alignPieces(text, ["Apt", "#", "4", "#", "5"]);
    assert.deepEqual(
      ranges.map((r) => r?.start),
      [0, 4, 6, 8, 10],
    );
  });

  it("widens a match over edge punctuation the piece has, not over commas", () => {
    const text = "12 Main St., #5, P.O. Box 9";
    const ranges = alignPieces(text, ["12", "main st.", "#5", "p.o. box 9"]);
    assert.deepEqual(
      ranges.map((r) => r && text.slice(r.start, r.end)),
      ["12", "Main St.", "#5", "P.O. Box 9"],
    );
  });

  it("does not widen over punctuation that belongs to the next piece", () => {
    const text = "Apt#4";
    const ranges = alignPieces(text, ["Apt", "#", "4"]);
    assert.deepEqual(
      ranges.map((r) => r && text.slice(r.start, r.end)),
      ["Apt", "#", "4"],
    );
  });

  it("returns undefined for a piece not found after the previous one", () => {
    assert.deepEqual(alignPieces("Kenai AK", ["AK", "Kenai", "AK"]), [
      { start: 6, end: 8 },
      undefined,
      undefined,
    ]);
  });
});

describe("usaddress toSpans", () => {
  it("maps labels and merges tokens into spans that don't cross commas", () => {
    const text = "1 Lands ' End Ln Apt #4B, Old Town, AK 99501";
    const { spans, unaligned } = usaddressSpans(text, [
      ["1", "AddressNumber"],
      ["Lands", "StreetName"],
      ["End", "StreetName"],
      ["Ln", "StreetNamePostType"],
      ["Apt", "OccupancyType"],
      ["#", "OccupancyIdentifier"],
      ["4B,", "OccupancyIdentifier"],
      ["Old", "PlaceName"],
      ["Town,", "PlaceName"],
      ["AK", "StateName"],
      ["99501", "ZipCode"],
    ]);
    assert.equal(unaligned, 0);
    assert.deepEqual(show(text, spans), [
      ["1", "AddressNumber"],
      ["Lands ' End", "StreetName"],
      ["Ln", "StreetNamePostType"],
      ["Apt #", "OccupancyType"],
      ["4B", "OccupancyIdentifier"],
      ["Old Town", "PlaceName"],
      ["AK", "StateName"],
      ["99501", "ZipCode"],
    ]);
  });

  it("folds labels we don't have into ours or drops them", () => {
    const text = "Attn Bob 12 A Bldg 3 Main St";
    const { spans } = usaddressSpans(text, [
      ["Attn", "Recipient"],
      ["Bob", "Recipient"],
      ["12", "AddressNumber"],
      ["A", "AddressNumberSuffix"],
      ["Bldg", "SubaddressType"],
      ["3", "SubaddressIdentifier"],
      ["Main", "StreetName"],
      ["St", "StreetNamePostType"],
    ]);
    assert.deepEqual(show(text, spans), [
      ["12", "AddressNumber"],
      ["A", "AddressNumberSuffix"],
      ["Bldg", "OccupancyType"],
      ["3", "OccupancyIdentifier"],
      ["Main", "StreetName"],
      ["St", "StreetNamePostType"],
    ]);
  });
});

describe("usaddress # handling", () => {
  it("labels # as the type of the box or unit it was tagged an identifier of", () => {
    const text = "PO Box # 12, Bldg # 4";
    const { spans } = usaddressSpans(text, [
      ["PO", "USPSBoxType"],
      ["Box", "USPSBoxType"],
      ["#", "USPSBoxID"],
      ["12,", "USPSBoxID"],
      ["Bldg", "SubaddressType"],
      ["#", "SubaddressIdentifier"],
      ["4", "SubaddressIdentifier"],
    ]);
    assert.deepEqual(show(text, spans), [
      ["PO Box #", "USPSBoxType"],
      ["12", "USPSBoxID"],
      ["Bldg #", "OccupancyType"],
      ["4", "OccupancyIdentifier"],
    ]);
  });

  it("does not merge same-label pieces across an unlabeled piece", () => {
    const text = "Elm & Oak St";
    const { spans } = usaddressSpans(text, [
      ["Elm", "StreetName"],
      ["&", "IntersectionSeparator"],
      ["Oak", "StreetName"],
      ["St", "StreetNamePostType"],
    ]);
    assert.deepEqual(show(text, spans), [
      ["Elm", "StreetName"],
      ["Oak", "StreetName"],
      ["St", "StreetNamePostType"],
    ]);
  });
});

describe("libpostal toSpans", () => {
  it("splits road, unit and po_box with the gold-label rules and drops removed fields", () => {
    const text = "2700 SW Ek Rd, Apt # 3015, Lee Hall, West Linn, OR 97068";
    const { spans, unaligned } = libpostalSpans(text, [
      ["2700", "house_number"],
      ["sw ek rd", "road"],
      ["apt # 3015", "unit"],
      ["lee hall", "suburb"],
      ["west linn", "city"],
      ["or", "state"],
      ["97068", "postcode"],
    ]);
    assert.equal(unaligned, 0);
    assert.deepEqual(show(text, spans), [
      ["2700", "AddressNumber"],
      ["SW", "StreetNamePreDirectional"],
      ["Ek", "StreetName"],
      ["Rd", "StreetNamePostType"],
      ["Apt #", "OccupancyType"],
      ["3015", "OccupancyIdentifier"],
      ["West Linn", "PlaceName"],
      ["OR", "StateName"],
      ["97068", "ZipCode"],
    ]);
  });

  it("labels a PO box", () => {
    const text = "P.O. Box 298 Towson MD";
    const { spans } = libpostalSpans(text, [
      ["p.o. box 298", "po_box"],
      ["towson", "city"],
      ["md", "state"],
    ]);
    assert.deepEqual(show(text, spans), [
      ["P.O. Box", "USPSBoxType"],
      ["298", "USPSBoxID"],
      ["Towson", "PlaceName"],
      ["MD", "StateName"],
    ]);
  });
});

describe("collectPredictions", () => {
  it("gives a failed text empty spans and records the first error", () => {
    const p = collectPredictions(
      ["Kenai", "bad", "Homer"],
      [[["Kenai", "PlaceName"]], { error: "boom" }, [["Homer", "PlaceName"]]],
      usaddressSpans,
    );
    assert.equal(p.parseErrors, 1);
    assert.match(p.firstError!, /"bad".*boom/);
    assert.deepEqual(p.spans, [
      [{ start: 0, end: 5, label: "PlaceName" }],
      [],
      [{ start: 0, end: 5, label: "PlaceName" }],
    ]);
  });
});

describe("runJsonLines", () => {
  const echo = "process.stdin.on('data', (d) => process.stdout.write(d))";

  it("returns one parsed value per input line", async () => {
    const out = await runJsonLines(process.execPath, ["-e", echo], ["a", 'b "c"']);
    assert.deepEqual(out, ["a", 'b "c"']);
  });

  it("rejects when the process exits non-zero", async () => {
    await assert.rejects(
      runJsonLines(process.execPath, ["-e", "console.error('nope'); process.exit(3)"], ["a"]),
      /exited with 3\nnope/,
    );
  });
});

describe("lockedVersions", () => {
  it("reads package versions from a uv lockfile", () => {
    const dir = mkdtempSync(join(tmpdir(), "addrparse-lock-"));
    const lock = join(dir, "predict.py.lock");
    writeFileSync(
      lock,
      'version = 1\n\n[[package]]\nname = "usaddress"\nversion = "0.5.16"\nsource = {}\n\n' +
        '[[package]]\nname = "six"\nversion = "1.17.0"\n',
    );
    assert.deepEqual(lockedVersions(lock), { usaddress: "0.5.16", six: "1.17.0" });
  });
});
