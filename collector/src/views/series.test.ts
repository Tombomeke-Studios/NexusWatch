import { describe, expect, it } from 'vitest';
import { bucketAverages, fillForward, percentile, seriesByName, summedSeries } from './series.js';

const s = (series: string, ts: number, value: number) => ({ series, ts, value });

describe('series helpers', () => {
  it('averages per bucket and leaves empty buckets null', () => {
    expect(bucketAverages([s('a', 0, 2), s('a', 1, 4), s('a', 35, 9)], 0, 40, 4)).toEqual([3, null, null, 9]);
  });

  it('never pads with zeros: starts at the first value and repeats the last one', () => {
    expect(fillForward([null, null, 5, null, 7])).toEqual([5, 5, 7]);
    expect(fillForward([null, null])).toEqual([]);
  });

  it('builds one series per name and drops names with no data in the window', () => {
    const out = seriesByName([s('b', 5, 1), s('a', 5, 2), s('c', 500, 3)], 0, 40, 4);
    expect(out.map((x) => x.name)).toEqual(['a', 'b']);
    expect(out[0].values).toHaveLength(4);
  });

  it('sums series right-aligned to now', () => {
    expect(summedSeries([s('a', 5, 1), s('a', 35, 1), s('b', 35, 2)], 0, 40, 4)).toEqual([1, 1, 1, 3]);
  });

  it('takes a nearest-rank percentile', () => {
    expect(percentile([10, 20, 30, 40, 100], 95)).toBe(100);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([], 95)).toBeNull();
  });
});
