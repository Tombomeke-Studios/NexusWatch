import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatEur, formatLatency, formatPercent, formatSignedEur, formatWeekly, formatWhen, fromLocalInput, toLocalInput } from './format';

describe('format', () => {
  it('formats euros', () => {
    expect(formatEur(25)).toBe('€25.00');
    expect(formatEur(6.5)).toBe('€6.50');
    expect(formatEur(312.4, true)).toBe('€312');
    expect(formatSignedEur(-12.5)).toBe('- €12.50');
  });

  it('formats percentages without trailing zeros', () => {
    expect(formatPercent(99.98)).toBe('99.98%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(96.4)).toBe('96.4%');
  });

  it('says timeout when a check got no answer', () => {
    expect(formatLatency(null)).toBe('timeout');
    expect(formatLatency(41.6)).toBe('42 ms');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(16 * 60)).toBe('16 min');
    expect(formatDuration(6 * 3600 + 4 * 60)).toBe('6h 4m');
    expect(formatDuration(14 * 86400 + 6 * 3600)).toBe('14d 6h');
  });

  it('formats bytes', () => {
    expect(formatBytes(412 * 1024 ** 2)).toBe('412 MB');
    expect(formatBytes(3.1 * 1024 ** 3)).toBe('3.1 GB');
  });

  it('labels today and yesterday relative to now', () => {
    const now = new Date(2026, 10, 5, 12, 0);
    expect(formatWhen(new Date(2026, 10, 5, 11, 8).toISOString(), now)).toBe('today 11:08');
    expect(formatWhen(new Date(2026, 10, 4, 22, 10).toISOString(), now)).toBe('yesterday 22:10');
    expect(formatWhen(new Date(2026, 8, 4, 21, 40).toISOString(), now)).toBe('4 Sep 21:40');
  });
});

describe('datetime-local values', () => {
  it('round-trips a UTC instant through the local wall clock', () => {
    const iso = new Date(2026, 10, 8, 3, 5).toISOString();
    expect(toLocalInput(iso)).toBe('2026-11-08T03:05');
    expect(fromLocalInput('2026-11-08T03:05')).toBe(iso);
    expect(fromLocalInput('')).toBe('');
    expect(fromLocalInput('nonsense')).toBe('');
  });

  it('names the weekday of a weekly schedule', () => {
    expect(formatWeekly(new Date(2026, 10, 8, 3, 0).toISOString())).toBe('Sun 03:00');
  });
});
