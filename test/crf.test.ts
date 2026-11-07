import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForwardBackward } from "../impls/crf/forward-backward.ts";
import { Features, Tokens } from "../impls/crf/features.ts";
import impl from "../impls/crf/index.ts";
import {
  CrfParser,
  NONE,
  STATES,
  decode,
  encode,
  goldStates,
  spansFromStates,
} from "../impls/crf/model.ts";
import { Viterbi, transIndex } from "../impls/crf/viterbi.ts";
import type { Label } from "../src/labels.ts";
import { tokenize } from "../src/tokens.ts";
import { asScoredParse, type Example, type Span } from "../src/types.ts";

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    return ((s >>> 8) & 0xffff) / 0x10000;
  };
}

/** Every state sequence of length n over L states. */
function* sequences(n: number, L: number): Generator<number[]> {
  if (n === 0) {
    yield [];
    return;
  }
  for (const rest of sequences(n - 1, L)) for (let y = 0; y < L; y++) yield [...rest, y];
}

/** Score of a state sequence, or -Infinity when it uses a disallowed transition. */
function pathScore(seq: number[], emit: Float64Array, trans: Float64Array, allowed: Uint8Array) {
  const L = emit.length / seq.length;
  let s = 0;
  for (let i = 0; i <= seq.length; i++) {
    const t = transIndex(L, i === 0 ? L : seq[i - 1]!, i === seq.length ? L : seq[i]!);
    if (!allowed[t]) return -Infinity;
    s += trans[t]!;
    if (i < seq.length) s += emit[i * L + seq[i]!]!;
  }
  return s;
}

/** A random chain problem whose allowed transitions always admit a path (state 0 loops). */
function chain(seed: number, n: number, L: number) {
  const r = random(seed);
  const emit = Float64Array.from({ length: n * L }, () => r() * 4 - 2);
  const trans = Float64Array.from({ length: (L + 1) ** 2 }, () => r() * 4 - 2);
  const allowed = Uint8Array.from({ length: (L + 1) ** 2 }, () => (r() < 0.6 ? 1 : 0));
  allowed[transIndex(L, L, 0)] = allowed[transIndex(L, 0, 0)] = allowed[transIndex(L, 0, L)] = 1;
  return { emit, trans, allowed };
}

describe("Tokens", () => {
  it("matches tokenize from src/tokens.ts", () => {
    const texts = [
      "",
      "  ",
      "12  Main St",
      "Kenai, AK;",
      "P.O. Box #12, 1,096",
      ", ; ,",
      "a b c\td\ne",
      ",lead trail,, ;both;",
    ];
    const t = new Tokens();
    for (const text of texts) {
      t.tokenize(text);
      const got = Array.from({ length: t.n }, (_, i) => [
        t.start[i],
        t.end[i],
        t.coreStart[i],
        t.coreEnd[i],
      ]);
      const want = tokenize(text).map((k) => [k.start, k.end, k.coreStart, k.coreEnd]);
      assert.deepEqual(got, want, JSON.stringify(text));
    }
  });

  it("grows past its initial capacity", () => {
    const t = new Tokens();
    t.tokenize("x ".repeat(200));
    assert.equal(t.n, 200);
    assert.equal(t.coreStart[199], 398);
  });
});

describe("Features", () => {
  it("gives the same features to the same text and differs by context", () => {
    const fx = new Features();
    const feats = (text: string) => {
      const n = fx.extract(text);
      return Array.from(fx.feats.subarray(0, fx.offs[n]));
    };
    assert.deepEqual(feats("12 Main St"), feats("12 Main St"));
    assert.notDeepEqual(feats("12 Main St"), feats("12 Main St, Kenai"));
    assert.ok(feats("12 Main St").every((f) => f !== 0));
  });
});

describe("Viterbi", () => {
  it("finds the highest-scoring allowed path", () => {
    const L = 4;
    for (let seed = 1; seed <= 30; seed++) {
      const n = 1 + (seed % 5);
      const { emit, trans, allowed } = chain(seed, n, L);
      const out = new Uint8Array(n);
      const score = new Viterbi(L, trans, allowed).decode(emit, n, out);
      let best = -Infinity;
      for (const seq of sequences(n, L))
        best = Math.max(best, pathScore(seq, emit, trans, allowed));
      assert.ok(Math.abs(score - best) < 1e-9, `seed ${seed}`);
      assert.ok(Math.abs(pathScore([...out], emit, trans, allowed) - best) < 1e-9);
    }
  });
});

describe("ForwardBackward", () => {
  it("computes log Z and node marginals over the allowed paths", () => {
    const L = 4;
    for (let seed = 1; seed <= 20; seed++) {
      const n = 1 + (seed % 4);
      const { emit, trans, allowed } = chain(seed, n, L);
      const fb = new ForwardBackward(L, allowed);
      fb.setTransitions(trans);
      fb.run(emit, n);
      let z = 0;
      const marg = new Float64Array(n * L);
      for (const seq of sequences(n, L)) {
        const p = Math.exp(pathScore(seq, emit, trans, allowed));
        z += p;
        seq.forEach((y, i) => (marg[i * L + y]! += p));
      }
      assert.ok(Math.abs(fb.logZ - Math.log(z)) < 1e-9, `seed ${seed}`);
      for (let k = 0; k < n * L; k++) assert.ok(Math.abs(fb.node[k]! - marg[k]! / z) < 1e-9);
    }
  });
});

describe("states", () => {
  const example = (text: string, parts: [string, Label][]): Example => {
    let from = 0;
    const spans: Span[] = parts.map(([s, label]) => {
      const start = text.indexOf(s, from);
      from = start + s.length;
      return { start, end: from, label };
    });
    return { id: text, text, spans, source: "test" };
  };

  it("round-trips gold spans, including adjacent spans of one label", () => {
    const examples = [
      example("12 Main St, Kenai, AK", [
        ["12", "AddressNumber"],
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
        ["Kenai", "PlaceName"],
        ["AK", "StateName"],
      ]),
      example("4 Elm St Sub Basement Unit No 650", [
        ["4", "AddressNumber"],
        ["Elm", "StreetName"],
        ["St", "StreetNamePostType"],
        ["Sub Basement", "OccupancyType"],
        ["Unit No", "OccupancyType"],
        ["650", "OccupancyIdentifier"],
      ]),
      example("Unit 107 10 L - Kenai", [
        ["Unit", "OccupancyType"],
        ["107", "OccupancyIdentifier"],
        ["10 L", "OccupancyIdentifier"],
        ["Kenai", "PlaceName"],
      ]),
    ];
    const t = new Tokens();
    const states = new Uint8Array(16);
    for (const ex of examples) {
      t.tokenize(ex.text);
      goldStates(t, ex.spans, states);
      assert.deepEqual(spansFromStates(t, states), ex.spans, ex.text);
    }
    t.tokenize("Unit 107 10 L - Kenai");
    goldStates(t, examples[2]!.spans, states);
    assert.equal(states[4], NONE);
    assert.notEqual(states[2], states[1]);
  });
});

describe("model format", () => {
  it("round-trips weights within quantization error and drops small ones", () => {
    const r = random(7);
    const nf = 50;
    const keys = Int32Array.from({ length: nf }, (_, k) => (k * 0x9e3779b1) | 0 || 1);
    const weights = Float32Array.from({ length: nf * STATES }, () =>
      r() < 0.7 ? 0 : (r() - 0.5) * 10,
    );
    weights.fill(0.0001, 0, STATES); // feature 0 has only tiny weights
    const T = (STATES + 1) ** 2;
    const trans = Float32Array.from({ length: T }, (_, k) => (k % 3 === 0 ? -Infinity : k / T));
    const p = decode(encode({ keys, weights, trans }, 0.001));

    assert.deepEqual(Array.from(p.trans), Array.from(trans));
    const scale = 5 / 32767;
    const byKey = new Map(Array.from(p.keys, (key, k) => [key, k]));
    assert.ok(!byKey.has(keys[0]!));
    for (let f = 1; f < nf; f++) {
      const k = byKey.get(keys[f]!);
      const got = new Float64Array(STATES);
      if (k !== undefined) {
        for (let e = p.rowPtr[k]!; e < p.rowPtr[k + 1]!; e++) got[p.states[e]!] = p.values[e]!;
      }
      for (let y = 0; y < STATES; y++) {
        assert.ok(Math.abs(got[y]! - weights[f * STATES + y]!) <= scale, `feature ${f} state ${y}`);
      }
    }
  });
});

describe("crf impl", () => {
  const texts: [string, [string, Label][]][] = [
    [
      "12 Main St, Kenai, AK 99611",
      [
        ["12", "AddressNumber"],
        ["Main", "StreetName"],
        ["St", "StreetNamePostType"],
        ["Kenai", "PlaceName"],
        ["AK", "StateName"],
        ["99611", "ZipCode"],
      ],
    ],
    [
      "400 Oak Ave, Homer, AK 99603",
      [
        ["400", "AddressNumber"],
        ["Oak", "StreetName"],
        ["Ave", "StreetNamePostType"],
        ["Homer", "PlaceName"],
        ["AK", "StateName"],
        ["99603", "ZipCode"],
      ],
    ],
    [
      "PO Box 77, Nome, AK 99762",
      [
        ["PO Box", "USPSBoxType"],
        ["77", "USPSBoxID"],
        ["Nome", "PlaceName"],
        ["AK", "StateName"],
        ["99762", "ZipCode"],
      ],
    ],
  ];
  const examples: Example[] = [];
  for (let k = 0; k < 20; k++) {
    for (const [text, parts] of texts) {
      let from = 0;
      const spans = parts.map(([s, label]) => {
        const start = text.indexOf(s, from);
        from = start + s.length;
        return { start, end: from, label };
      });
      examples.push({ id: `${k}:${text}`, text, spans, source: "test" });
    }
  }
  const log = () => {};

  it("learns its training set and trains deterministically", async () => {
    const a = await impl.train(examples, { seed: 3, log });
    const b = await impl.train(examples, { seed: 3, log });
    assert.deepEqual(a.model, b.model);
    const parser = impl.load(a.model);
    assert.ok(parser instanceof CrfParser);
    for (const ex of examples.slice(0, 3)) {
      const { spans, confidence } = asScoredParse(parser.parse(ex.text));
      assert.deepEqual(spans, ex.spans);
      assert.ok(confidence! > 0.5 && confidence! <= 1, `confidence ${confidence}`);
    }
    assert.deepEqual(parser.parse(""), { spans: [], confidence: 1 });
  });
});
