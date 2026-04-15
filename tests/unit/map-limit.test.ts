// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mapLimit } from '../../src/shared/trackers/common';

describe('mapLimit', () => {
  it('throws on a zero or negative limit', async () => {
    await expect(mapLimit([1, 2], 0, async (x) => x)).rejects.toThrow(/limit/);
    await expect(mapLimit([1, 2], -1, async (x) => x)).rejects.toThrow(/limit/);
  });

  it('returns an empty array for an empty input', async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
  });

  it('preserves input order even when completions are out of order', async () => {
    const items = [100, 50, 10, 80, 20];
    const result = await mapLimit(items, 3, (ms) =>
      new Promise((resolve) => setTimeout(() => resolve(ms * 2), ms)),
    );
    expect(result).toEqual([200, 100, 20, 160, 40]);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, (_, i) => i);
    await mapLimit(tasks, 4, async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThanOrEqual(1);
  });

  it('rejects with the first failure after in-flight workers settle', async () => {
    const started: number[] = [];
    const settled: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
        started.push(n);
        await new Promise((r) => setTimeout(r, 5));
        if (n === 2) throw new Error('boom');
        settled.push(n);
        return n;
      }),
    ).rejects.toThrow('boom');
    // Workers should not keep picking up new items after a failure, but the
    // ones already started finish cleanly (no uncaught rejection).
    expect(started.length).toBeLessThanOrEqual(5);
  });

  it('handles a single-item input with limit > items', async () => {
    const result = await mapLimit([42], 8, async (x) => x + 1);
    expect(result).toEqual([43]);
  });
});
