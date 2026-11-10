import { describe, expect, it } from 'vitest';
import type { AlertRule, AlertRuleInput } from '../types';
import * as mock from './data';

const inputOf = (r: AlertRule): AlertRuleInput => {
  const { id, ...input } = r;
  void id;
  return input;
};
const rule = (id: string) => mock.alerts().rules.find((r) => r.id === id)!;
const status = (code: number) => expect.objectContaining({ status: code });

/** Contract invariants for alerting: rules, silences, maintenance, escalation and history. */
describe('mock alerting', () => {
  it('keeps the summary in step with the active alerts and silences', () => {
    const a = mock.alerts();
    expect(a.summary.critical).toBe(a.active.filter((x) => x.severity === 'critical').length);
    expect(a.summary.warning).toBe(a.active.filter((x) => x.severity === 'warning').length);
    expect(a.summary.muted).toBe(a.silences.length);
    expect(a.summary.inMaintenance).toBe(a.active.filter((x) => x.maintenanceId).length);
    expect(mock.navCounts().openAlerts).toBe(a.active.length);
  });

  it('points every alert at an existing rule and every rule at existing channels and policies', () => {
    const a = mock.alerts();
    const channelIds = mock.settings().channels.map((c) => c.id);
    for (const alert of a.active) expect(a.rules.some((r) => r.id === alert.ruleId)).toBe(true);
    for (const r of a.rules) {
      expect(r.channels.length).toBeGreaterThan(0);
      r.channels.forEach((c) => expect(channelIds).toContain(c));
      if (r.escalationPolicyId) expect(a.policies.some((p) => p.id === r.escalationPolicyId)).toBe(true);
    }
    for (const p of a.policies) p.steps.forEach((s) => expect(channelIds).toContain(s.channel));
  });

  it('marks an alert covered by a maintenance window', () => {
    const a = mock.alerts();
    expect(a.active.find((x) => x.id === 'al_2')?.maintenanceId).toBe('mw_1');
    expect(a.active.find((x) => x.id === 'al_1')?.maintenanceId).toBeNull();
  });

  it('creates, updates, duplicates and deletes a rule', () => {
    const input = inputOf(rule('r6'));
    const copy = mock.createRule({ ...input, name: 'Queue backing up (copy)' });
    expect(copy.id).not.toBe('r6');
    expect(rule(copy.id).name).toBe('Queue backing up (copy)');
    mock.updateRule(copy.id, { ...input, name: 'Queue really backing up', condition: { ...input.condition, threshold: 40 } });
    expect(rule(copy.id)).toMatchObject({ name: 'Queue really backing up', condition: { threshold: 40 } });
    mock.deleteRule(copy.id);
    expect(mock.alerts().rules.some((r) => r.id === copy.id)).toBe(false);
  });

  it('rejects an invalid rule with a 422 instead of storing it', () => {
    const input = inputOf(rule('r1'));
    const count = mock.alerts().rules.length;
    expect(() => mock.createRule({ ...input, name: '' })).toThrow(status(422));
    expect(() => mock.createRule({ ...input, channels: [] })).toThrow(status(422));
    expect(() => mock.createRule({ ...input, condition: { ...input.condition, metric: 'topups' } })).toThrow(status(422));
    expect(() => mock.createRule({ ...input, escalationPolicyId: 'nope' })).toThrow(status(422));
    expect(() => mock.updateRule('nope', input)).toThrow(status(404));
    expect(mock.alerts().rules).toHaveLength(count);
  });

  it('tests a rule against the current data', () => {
    const down = mock.testRule({ project: 'finvault', condition: { metric: 'heartbeat', comparator: '==', threshold: 0, forSeconds: 90 } });
    expect(down.fires).toBe(true);
    expect(down.targets.filter((t) => t.state === 'firing').map((t) => t.serviceId)).toEqual(['fv-invoice-service']);

    const queue = mock.testRule({ project: 'finvault', condition: { metric: 'queue_depth', comparator: '>', threshold: 25, forSeconds: 300 } });
    expect(queue.fires).toBe(false);
    expect(queue.targets.find((t) => t.target === 'wallet.events')?.state).toBe('pending');

    const latency = mock.testRule({ project: 'finvault', condition: { metric: 'latency', comparator: '>', threshold: 10, forSeconds: 0 } });
    expect(latency.targets.find((t) => t.serviceId === 'fv-invoice-service')).toMatchObject({ state: 'no_data', value: null });

    const cpu = mock.testRule({ project: 'nexusinfra', condition: { metric: 'cpu', comparator: '>', threshold: 70, forSeconds: 600 } });
    expect(cpu.targets).toHaveLength(mock.nodes.length);
    expect(cpu.targets.find((t) => t.target.startsWith('node-02'))?.state).toBe('firing');

    expect(mock.testRule({ project: 'nexusinfra', condition: { metric: 'topups', comparator: '==', threshold: 0, forSeconds: 0 } }).targets).toEqual([]);
  });

  it('mutes an alert until resolved, and lifts the silence when it resolves', () => {
    expect(() => mock.createSilence({ kind: 'alert', targetId: 'al_1', duration: '1h', reason: ' ' })).toThrow(status(422));
    const s = mock.createSilence({ kind: 'alert', targetId: 'al_1', duration: 'resolved', reason: 'Fix is deploying' });
    expect(s.endsAt).toBeNull();
    let a = mock.alerts();
    expect(a.active.find((x) => x.id === 'al_1')?.silenceId).toBe(s.id);
    expect(a.summary.muted).toBe(a.silences.length);

    mock.resolveAlert('al_1', 'Restarted the container');
    a = mock.alerts();
    expect(a.active.some((x) => x.id === 'al_1')).toBe(false);
    expect(a.silences.some((x) => x.id === s.id)).toBe(false);
    const h = a.history.find((x) => x.alertId === 'al_1');
    expect(h?.open).toBe(false);
    expect(h?.notes.at(-1)).toMatchObject({ kind: 'resolved', text: 'Restarted the container' });
    expect(mock.navCounts().openAlerts).toBe(a.active.length);
    expect(() => mock.resolveAlert('al_1')).toThrow(status(404));
  });

  it('mutes a rule for a fixed time and unmutes it', () => {
    const before = Date.now();
    const s = mock.createSilence({ kind: 'rule', targetId: 'r4', duration: '15m', reason: 'Tuning the threshold' });
    expect(Date.parse(s.endsAt!) - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(mock.alerts().active.find((x) => x.ruleId === 'r4')?.silenceId).toBe(s.id);
    mock.deleteSilence(s.id);
    expect(mock.alerts().active.find((x) => x.ruleId === 'r4')?.silenceId).toBeNull();
    // r3 has no active alert, so "until resolved" has nothing to wait for
    expect(() => mock.createSilence({ kind: 'rule', targetId: 'r3', duration: 'resolved', reason: 'x' })).toThrow(status(422));
  });

  it('lifts the silences on a rule when the rule is deleted', () => {
    const r = mock.createRule({ ...inputOf(rule('r5')), name: 'Temp' });
    mock.createSilence({ kind: 'rule', targetId: r.id, duration: '4h', reason: 'Testing' });
    expect(mock.alerts().silences.some((s) => s.targetId === r.id)).toBe(true);
    mock.deleteRule(r.id);
    expect(mock.alerts().silences.some((s) => s.targetId === r.id)).toBe(false);
  });

  it('schedules, edits and removes maintenance windows', () => {
    const w = mock.createMaintenance({ title: ' Router swap ', project: 'finvault', serviceId: null, startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 30, recurrence: 'weekly' });
    expect(w.title).toBe('Router swap');
    mock.updateMaintenance(w.id, { ...w, durationMinutes: 45 });
    expect(mock.alerts().maintenance.find((x) => x.id === w.id)?.durationMinutes).toBe(45);
    expect(() => mock.createMaintenance({ ...w, serviceId: 'nx-api-gateway' })).toThrow(status(422));
    expect(() => mock.createMaintenance({ ...w, durationMinutes: 1 })).toThrow(status(422));
    mock.deleteMaintenance(w.id);
    expect(mock.alerts().maintenance.some((x) => x.id === w.id)).toBe(false);
  });

  it('edits escalation policies and detaches a deleted one from its rules', () => {
    const p = mock.createPolicy({ name: 'Night', steps: [{ channel: 'push', afterMinutes: 0 }] });
    mock.updateRule('r5', { ...inputOf(rule('r5')), escalationPolicyId: p.id });
    mock.updatePolicy(p.id, { name: 'Night', steps: [{ channel: 'push', afterMinutes: 0 }, { channel: 'telegram', afterMinutes: 10 }] });
    expect(mock.alerts().policies.find((x) => x.id === p.id)?.steps).toHaveLength(2);
    expect(() => mock.updatePolicy(p.id, { name: 'Night', steps: [] })).toThrow(status(422));
    mock.deletePolicy(p.id);
    expect(rule('r5').escalationPolicyId).toBeNull();
  });

  it('gives every history entry a severity and lists the fired alerts first', () => {
    const { history } = mock.alerts();
    expect(history.slice(0, 2).map((h) => h.alertId)).toEqual(['al_1', 'al_2']);
    history.forEach((h) => expect(['critical', 'warning', 'info']).toContain(h.severity));
  });

  it('returns copies, so callers cannot change the stored state', () => {
    const a = mock.alerts();
    a.rules[0].channels.push('email');
    a.policies[0].steps.pop();
    expect(mock.alerts().rules[0].channels).not.toContain('email');
    expect(mock.alerts().policies[0].steps.length).toBe(a.policies[0].steps.length + 1);
  });
});

/** The collector stores this snapshot so alerting writes survive a restart. */
describe('mock alerting state snapshot', () => {
  it('restores rules, silences, windows, policies, acks and notes from plain JSON', () => {
    const before = mock.alertingState();
    try {
      const created = mock.createRule({ ...inputOf(rule('r5')), name: 'Snapshot me' });
      const alertId = mock.alerts().active[0].id;
      mock.acknowledgeAlert(alertId, 'On it');
      const saved = JSON.parse(JSON.stringify(mock.alertingState())) as ReturnType<typeof mock.alertingState>;

      mock.restoreAlertingState(before);
      expect(mock.alerts().rules.some((r) => r.id === created.id)).toBe(false);
      expect(mock.alerts().active.find((a) => a.id === alertId)?.acknowledged).toBe(false);

      mock.restoreAlertingState(saved);
      const after = mock.alerts();
      expect(after.rules.find((r) => r.id === created.id)?.name).toBe('Snapshot me');
      const alert = after.active.find((a) => a.id === alertId)!;
      expect(alert.acknowledged).toBe(true);
      expect(alert.notes.map((n) => n.text)).toContain('On it');
      // Ids keep counting from where the snapshot left off, so a new rule never reuses one.
      expect(mock.createRule({ ...inputOf(rule('r5')), name: 'After restore' }).id).not.toBe(created.id);
    } finally {
      mock.restoreAlertingState(before);
    }
  });

  it('is a copy: changing the snapshot does not change the state', () => {
    const snap = mock.alertingState();
    snap.rules.length = 0;
    expect(mock.alerts().rules.length).toBeGreaterThan(0);
  });
});
