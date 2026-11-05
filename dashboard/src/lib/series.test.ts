import { describe, expect, it } from 'vitest';
import { areaPath, barHeights, linePath, rng, stats, walk } from './series';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays in [0, 1)', () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('walk', () => {
  it('returns n values inside the bounds', () => {
    const values = walk(1, 200, 50, 80, { min: 10, max: 60 });
    expect(values).toHaveLength(200);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...values)).toBeLessThanOrEqual(60);
  });
});

describe('linePath', () => {
  it('maps 0 to the bottom and max to the top with a 2px inset', () => {
    expect(linePath([0, 100], 100, 50)).toBe('M0.0 48.0 L100.0 2.0');
  });

  it('clamps values outside 0..max', () => {
    expect(linePath([-10, 500], 100, 50)).toBe('M0.0 48.0 L100.0 2.0');
  });

  it('stops at `width` when the series is shorter than the chart', () => {
    expect(linePath([0, 0], 100, 50, 100, 40)).toBe('M0.0 48.0 L40.0 48.0');
  });

  it('handles empty and single-value input', () => {
    expect(linePath([], 100, 50)).toBe('');
    expect(linePath([50], 100, 50)).toBe('M0 25.0 L100 25.0');
  });

  it('closes the area along the bottom edge', () => {
    expect(areaPath([0, 100], 100, 50)).toBe('M0.0 48.0 L100.0 2.0 L100 50 L0 50 Z');
  });
});

describe('stats', () => {
  it('computes min/avg/p95/max/last', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(stats(values)).toEqual({ min: 1, avg: 50.5, p95: 95, max: 100, last: 100 });
  });

  it('returns zeros for an empty series rather than NaN', () => {
    expect(stats([])).toEqual({ min: 0, avg: 0, p95: 0, max: 0, last: 0 });
  });
});

describe('barHeights', () => {
  it('scales against the peak', () => {
    expect(barHeights([5, 10, 0])).toEqual([50, 100, 0]);
  });

  it('is all zeros when nothing happened', () => {
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });
});
