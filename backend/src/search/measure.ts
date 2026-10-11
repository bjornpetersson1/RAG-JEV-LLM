/**
 * Runs `work`, returning its result with the elapsed time and the growth in heap and external memory.
 * With `--expose-gc` the memory is collected before both samples, so it counts only what `work`
 * keeps; without it the figure also includes garbage not yet collected.
 */
export function measure<T>(work: () => T): { result: T; elapsedMs: number; memoryBytes: number } {
  const before = usedMemory();
  const start = performance.now();
  const result = work();
  const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
  return { result, elapsedMs, memoryBytes: Math.max(0, usedMemory() - before) };
}

function usedMemory(): number {
  globalThis.gc?.();
  // `external` includes array buffers, among them the WASM memory of roaring bitmaps.
  const { heapUsed, external } = process.memoryUsage();
  return heapUsed + external;
}
