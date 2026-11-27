/**
 * Pure chart helpers. No React, no DOM — every function is unit-tested.
 */

/** Deterministic pseudo-random generator (LCG), so sample data is stable between renders. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export interface WalkOptions {
  drift?: number;
  min?: number;
  max?: number;
}

/** A bounded random walk: `n` values starting near `base`, each step at most `amp / 2` away. */
export function walk(seed: number, n: number, base: number, amp: number, opts: WalkOptions = {}): number[] {
  const { drift = 0, min = 2, max = 98 } = opts;
  const r = rng(seed);
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * amp + drift;
    v = Math.max(min, Math.min(max, v));
    out.push(v);
  }
  return out;
}

/**
 * SVG path for a line chart in a `w × h` viewBox. Values are scaled against `max`
 * (0 at the bottom) with a 2px inset so a stroke at the edge is not clipped.
 * `width` lets a series stop short of the right edge (e.g. a service that went down).
 */
/**
 * `slots`: how many points the whole window holds. A shorter (live, never padded) series is drawn
 * against the right edge — its last point at "now" — instead of being stretched over the full width.
 */
export function linePath(values: readonly number[], w: number, h: number, max = 100, width = w, slots = values.length): string {
  if (values.length === 0) return '';
  const total = Math.max(slots, values.length);
  if (total === 1) {
    const y = yFor(values[0], h, max);
    return `M0 ${y} L${width} ${y}`;
  }
  const step = width / (total - 1);
  const offset = (total - values.length) * step;
  if (values.length === 1) {
    const y = yFor(values[0], h, max);
    return `M${(offset - step / 2).toFixed(1)} ${y} L${width} ${y}`;
  }
  return values.map((v, i) => `${i ? 'L' : 'M'}${(offset + i * step).toFixed(1)} ${yFor(v, h, max)}`).join(' ');
}

/** Same as `linePath`, closed along the bottom edge for an area fill. */
export function areaPath(values: readonly number[], w: number, h: number, max = 100, slots = values.length): string {
  const line = linePath(values, w, h, max, w, slots);
  if (!line) return '';
  // Closes under the first point: at 0 for a full series, where the data starts for a short one.
  const startX = slots > values.length ? (/^M(-?[\d.]+)/.exec(line)?.[1] ?? '0') : '0';
  return `${line} L${w} ${h} L${startX} ${h} Z`;
}

function yFor(v: number, h: number, max: number): string {
  const clamped = Math.max(0, Math.min(max, v));
  return (h - (clamped / max) * (h - 4) - 2).toFixed(1);
}

/** A round upper bound for a chart's y axis: 1, 2, 2.5 or 5 × 10ⁿ above the peak. Never below `floor`. */
export function niceMax(values: readonly number[], floor = 1): number {
  const peak = Math.max(0, ...values);
  if (peak <= floor) return floor;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= peak * 1.1) ?? 10;
  return step * magnitude;
}

export interface SeriesStats {
  min: number;
  avg: number;
  p95: number;
  max: number;
  last: number;
}

/** Summary statistics for a series. `p95` is nearest-rank. Empty input gives all zeros. */
export function stats(values: readonly number[]): SeriesStats {
  if (values.length === 0) return { min: 0, avg: 0, p95: 0, max: 0, last: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const rank = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return { min: sorted[0], avg, p95: sorted[rank], max: sorted[sorted.length - 1], last: values[values.length - 1] };
}

/** Bar heights as percentages of the largest value (the largest bar fills the chart). */
export function barHeights(values: readonly number[]): number[] {
  const peak = Math.max(0, ...values);
  if (peak === 0) return values.map(() => 0);
  return values.map((v) => Math.round((Math.max(0, v) / peak) * 100));
}
