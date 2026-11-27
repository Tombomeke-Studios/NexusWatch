import { describe, expect, it } from 'vitest';
import { monitorId, validateMonitor } from './monitors';

describe('validateMonitor', () => {
  it('accepts a service by container name or LAN address, with a default interval', () => {
    expect(validateMonitor({ name: ' Gateway ', project: 'finvault', url: 'http://finvault-gateway:8000/health' })).toEqual({
      ok: true,
      value: { name: 'Gateway', project: 'finvault', url: 'http://finvault-gateway:8000/health', intervalSeconds: 30 },
    });
    expect(validateMonitor({ name: 'Panel', project: 'nexusinfra', url: 'http://192.168.0.117:8096', intervalSeconds: 60 }).ok).toBe(true);
  });

  it('names the field that is wrong', () => {
    expect(validateMonitor({ name: '', project: 'finvault', url: 'http://a' })).toMatchObject({ ok: false, field: 'name' });
    expect(validateMonitor({ name: 'x', project: 'other', url: 'http://a' })).toMatchObject({ ok: false, field: 'project' });
    expect(validateMonitor({ name: 'x', project: 'finvault', url: 'ftp://a' })).toMatchObject({ ok: false, field: 'url' });
    expect(validateMonitor({ name: 'x', project: 'finvault', url: 'http://169.254.169.254/' })).toMatchObject({ ok: false, field: 'url' });
    expect(validateMonitor({ name: 'x', project: 'finvault', url: 'http://a', intervalSeconds: 7 })).toMatchObject({ ok: false, field: 'intervalSeconds' });
  });
});

describe('monitorId', () => {
  it('slugs the name and avoids ids in use', () => {
    expect(monitorId('FinVault Gateway', [])).toBe('m-finvault-gateway');
    expect(monitorId('FinVault Gateway', ['m-finvault-gateway'])).toBe('m-finvault-gateway-2');
    expect(monitorId('!!!', [])).toBe('m-monitor');
  });
});
