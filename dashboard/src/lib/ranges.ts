import type { TimeRange } from '@/api/types';

export const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '1h', label: '1h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];

const SPAN: Record<TimeRange, { unit: string; total: number }> = {
  '1h': { unit: 'm', total: 60 },
  '24h': { unit: 'h', total: 24 },
  '7d': { unit: 'd', total: 7 },
  '30d': { unit: 'd', total: 30 },
};

/** Evenly spaced relative axis labels ending in "now", e.g. 24h/5 → -24h -18h -12h -6h now. */
export function axisLabels(range: TimeRange, count = 5): string[] {
  const { unit, total } = SPAN[range];
  return Array.from({ length: count }, (_, i) => {
    if (i === count - 1) return 'now';
    return `-${Math.round(total - (total / (count - 1)) * i)}${unit}`;
  });
}
