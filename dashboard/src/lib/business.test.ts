import { describe, expect, it } from 'vitest';
import type { AccountStanding } from '@/api/types';
import { creditState, describeDlq, formatHoursLeft, maskEmail, sortByHoursLeft } from './business';

const account = (patch: Partial<AccountStanding>): AccountStanding => ({
  accountId: 'acc_1', planId: 'starter', balanceEur: 10, availableEur: 8, canRun: true, hoursLeft: 100, runningServers: 1, lowCreditWarnedAt: null, ...patch,
});

describe('maskEmail', () => {
  it('keeps one letter of the name and of the domain', () => {
    expect(maskEmail('tom@example.com')).toBe('t***@e***.com');
    expect(maskEmail('a.b@mail.co.uk')).toBe('a***@m***.uk');
  });

  it('is idempotent, so an already-masked value stays the same', () => {
    expect(maskEmail(maskEmail('tom@example.com'))).toBe('t***@e***.com');
  });

  it('never shows something that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('creditState', () => {
  it('is out when the account cannot run', () => {
    expect(creditState(account({ canRun: false, hoursLeft: 0 }), 24)).toBe('out');
  });

  it('is low under LOW_CREDIT_HOURS and ok at or above it', () => {
    expect(creditState(account({ hoursLeft: 23.5 }), 24)).toBe('low');
    expect(creditState(account({ hoursLeft: 24 }), 24)).toBe('ok');
  });

  it('is idle — not infinite, not zero — with nothing running', () => {
    expect(creditState(account({ hoursLeft: null, runningServers: 0 }), 24)).toBe('idle');
  });
});

describe('sortByHoursLeft', () => {
  it('puts accounts that cannot run first, then the shortest runway, nothing-running last', () => {
    const sorted = sortByHoursLeft([
      account({ accountId: 'idle', hoursLeft: null }),
      account({ accountId: 'long', hoursLeft: 400 }),
      account({ accountId: 'out', canRun: false, hoursLeft: 0 }),
      account({ accountId: 'short', hoursLeft: 3 }),
    ]);
    expect(sorted.map((a) => a.accountId)).toEqual(['out', 'short', 'long', 'idle']);
  });
});

describe('formatHoursLeft', () => {
  it('writes hours under two days and days above, and no estimate as a dash', () => {
    expect(formatHoursLeft(5.4)).toBe('5 h');
    expect(formatHoursLeft(0.4)).toBe('< 1 h');
    expect(formatHoursLeft(72)).toBe('3 d');
    expect(formatHoursLeft(null)).toBe('—');
  });
});

describe('describeDlq', () => {
  it('says unknown, never zero, when the broker could not be asked', () => {
    expect(describeDlq(null)).toMatch(/unknown/);
  });

  it('counts waiting messages and names the empty case', () => {
    expect(describeDlq(0)).toBe('No failed events.');
    expect(describeDlq(1)).toMatch(/^1 event could not/);
    expect(describeDlq(3)).toMatch(/^3 events could not/);
  });
});
