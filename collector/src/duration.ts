/** Durations as the Settings page writes them: `7d`, `14d`, `90d`, `1y`, also `12h` and `30m`. */
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 365 * 86_400_000 };

/** Parses `14d` → milliseconds. Throws on anything else, so a typo never means "keep forever". */
export function parseDuration(text: string): number {
  const m = /^(\d+)\s*([mhdwy])$/.exec(text.trim());
  if (!m) throw new Error(`not a duration: "${text}" (expected e.g. 14d, 90d, 1y)`);
  return Number(m[1]) * UNIT_MS[m[2]];
}

/** Window length of each dashboard time range. */
export const RANGE_MS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
export type Range = keyof typeof RANGE_MS;

export function isRange(value: unknown): value is Range {
  return typeof value === 'string' && value in RANGE_MS;
}
