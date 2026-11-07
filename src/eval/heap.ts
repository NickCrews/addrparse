/**
 * Peak and total allocation of the V8 heap over a window, from V8's own accounting rather than
 * sampled RSS, so they are stable even for windows of a few milliseconds.
 *
 * Between garbage collections the used heap only grows, so its peak is either the used size
 * just before some collection or the size at the end of the window, and the bytes allocated
 * are the growth between consecutive collections, summed. `v8.GCProfiler` reports the heap
 * statistics before and after every collection in the window. "Heap" here includes external
 * memory (ArrayBuffers and typed arrays), where models often keep their weights.
 */
import v8 from "node:v8";

export interface HeapWindow {
  /** Highest heap + external bytes in the window, minus the bytes at its start. */
  peakOverBaseline: number;
  /** Heap + external bytes allocated during the window, including what was collected. */
  allocated: number;
}

interface Stats {
  usedHeapSize: number;
  externalMemory: number;
}
const used = (s: Stats) => s.usedHeapSize + s.externalMemory;
const current = () => {
  const s = v8.getHeapStatistics();
  return s.used_heap_size + s.external_memory;
};

/** Starts a window now; call the returned function to end it. */
export function startHeapWindow(): () => HeapWindow {
  const profiler = new v8.GCProfiler();
  profiler.start();
  const start = current();
  return () => {
    const end = current();
    const gcs = profiler.stop()?.statistics ?? [];
    let peak = Math.max(start, end);
    let allocated = 0;
    let last = start;
    for (const gc of gcs) {
      const before = used(gc.beforeGC.heapStatistics);
      peak = Math.max(peak, before);
      allocated += Math.max(0, before - last);
      last = used(gc.afterGC.heapStatistics);
    }
    allocated += Math.max(0, end - last);
    return { peakOverBaseline: peak - start, allocated };
  };
}
