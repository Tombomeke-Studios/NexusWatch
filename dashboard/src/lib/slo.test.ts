import { describe, expect, it } from 'vitest';
import {
  BURN_RULES, attainment, budgetRemaining, burnDown, burnRate, burnThreshold, errorBudgetMinutes, evaluateBurnAlerts,
  remainingBudgetMinutes, sloState, sumTallies, tallyStatuses, timeToExhaustionMinutes,
} from './slo';

const T = (good: number, bad: number, unknown = 0) => ({ good, bad, unknown });

describe('tallies', () => {
  it('counts up and slow as good, down as bad and null as unknown', () => {
    expect(tallyStatuses(['up', 'slow', 'down', null, 'up', null])).toEqual(T(3, 1, 2));
  });

  it('sums tallies', () => {
    expect(sumTallies([T(1, 2, 3), T(4, 5, 6)])).toEqual(T(5, 7, 9));
    expect(sumTallies([])).toEqual(T(0, 0, 0));
  });
});

describe('attainment', () => {
  it('is the share of good checks among answered checks', () => {
    expect(attainment(T(999, 1))).toBeCloseTo(99.9);
  });

  it('excludes unknown checks instead of counting them as up or down', () => {
    expect(attainment(T(999, 1, 5000))).toBeCloseTo(99.9);
  });

  it('is null without a single answered check', () => {
    expect(attainment(T(0, 0, 120))).toBeNull();
  });
});

describe('error budget', () => {
  it('allows 43.2 minutes per 30 days at 99.9%', () => {
    expect(errorBudgetMinutes(99.9, 30)).toBeCloseTo(43.2);
    expect(errorBudgetMinutes(99.5, 30)).toBeCloseTo(216);
  });

  it('has the whole budget left without failures', () => {
    expect(budgetRemaining(99.9, T(1000, 0))).toBe(1);
    expect(remainingBudgetMinutes(99.9, 30, T(1000, 0))).toBeCloseTo(43.2);
  });

  it('has half the budget left at half the allowed error rate', () => {
    expect(budgetRemaining(99.9, T(1_999, 1))).toBeCloseTo(0.5);
    expect(remainingBudgetMinutes(99.9, 30, T(1_999, 1))).toBeCloseTo(21.6);
  });

  it('goes negative when the budget is overspent', () => {
    expect(budgetRemaining(99.9, T(9_980, 20))).toBeCloseTo(-1);
    expect(remainingBudgetMinutes(99.9, 30, T(9_980, 20))).toBeCloseTo(-43.2);
  });

  it('does not let unknown checks spend or save budget', () => {
    expect(budgetRemaining(99.9, T(1_999, 1, 40_000))).toBeCloseTo(0.5);
  });

  it('is unknown without data', () => {
    expect(budgetRemaining(99.9, T(0, 0, 10))).toBeNull();
    expect(remainingBudgetMinutes(99.9, 30, T(0, 0))).toBeNull();
  });

  it('rejects a target of 100% (no budget to divide by)', () => {
    expect(() => budgetRemaining(100, T(1, 0))).toThrow(RangeError);
    expect(() => errorBudgetMinutes(0, 30)).toThrow(RangeError);
  });
});

describe('burn rate', () => {
  it('is 1 when errors arrive exactly at the allowed rate', () => {
    expect(burnRate(99.9, T(999, 1))).toBeCloseTo(1);
  });

  it('is 0 without errors and scales with the error rate', () => {
    expect(burnRate(99.9, T(500, 0))).toBe(0);
    expect(burnRate(99.9, T(98, 2))).toBeCloseTo(20);
  });

  it('ignores unknown checks and is null without answered checks', () => {
    expect(burnRate(99, T(99, 1, 900))).toBeCloseTo(1);
    expect(burnRate(99.9, T(0, 0, 12))).toBeNull();
  });

  it('derives the Google SRE thresholds for a 30-day window', () => {
    expect(burnThreshold(0.02, 30, 1)).toBeCloseTo(14.4);
    expect(burnThreshold(0.05, 30, 6)).toBeCloseTo(6);
    expect(burnThreshold(0.1, 30, 24)).toBeCloseTo(3);
  });
});

describe('time to exhaustion', () => {
  it('divides the budget left by the current error rate', () => {
    // 43.2 min left, burning at 10× on a 99.9% target = 0.01 bad minutes per minute.
    expect(timeToExhaustionMinutes(43.2, 10, 99.9)).toBeCloseTo(4320);
  });

  it('never runs out when nothing burns', () => {
    expect(timeToExhaustionMinutes(43.2, 0, 99.9)).toBe(Infinity);
  });

  it('is already exhausted when nothing is left', () => {
    expect(timeToExhaustionMinutes(0, 3, 99.9)).toBe(0);
    expect(timeToExhaustionMinutes(-12, 3, 99.9)).toBe(0);
  });

  it('is unknown when the budget or the burn rate is unknown', () => {
    expect(timeToExhaustionMinutes(null, 3, 99.9)).toBeNull();
    expect(timeToExhaustionMinutes(10, null, 99.9)).toBeNull();
  });
});

describe('multi-window burn alerts', () => {
  const quiet = { '5m': 0, '30m': 0, '1h': 0, '2h': 0, '6h': 0, '24h': 0 } as const;

  it('fires the fast-burn page only when the long and short window both burn', () => {
    expect(evaluateBurnAlerts({ ...quiet, '1h': 20, '5m': 20 }, 30).map((a) => a.id)).toEqual(['fast']);
    // Long window still high after recovery: the short window resets the alert.
    expect(evaluateBurnAlerts({ ...quiet, '1h': 20, '5m': 0 }, 30)).toEqual([]);
    // A short spike alone is not enough.
    expect(evaluateBurnAlerts({ ...quiet, '1h': 2, '5m': 50 }, 30)).toEqual([]);
  });

  it('fires the slow-burn ticket at 3× over a day', () => {
    const alerts = evaluateBurnAlerts({ ...quiet, '24h': 3.5, '2h': 4 }, 30);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: 'slow', severity: 'warning', longBurn: 3.5, shortBurn: 4 });
  });

  it('never fires on an unknown window', () => {
    expect(evaluateBurnAlerts({ ...quiet, '1h': null, '5m': 100, '6h': 100, '30m': null }, 30)).toEqual([]);
  });

  it('scales thresholds with the SLO window', () => {
    // A 7-day SLO: 2% of 168 h in 1 h = 3.36×.
    expect(evaluateBurnAlerts({ ...quiet, '1h': 4, '5m': 4 }, 7).map((a) => a.id)).toEqual(['fast']);
    expect(BURN_RULES.map((r) => r.id)).toEqual(['fast', 'medium', 'slow']);
  });
});

describe('burn-down', () => {
  it('starts full and ends at the window budget remaining', () => {
    const days = [T(1000, 0), T(999, 1), T(1000, 0), T(998, 2, 50)];
    const points = burnDown(99.9, days);
    expect(points).toHaveLength(4);
    expect(points[0]).toBeCloseTo(1);
    expect(points.at(-1)).toBeCloseTo(budgetRemaining(99.9, sumTallies(days))!);
  });

  it('never rises and goes negative past exhaustion', () => {
    const points = burnDown(99.9, [T(1000, 0), T(995, 5), T(990, 10)]);
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeLessThanOrEqual(points[i - 1]);
    expect(points.at(-1)!).toBeLessThan(0);
  });

  it('carries the previous value through a day with only unknown checks', () => {
    expect(burnDown(99.9, [T(1_999, 1), T(0, 0, 2880)])).toEqual([expect.closeTo(0.5), expect.closeTo(0.5)]);
  });

  it('is empty without data', () => {
    expect(burnDown(99.9, [T(0, 0, 10)])).toEqual([]);
  });
});

describe('sloState', () => {
  it('reads unknown, breached, at risk and healthy', () => {
    expect(sloState(null, [])).toBe('unknown');
    expect(sloState(-0.2, [])).toBe('breached');
    expect(sloState(0.1, [])).toBe('at-risk');
    expect(sloState(0.9, [{ id: 'slow' } as never])).toBe('at-risk');
    expect(sloState(0.9, [])).toBe('healthy');
  });
});
