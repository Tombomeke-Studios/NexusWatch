import { describe, expect, it } from 'vitest';
import { isRange, parseDuration } from './duration.js';

describe('parseDuration', () => {
  it('reads every retention option the Settings page offers', () => {
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
    expect(parseDuration('90d')).toBe(90 * 86_400_000);
    expect(parseDuration('1y')).toBe(365 * 86_400_000);
    expect(parseDuration('30m')).toBe(1_800_000);
  });

  it('rejects anything it does not understand', () => {
    expect(() => parseDuration('forever')).toThrow(/not a duration/);
    expect(() => parseDuration('')).toThrow();
  });

  it('knows the dashboard time ranges', () => {
    expect(isRange('24h')).toBe(true);
    expect(isRange('2h')).toBe(false);
  });
});
