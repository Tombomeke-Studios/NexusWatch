import { describe, expect, it } from 'vitest';
import { overallStatus, toPublicStatus, worstStatus } from './publicStatus';

describe('public status', () => {
  it('maps internal health to public wording', () => {
    expect(toPublicStatus('up')).toBe('operational');
    expect(toPublicStatus('slow')).toBe('degraded');
    expect(toPublicStatus('down')).toBe('major-outage');
  });

  it('picks the worst status of a group', () => {
    expect(worstStatus(['operational', 'degraded', 'operational'])).toBe('degraded');
    expect(worstStatus(['degraded', 'major-outage'])).toBe('major-outage');
    expect(worstStatus([])).toBe('operational');
  });

  it('rolls components up into one banner', () => {
    expect(overallStatus(['operational', 'operational'])).toBe('operational');
    expect(overallStatus(['operational', 'degraded'])).toBe('degraded');
    expect(overallStatus(['operational', 'operational', 'major-outage', 'degraded'])).toBe('partial-outage');
    expect(overallStatus(['major-outage', 'operational'])).toBe('major-outage');
    expect(overallStatus(['operational'], true)).toBe('maintenance');
    // An outage outranks maintenance.
    expect(overallStatus(['major-outage', 'operational', 'operational'], true)).toBe('partial-outage');
  });
});
