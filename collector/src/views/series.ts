/**
 * Turning stored samples into the fixed-length series the charts draw. Pure, unit-tested.
 *
 * The rule throughout: a missing measurement is never drawn as 0. A series starts at its first
 * measurement inside the window (so a collector that has run for ten minutes returns a short
 * series, not a long row of zeros), and an empty bucket after that repeats the previous value.
 */
import type { Sample } from '../store.js';

/** Average per bucket, oldest first; `null` where a bucket has no sample. */
export function bucketAverages(samples: Sample[], from: number, to: number, buckets: number): (number | null)[] {
  const sums = new Array<number>(buckets).fill(0);
  const counts = new Array<number>(buckets).fill(0);
  const width = (to - from) / buckets;
  for (const s of samples) {
    if (s.ts < from || s.ts > to) continue;
    const i = Math.min(buckets - 1, Math.floor((s.ts - from) / width));
    sums[i] += s.value;
    counts[i]++;
  }
  return sums.map((sum, i) => (counts[i] ? sum / counts[i] : null));
}

/** Drops leading gaps and fills later gaps with the previous value. */
export function fillForward(values: (number | null)[]): number[] {
  const out: number[] = [];
  let last: number | null = null;
  for (const v of values) {
    if (v !== null) last = v;
    if (last !== null) out.push(last);
  }
  return out;
}

/** One filled series per sample series name, in name order. */
export function seriesByName(samples: Sample[], from: number, to: number, buckets: number): { name: string; values: number[] }[] {
  const byName = new Map<string, Sample[]>();
  for (const s of samples) byName.set(s.series, [...(byName.get(s.series) ?? []), s]);
  return [...byName.keys()]
    .sort()
    .map((name) => ({ name, values: fillForward(bucketAverages(byName.get(name)!, from, to, buckets)) }))
    .filter((s) => s.values.length > 0);
}

/**
 * Sum over series per bucket (e.g. requests/s across every scraped service). Each series is
 * averaged and filled on its own first, so a service that was scraped less often is not undercounted.
 */
export function summedSeries(samples: Sample[], from: number, to: number, buckets: number): number[] {
  const parts = seriesByName(samples, from, to, buckets);
  const length = Math.max(0, ...parts.map((p) => p.values.length));
  return Array.from({ length }, (_, i) =>
    parts.reduce((sum, p) => {
      // Right-align: every series ends at "now".
      const j = i - (length - p.values.length);
      return j >= 0 ? sum + p.values[j] : sum;
    }, 0),
  );
}

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export const round = (n: number, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
