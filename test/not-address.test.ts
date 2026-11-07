import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  embed,
  junkSplitKey,
  junkText,
  notAddressExamples,
  rngFor,
} from "../src/data/not-address.ts";
import { labelAt, spansFromTokens, tokenize } from "../src/tokens.ts";
import type { Example } from "../src/types.ts";

const kenai: Example = {
  id: "openaddresses:1",
  text: "12 Main St, Kenai, AK",
  spans: [
    { start: 0, end: 2, label: "AddressNumber" },
    { start: 3, end: 7, label: "StreetName" },
    { start: 8, end: 10, label: "StreetNamePostType" },
    { start: 12, end: 17, label: "PlaceName" },
    { start: 19, end: 21, label: "StateName" },
  ],
  source: "openaddresses",
};

/** Every token is covered by exactly one span, spans are sorted and disjoint. */
function assertWellFormed(ex: Example) {
  ex.spans.forEach((s, i) => {
    assert.ok(s.start < s.end && s.end <= ex.text.length, `${ex.text}: bad span`);
    if (i > 0) assert.ok(ex.spans[i - 1]!.end <= s.start, `${ex.text}: overlap`);
  });
  for (const t of tokenize(ex.text)) {
    const covering = ex.spans.filter((s) => s.start <= t.coreStart && t.coreStart < s.end);
    assert.equal(covering.length, 1, `${ex.text}: token at ${t.coreStart} uncovered`);
  }
  // Spans are what a token-level model would produce from the per-token labels.
  const tokens = tokenize(ex.text);
  const rebuilt = spansFromTokens(
    tokens,
    tokens.map((t) => labelAt(ex.spans, t)),
  );
  assert.deepEqual(rebuilt, ex.spans, ex.text);
}

describe("notAddressExamples", () => {
  const all = Array.from({ length: 2000 }, (_, i) =>
    notAddressExamples(
      { ...kenai, id: `openaddresses:${i}` },
      { junkRate: 0.5, embeddedRate: 0.5, seed: 1 },
    ),
  ).flat();

  it("is deterministic for a given seed and example id", () => {
    const opts = { junkRate: 1, embeddedRate: 1, seed: 7 };
    assert.deepEqual(notAddressExamples(kenai, opts), notAddressExamples(kenai, opts));
    assert.notDeepEqual(
      notAddressExamples(kenai, opts),
      notAddressExamples(kenai, { ...opts, seed: 8 }),
    );
  });

  it("generates about the configured rate of each kind", () => {
    const junk = all.filter((e) => e.source === "junk").length;
    const embedded = all.filter((e) => e.source === "embedded").length;
    assert.ok(junk > 900 && junk < 1100, `junk ${junk}`);
    assert.ok(embedded > 900 && embedded < 1100, `embedded ${embedded}`);
  });

  it("generates nothing at rate zero", () => {
    assert.deepEqual(notAddressExamples(kenai, { junkRate: 0, embeddedRate: 0, seed: 1 }), []);
  });

  it("labels every junk token NotAddress", () => {
    for (const ex of all.filter((e) => e.source === "junk")) {
      assertWellFormed(ex);
      assert.ok(
        ex.spans.every((s) => s.label === "NotAddress"),
        ex.text,
      );
    }
  });

  it("keeps the embedded address's spans on the same text", () => {
    for (const ex of all.filter((e) => e.source === "embedded")) {
      assertWellFormed(ex);
      const address = ex.spans.filter((s) => s.label !== "NotAddress");
      assert.deepEqual(
        address.map((s) => [ex.text.slice(s.start, s.end), s.label]),
        kenai.spans.map((s) => [kenai.text.slice(s.start, s.end), s.label]),
      );
      assert.ok(ex.text.includes(kenai.text), ex.text);
    }
  });

  it("does not embed examples that already contain NotAddress", () => {
    const query: Example = {
      ...kenai,
      text: "cafes in Kenai",
      spans: [
        { start: 0, end: 8, label: "NotAddress" },
        { start: 9, end: 14, label: "PlaceName" },
      ],
    };
    const out = notAddressExamples(query, { junkRate: 0, embeddedRate: 1, seed: 1 });
    assert.deepEqual(out, []);
  });
});

describe("embed", () => {
  it("uppercases the surrounding text of an all-caps address", () => {
    const caps = { ...kenai, text: kenai.text.toUpperCase() };
    for (let i = 0; i < 50; i++) {
      const ex = embed(caps, rngFor(String(i)));
      assert.equal(ex.text, ex.text.toUpperCase());
    }
  });
});

describe("junkSplitKey", () => {
  it("gives variants of one name or phone number the same key", () => {
    assert.equal(junkSplitKey("Sandra Baker"), junkSplitKey("Baker, Sandra"));
    assert.equal(junkSplitKey("SANDRA M. BAKER"), junkSplitKey("sandra baker"));
    assert.equal(junkSplitKey("212.555.0173"), junkSplitKey("+1 (212) 555-0173"));
    assert.notEqual(junkSplitKey("Sandra Baker"), junkSplitKey("Sandra Allen"));
  });
});

describe("junkText", () => {
  it("covers placeholders, emails and phone numbers", () => {
    const texts = Array.from({ length: 500 }, (_, i) => junkText(rngFor(`j${i}`)));
    assert.ok(texts.some((t) => t.includes("@")));
    assert.ok(texts.some((t) => /555[-. ]?01\d\d/.test(t)));
    assert.ok(texts.some((t) => /^(n\/a|none|unknown)$/i.test(t)));
    assert.ok(texts.some((t) => /^(Mary|James) [A-Z][a-z]+$/.test(t)));
    assert.ok(texts.some((t) => /^\w+ \w+ \w+$/.test(t) && !/\d/.test(t)));
  });
});
