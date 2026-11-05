import { describe, expect, it } from 'vitest';
import * as mock from './data';

/** The mock data stands in for the backend, so it must keep the contract's invariants. */
describe('mock data', () => {
  it('counts services consistently in the overview KPIs', () => {
    const o = mock.overview();
    expect(o.kpis.servicesTotal).toBe(o.services.length);
    expect(o.kpis.servicesUp + o.kpis.servicesSlow + o.kpis.servicesDown).toBe(o.kpis.servicesTotal);
  });

  it('gives every service 48 beats and a down service a null latency', () => {
    for (const s of mock.services) {
      expect(s.beats).toHaveLength(48);
      if (s.status === 'down') expect(s.latencyMs).toBeNull();
    }
  });

  it('filters logs by level, project and text', () => {
    const errors = mock.logs({ query: '', range: '24h', levels: ['error'], project: 'finvault' });
    expect(errors.entries.length).toBeGreaterThan(0);
    expect(errors.entries.every((e) => e.level === 'error' && e.project === 'finvault')).toBe(true);
    const text = mock.logs({ query: 'prisma', range: '24h', levels: [] });
    expect(text.entries.every((e) => e.message.toLowerCase().includes('prisma'))).toBe(true);
  });

  it('links log lines to monitored services', () => {
    const { entries } = mock.logs({ query: 'healthcheck', range: '24h', levels: [] });
    expect(entries[0].serviceId).toBe('fv-invoice-service');
  });

  it('returns null for an unknown service and a detail for a known one', () => {
    expect(mock.serviceDetail('nope')).toBeNull();
    const detail = mock.serviceDetail('fv-invoice-service');
    expect(detail?.downSince).not.toBeNull();
    expect(detail?.checks).toHaveLength(120);
  });

  it('persists rule toggles and acknowledgements', () => {
    mock.setRuleEnabled('r8', true);
    mock.acknowledgeAlert('al_1', 'Looking into it');
    const a = mock.alerts();
    expect(a.rules.find((r) => r.id === 'r8')?.enabled).toBe(true);
    const al1 = a.active.find((x) => x.id === 'al_1');
    expect(al1?.acknowledged).toBe(true);
    expect(al1?.acknowledgedAt).not.toBeNull();
    expect(al1?.notes).toMatchObject([{ kind: 'acknowledged', text: 'Looking into it' }]);
    expect(a.history.find((h) => h.alertId === 'al_1')?.notes).toHaveLength(1);
  });

  it('routes every severity to every configured channel, Telegram included', () => {
    const s = mock.settings();
    const ids = s.channels.map((c) => c.id);
    expect(ids).toContain('telegram');
    for (const severity of ['critical', 'warning', 'info'] as const) {
      expect(Object.keys(s.routing[severity]).sort()).toEqual([...ids].sort());
    }
  });

  it('returns a series per configured line for every metric', () => {
    for (const id of mock.metricIds) {
      const m = mock.metric(id);
      expect(m.series.length).toBeGreaterThan(0);
      m.series.forEach((s) => expect(s.values).toHaveLength(90));
    }
  });
});
