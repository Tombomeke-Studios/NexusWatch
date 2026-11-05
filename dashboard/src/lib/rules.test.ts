import { describe, expect, it } from 'vitest';
import type { AlertHistoryItem, AlertRule, EscalationPolicy, MaintenanceWindow, RuleCondition } from '@/api/types';
import {
  compare, draftCondition, draftFromRule, emptyDraft, escalationProgress, evaluateReading, evaluateRule, filterHistory,
  formatCondition, formatCountdown, formatPolicy, formatSpan, isHttpUrl, isWindowActive, metricsFor, parseCondition,
  parseDuration, remainingSeconds, silenceEndsAt, validateDraft, validatePolicy, validateReason, validateWindow,
  windowCovers, windowOccurrence, type Reading,
} from './rules';

const cond = (c: Partial<RuleCondition> = {}): RuleCondition => ({ metric: 'queue_depth', comparator: '>', threshold: 25, forSeconds: 300, ...c });

describe('durations', () => {
  it.each([
    ['', 0], ['90s', 90], ['5m', 300], ['1h30m', 5400], ['2d', 172800], [' 1h 5m ', 3900], ['10M', 600],
  ])('parses %j as %i seconds', (text, seconds) => expect(parseDuration(text)).toBe(seconds));

  it.each(['5', 'm5', '5 minutes', '1.5h', '-5m', '5w'])('rejects %j', (text) => expect(parseDuration(text)).toBeNull());

  it.each([[0, '0s'], [90, '1m30s'], [300, '5m'], [5400, '1h30m'], [21600, '6h'], [90061, '1d1h1m1s']])('formats %i as %s', (s, text) => {
    expect(formatSpan(s)).toBe(text);
    expect(parseDuration(text)).toBe(s);
  });

  it('formats countdowns as m:ss under an hour and h/m above', () => {
    expect(formatCountdown(899)).toBe('14:59');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(-3)).toBe('0:00');
    expect(formatCountdown(4 * 3600 - 60)).toBe('3h 59m');
    expect(formatCountdown(26 * 3600)).toBe('1d 2h');
  });
});

describe('conditions', () => {
  it('formats a condition the way it is written', () => {
    expect(formatCondition(cond())).toBe('queue_ready > 25 for 5m');
    expect(formatCondition(cond({ metric: 'cpu', threshold: 85, forSeconds: 600 }))).toBe('cpu > 85% for 10m');
    expect(formatCondition(cond({ metric: 'topups', comparator: '==', threshold: 0, forSeconds: 21600 }))).toBe('topups == 0 for 6h');
    expect(formatCondition(cond({ metric: 'latency', threshold: 100, forSeconds: 0 }))).toBe('latency_ms > 100');
    expect(formatCondition(cond({ metric: 'error_rate', threshold: 2.5 }))).toBe('error_rate > 2.5% for 5m');
  });

  it('parses what it formats', () => {
    for (const c of [cond(), cond({ metric: 'cpu', comparator: '>=', threshold: 90 }), cond({ metric: 'heartbeat', comparator: '==', threshold: 0, forSeconds: 90 }), cond({ metric: 'latency', forSeconds: 0 })]) {
      expect(parseCondition(formatCondition(c))).toEqual({ ok: true, value: c });
    }
  });

  it('accepts loose spacing and case', () => {
    expect(parseCondition('  CPU>=85 %  FOR 10m ')).toEqual({ ok: true, value: cond({ metric: 'cpu', comparator: '>=', threshold: 85, forSeconds: 600 }) });
  });

  it('explains what is wrong with a condition', () => {
    expect(parseCondition('cpu is high')).toMatchObject({ ok: false, error: expect.stringContaining('metric comparator threshold') });
    expect(parseCondition('ram > 5')).toEqual({ ok: false, error: 'Unknown metric "ram"' });
    expect(parseCondition('queue_ready > 5%')).toEqual({ ok: false, error: 'queue_ready is not a percentage' });
    expect(parseCondition('cpu > 5 for soon')).toMatchObject({ ok: false, error: expect.stringContaining('"soon"') });
  });

  it.each([
    ['>', 5, 4, true], ['>', 4, 4, false], ['>=', 4, 4, true], ['<', 3, 4, true], ['<=', 5, 4, false], ['==', 0, 0, true], ['!=', 0, 0, false],
  ] as const)('%s compares %d against %d → %s', (cmp, v, t, out) => expect(compare(v, cmp, t)).toBe(out));

  it('lists only the metrics measured for a project', () => {
    expect(metricsFor('nexusinfra').map((m) => m.id)).toEqual(['heartbeat', 'latency', 'cpu', 'memory', 'disk']);
    expect(metricsFor('finvault').map((m) => m.id)).toEqual(['heartbeat', 'latency', 'queue_depth', 'error_rate', 'topups']);
  });
});

describe('evaluation', () => {
  const reading = (samples: (number | null)[], stepSeconds = 60): Reading => ({ target: 'wallet.events', project: 'finvault', samples, stepSeconds });

  it('fires once the condition has held for the whole "for" duration', () => {
    expect(evaluateReading(cond(), reading([10, 30, 30, 30, 30, 30]))).toEqual({ target: 'wallet.events', state: 'firing', value: 30, heldSeconds: 300 });
  });

  it('is pending while it has not held long enough', () => {
    expect(evaluateReading(cond(), reading([10, 10, 30, 30]))).toMatchObject({ state: 'pending', heldSeconds: 120 });
  });

  it('is ok when the newest sample does not breach', () => {
    expect(evaluateReading(cond(), reading([30, 30, 30, 10]))).toMatchObject({ state: 'ok', heldSeconds: 0, value: 10 });
  });

  it('treats an unknown sample as no data, never as zero', () => {
    expect(evaluateReading(cond({ comparator: '<', threshold: 5, forSeconds: 0 }), reading([1, null]))).toMatchObject({ state: 'no_data', value: null });
    // an unknown sample in the middle stops the breach run
    expect(evaluateReading(cond({ forSeconds: 180 }), reading([30, 30, null, 30, 30]))).toMatchObject({ state: 'pending', heldSeconds: 120 });
    expect(evaluateReading(cond(), reading([]))).toMatchObject({ state: 'no_data' });
  });

  it('fires on the first breaching sample when there is no "for"', () => {
    expect(evaluateReading(cond({ forSeconds: 0 }), reading([10, 26]))).toMatchObject({ state: 'firing' });
  });

  it('evaluates only the readings of the rule’s project', () => {
    const readings: Reading[] = [reading([40, 40, 40, 40, 40]), { target: 'node-01', project: 'nexusinfra', samples: [99], stepSeconds: 60 }];
    const result = evaluateRule({ project: 'finvault', condition: cond() }, readings);
    expect(result.fires).toBe(true);
    expect(result.targets.map((t) => t.target)).toEqual(['wallet.events']);
    expect(evaluateRule({ project: 'finvault', condition: cond({ threshold: 50 }) }, readings).fires).toBe(false);
  });
});

describe('rule drafts', () => {
  const rule: AlertRule = { id: 'r6', name: 'Queue backing up', project: 'finvault', condition: cond(), severity: 'warning', channels: ['discord'], escalationPolicyId: 'ep1', runbookUrl: 'https://wiki.example/queues', enabled: true };

  it('round-trips a rule through its draft', () => {
    const { errors, rule: out } = validateDraft(draftFromRule(rule));
    expect(errors).toEqual({});
    const { id, ...input } = rule;
    void id;
    expect(out).toEqual(input);
  });

  it('names a duplicate "(copy)"', () => {
    expect(draftFromRule(rule, true).name).toBe('Queue backing up (copy)');
    expect(draftFromRule({ ...rule, name: 'x'.repeat(60) }, true).name).toHaveLength(60);
  });

  it('starts a new rule valid except for its name', () => {
    expect(validateDraft(emptyDraft()).errors).toEqual({ name: 'Give the rule a name' });
  });

  it('reports every invalid field at once', () => {
    const { errors, rule: out } = validateDraft({ ...emptyDraft('nexusinfra'), name: ' ', metric: 'topups', threshold: 'abc', forText: 'soon', channels: [], runbookUrl: 'wiki/page' });
    expect(out).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['channels', 'for', 'metric', 'name', 'runbookUrl', 'threshold']);
    expect(errors.metric).toBe('Top-ups is only measured for FinVault');
  });

  it.each([
    ['cpu', '101', 'CPU cannot be above 100'],
    ['cpu', '-1', 'CPU cannot be below 0'],
    ['heartbeat', '0.5', 'Heartbeat is a whole number'],
    ['heartbeat', '2', 'Heartbeat cannot be above 1'],
    ['cpu', '', 'Enter a threshold'],
  ] as const)('checks a %s threshold of %j', (metric, threshold, message) => {
    expect(validateDraft({ ...emptyDraft('nexusinfra'), name: 'x', metric, threshold }).errors.threshold).toBe(message);
  });

  it('caps the name and the "for" duration', () => {
    expect(validateDraft({ ...emptyDraft(), name: 'x'.repeat(61) }).errors.name).toContain('under 60');
    expect(validateDraft({ ...emptyDraft(), name: 'x', forText: '8d' }).errors.for).toBe('At most 7 days');
  });

  it('trims the name and runbook link', () => {
    expect(validateDraft({ ...emptyDraft(), name: '  Down  ', runbookUrl: ' https://x.example ' }).rule).toMatchObject({ name: 'Down', runbookUrl: 'https://x.example' });
  });

  it('previews the condition only while its fields are valid', () => {
    expect(draftCondition({ ...emptyDraft(), metric: 'cpu', comparator: '>', threshold: '85', forText: '10m' })).toEqual(cond({ metric: 'cpu', threshold: 85, forSeconds: 600 }));
    expect(draftCondition({ ...emptyDraft(), threshold: 'x' })).toBeNull();
    expect(draftCondition({ ...emptyDraft(), forText: 'x' })).toBeNull();
  });

  it('accepts only http(s) links as runbooks', () => {
    expect(isHttpUrl('https://wiki.example/runbook')).toBe(true);
    expect(isHttpUrl('http://localhost:3000')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('wiki/page')).toBe(false);
  });
});

describe('silences', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');

  it('computes the end of a silence', () => {
    expect(silenceEndsAt('15m', now)).toBe('2026-11-05T10:15:00.000Z');
    expect(silenceEndsAt('4h', now)).toBe('2026-11-05T14:00:00.000Z');
    expect(silenceEndsAt('resolved', now)).toBeNull();
  });

  it('counts down to the end and never below zero', () => {
    expect(remainingSeconds('2026-11-05T10:15:00Z', now)).toBe(900);
    expect(remainingSeconds('2026-11-05T09:00:00Z', now)).toBe(0);
    expect(remainingSeconds(null, now)).toBeNull();
  });

  it('requires a reason', () => {
    expect(validateReason('  ')).toBeDefined();
    expect(validateReason('x'.repeat(201))).toBeDefined();
    expect(validateReason('Deploying a fix')).toBeUndefined();
  });
});

describe('maintenance windows', () => {
  const start = '2026-11-01T03:00:00Z'; // a Sunday
  const w: MaintenanceWindow = { id: 'mw', title: 'Backups', project: 'finvault', serviceId: null, startsAt: start, durationMinutes: 120, recurrence: 'none' };
  const at = (iso: string) => Date.parse(iso);

  it('is active only inside a one-off window', () => {
    expect(isWindowActive(w, at('2026-11-01T02:59:00Z'))).toBe(false);
    expect(isWindowActive(w, at('2026-11-01T03:00:00Z'))).toBe(true);
    expect(isWindowActive(w, at('2026-11-01T04:59:00Z'))).toBe(true);
    expect(isWindowActive(w, at('2026-11-01T05:00:00Z'))).toBe(false);
    expect(windowOccurrence(w, at('2026-11-02T00:00:00Z'))).toBeNull();
  });

  it('repeats a weekly window every seven days', () => {
    const weekly = { ...w, recurrence: 'weekly' as const };
    expect(isWindowActive(weekly, at('2026-11-08T04:00:00Z'))).toBe(true);
    expect(isWindowActive(weekly, at('2026-11-09T04:00:00Z'))).toBe(false);
    expect(windowOccurrence(weekly, at('2026-11-09T04:00:00Z'))?.start).toBe(at('2026-11-15T03:00:00Z'));
    expect(windowOccurrence(weekly, at('2026-10-30T00:00:00Z'))?.start).toBe(at(start));
  });

  it('covers a whole project, or one service of it', () => {
    const now = at('2026-11-01T03:30:00Z');
    expect(windowCovers(w, { project: 'finvault', serviceId: 'fv-invoice-service' }, now)).toBe(true);
    expect(windowCovers(w, { project: 'nexusinfra', serviceId: 'nx-api' }, now)).toBe(false);
    const one = { ...w, serviceId: 'fv-wallet-service' };
    expect(windowCovers(one, { project: 'finvault', serviceId: 'fv-invoice-service' }, now)).toBe(false);
    expect(windowCovers(one, { project: 'finvault', serviceId: 'fv-wallet-service' }, now)).toBe(true);
  });

  it('validates title, start and length', () => {
    expect(validateWindow({ title: 'x', startsAt: start, durationMinutes: 60 })).toEqual({});
    expect(Object.keys(validateWindow({ title: '', startsAt: '', durationMinutes: 2 })).sort()).toEqual(['duration', 'startsAt', 'title']);
    expect(validateWindow({ title: 'x', startsAt: start, durationMinutes: 8 * 24 * 60 }).duration).toBe('At most 7 days');
  });
});

describe('escalation', () => {
  const policy: EscalationPolicy = { id: 'ep1', name: 'Default', steps: [{ channel: 'discord', afterMinutes: 0 }, { channel: 'telegram', afterMinutes: 5 }, { channel: 'push', afterMinutes: 15 }] };
  const base = { elapsedSeconds: 0, acknowledgedAfterSeconds: null as number | null, silenced: false, inMaintenance: false };
  const states = (a: Partial<typeof base>) => escalationProgress(policy, { ...base, ...a }).map((s) => s.state);

  it('runs each step once its time has come', () => {
    expect(states({ elapsedSeconds: 0 })).toEqual(['sent', 'upcoming', 'upcoming']);
    expect(states({ elapsedSeconds: 6 * 60 })).toEqual(['sent', 'sent', 'upcoming']);
    expect(escalationProgress(policy, { ...base, elapsedSeconds: 6 * 60 })[2].inSeconds).toBe(9 * 60);
  });

  it('skips the remaining steps once acknowledged', () => {
    expect(states({ elapsedSeconds: 20 * 60, acknowledgedAfterSeconds: 6 * 60 })).toEqual(['sent', 'sent', 'skipped']);
  });

  it('pauses on a silence and suppresses everything in maintenance', () => {
    expect(states({ elapsedSeconds: 60, silenced: true })).toEqual(['sent', 'paused', 'paused']);
    expect(states({ elapsedSeconds: 60, inMaintenance: true })).toEqual(['suppressed', 'suppressed', 'suppressed']);
  });

  it('describes a policy in one line', () => {
    const names = { discord: 'Discord', telegram: 'Telegram', push: 'Push', email: 'Email' } as const;
    expect(formatPolicy(policy.steps, (id) => names[id])).toBe('Discord now → Telegram after 5m → Push after 15m');
  });

  it('validates the steps', () => {
    expect(validatePolicy(policy)).toEqual({});
    expect(validatePolicy({ name: '', steps: [] })).toEqual({ name: expect.any(String), steps: 'Add at least one step' });
    expect(validatePolicy({ name: 'x', steps: [{ channel: 'discord', afterMinutes: 5 }, { channel: 'push', afterMinutes: 5 }] }).steps).toContain('later');
    expect(validatePolicy({ name: 'x', steps: [{ channel: 'discord', afterMinutes: -1 }] }).steps).toBeDefined();
  });
});

describe('history filter', () => {
  const H = (id: string, project: AlertHistoryItem['project'], severity: AlertHistoryItem['severity'], open: boolean): AlertHistoryItem => ({ id, project, severity, open, title: id, startedAt: '', durationSeconds: 0, notes: [] });
  const items = [H('a', 'finvault', 'critical', true), H('b', 'nexusinfra', 'warning', false), H('c', 'finvault', 'warning', false)];
  const ids = (f: Parameters<typeof filterHistory>[1]) => filterHistory(items, f).map((h) => h.id);

  it('filters on project, severity and state together', () => {
    expect(ids({ project: 'all', severity: 'all', state: 'all' })).toEqual(['a', 'b', 'c']);
    expect(ids({ project: 'finvault', severity: 'all', state: 'all' })).toEqual(['a', 'c']);
    expect(ids({ project: 'all', severity: 'warning', state: 'resolved' })).toEqual(['b', 'c']);
    expect(ids({ project: 'finvault', severity: 'all', state: 'open' })).toEqual(['a']);
    expect(ids({ project: 'nexusinfra', severity: 'critical', state: 'all' })).toEqual([]);
  });
});
