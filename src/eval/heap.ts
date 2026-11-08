/**
 * Peak and total allocation of the V8 heap over a window, from V8's own accounting rather than
 * sampled RSS, so they are stable even for windows of a few milliseconds. "Heap" here includes
 * external memory (ArrayBuffers and typed arrays), where models often keep their weights.
 *
 * Heap bytes allocated come from V8's `total_allocated_bytes` counter, which only grows. Node
 * before 26 doesn't have it, and there `allocated` is undefined.
 * External memory has no such counter, so its allocation is the growth between consecutive
 * collections, summed, from the statistics `v8.GCProfiler` reports before and after each one.
 *
 * The peak is the highest used size seen at the window's start, its end, or just before any
 * collection in it. The used size can also fall between collections: V8 sweeps the pages of a
 * finished mark-compact lazily and on background threads, and dead objects on a page count as
 * used until it is swept, so sweeping left over from before the window lowers the used size
 * inside it. The peak is therefore the rise above the start in V8's used size, which can be
 * less than what the window itself had live by the bytes that sweeping released.
 */
import v8 from "node:v8";

export interface HeapWindow {
  /** Highest heap + external bytes in the window, minus the bytes at its start. */
  peakOverBaseline: number;
  /** Heap + external bytes allocated during the window, including what was collected. */
  allocated?: number;
}

interface Stats {
  usedHeapSize: number;
  externalMemory: number;
}
const used = (s: Stats) => s.usedHeapSize + s.externalMemory;

/** Starts a window now; call the returned function to end it. */
export function startHeapWindow(): () => HeapWindow {
  const profiler = new v8.GCProfiler();
  profiler.start();
  const start = v8.getHeapStatistics();
  return () => {
    const end = v8.getHeapStatistics();
    const gcs = profiler.stop()?.statistics ?? [];
    const startUsed = start.used_heap_size + start.external_memory;
    let peak = Math.max(startUsed, end.used_heap_size + end.external_memory);
    let external = 0;
    let lastExternal = start.external_memory;
    for (const gc of gcs) {
      peak = Math.max(peak, used(gc.beforeGC.heapStatistics));
      external += Math.max(0, gc.beforeGC.heapStatistics.externalMemory - lastExternal);
      lastExternal = gc.afterGC.heapStatistics.externalMemory;
    }
    external += Math.max(0, end.external_memory - lastExternal);
    const total = (s: v8.HeapInfo) =>
      (s as { total_allocated_bytes?: number }).total_allocated_bytes;
    const [a, b] = [total(start), total(end)];
    const allocated = a === undefined || b === undefined ? undefined : b - a + external;
    return { peakOverBaseline: peak - startUsed, allocated };
  };
}
