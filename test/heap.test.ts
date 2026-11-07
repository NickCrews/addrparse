import assert from "node:assert/strict";
import { test } from "node:test";
import { startHeapWindow } from "../src/eval/heap.ts";

const MB = 1024 * 1024;

test("counts collected garbage in allocated and retained memory in the peak", () => {
  const end = startHeapWindow();
  const kept: string[] = [];
  // Far more garbage than a young generation holds, so collections run inside the window.
  for (let i = 0; i < 5_000_000; i++) {
    const s = `garbage ${i}`;
    if (i % 50 === 0) kept.push(s);
  }
  const weights = new Float64Array(2 * MB);
  const w = end();
  assert.ok(w.peakOverBaseline >= 16 * MB, `peak ${w.peakOverBaseline / MB} MB`);
  assert.ok(w.allocated >= w.peakOverBaseline);
  assert.ok(w.allocated >= 2 * w.peakOverBaseline, `allocated ${w.allocated / MB} MB`);
  assert.equal(kept.length + weights.length, 100_000 + 2 * MB);
});

test("catches a peak that is freed before the window ends", () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  // The previous test leaves garbage whose sweeping would lower the used size inside the window
  // and hide part of the peak (see src/eval/heap.ts). A collection finishes any sweeping left
  // before it starts, so the second one leaves next to nothing to sweep.
  gc?.();
  gc?.();
  const end = startHeapWindow();
  let transient: Float64Array | undefined = new Float64Array(4 * MB);
  transient[0] = 1;
  transient = undefined;
  gc?.();
  const w = end();
  assert.equal(transient, undefined);
  if (gc) assert.ok(w.peakOverBaseline >= 32 * MB, `peak ${w.peakOverBaseline / MB} MB`);
  assert.ok(w.allocated >= 32 * MB, `allocated ${w.allocated / MB} MB`);
});
