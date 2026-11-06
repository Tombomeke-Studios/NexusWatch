import { describe, expect, it } from 'vitest';
import { NAV, isMoreActive, isNavActive, moreItems, tabItems, titleFor } from './nav';

describe('nav', () => {
  it('has four bottom tabs, so "More" is the fifth', () => {
    expect(tabItems().map((i) => i.label)).toEqual(['Overview', 'Heartbeats', 'Logs', 'Alerts']);
  });

  it('puts every non-tab entry in the More sheet', () => {
    expect(moreItems().map((i) => i.label)).toEqual(['Metrics', 'NexusInfra', 'FinVault', 'Settings']);
    expect(tabItems().length + moreItems().length).toBe(NAV.length);
  });

  it('matches "/" exactly and other entries by prefix', () => {
    const overview = NAV[0];
    expect(isNavActive(overview, '/')).toBe(true);
    expect(isNavActive(overview, '/logs')).toBe(false);
    const logs = NAV.find((i) => i.label === 'Logs')!;
    expect(isNavActive(logs, '/logs')).toBe(true);
    expect(isNavActive(logs, '/logs/anything')).toBe(true);
    expect(isNavActive(logs, '/logsx')).toBe(false);
  });

  it('marks More active for pages that live in the sheet', () => {
    expect(isMoreActive('/settings')).toBe(true);
    expect(isMoreActive('/projects/finvault')).toBe(true);
    expect(isMoreActive('/alerts')).toBe(false);
    expect(isMoreActive('/')).toBe(false);
  });

  it('titles the top bar from the nav, with fallbacks', () => {
    expect(titleFor('/')).toBe('Overview');
    expect(titleFor('/projects/nexusinfra')).toBe('NexusInfra');
    expect(titleFor('/services/fv-api')).toBe('Service');
    expect(titleFor('/nope')).toBe('NexusWatch');
  });
});
