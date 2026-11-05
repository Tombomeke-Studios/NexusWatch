import type { ChartColor, HealthStatus, LogLevel, ProjectId, Severity } from '@/api/types';

/** Status → colour helpers shared by every page. The design's palette lives in tokens.css. */

export const statusColor: Record<HealthStatus, string> = {
  up: 'var(--c-ok)',
  slow: 'var(--c-warn)',
  down: 'var(--c-down)',
};

export const statusGlow: Record<HealthStatus, string> = {
  up: 'var(--okS)',
  slow: 'var(--warnS)',
  down: 'var(--downS)',
};

/** Foreground colour for text describing a status (latency, uptime). */
export const statusText: Record<HealthStatus, string> = {
  up: 'var(--muted)',
  slow: 'var(--warn)',
  down: 'var(--down)',
};

export const statusPill: Record<HealthStatus, string> = {
  up: 'p-ok',
  slow: 'p-warn',
  down: 'p-down',
};

export const statusLabel: Record<HealthStatus, string> = {
  up: 'online',
  slow: 'slow',
  down: 'down',
};

export const levelPill: Record<LogLevel, string> = {
  error: 'p-down',
  warn: 'p-warn',
  info: 'p-info',
  ok: 'p-ok',
};

export const levelText: Record<LogLevel, string> = {
  error: 'var(--down)',
  warn: 'var(--warn)',
  info: 'var(--primary)',
  ok: 'var(--ok)',
};

export const severityPill: Record<Severity, string> = {
  critical: 'p-down',
  warning: 'p-warn',
  info: 'p-info',
};

export const severityLabel: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

export const projectColor: Record<ProjectId, string> = {
  nexusinfra: 'var(--c-nx)',
  finvault: 'var(--c-fv)',
};

/** Text-safe variant of the project colour (AA on surfaces). */
export const projectText: Record<ProjectId, string> = {
  nexusinfra: 'var(--primary)',
  finvault: 'var(--fv)',
};

export const projectName: Record<ProjectId, string> = {
  nexusinfra: 'NexusInfra',
  finvault: 'FinVault',
};

export const projectPill: Record<ProjectId, string> = {
  nexusinfra: 'p-info',
  finvault: 'p-fv',
};

export function chartColor(c: ChartColor): string {
  return `var(--c-${c})`;
}

/** Meter colour for a utilisation percentage: >85 down, >70 warn, else the given base. */
export function meterColor(pct: number, base = 'var(--c-nx)'): string {
  if (pct > 85) return 'var(--c-down)';
  if (pct > 70) return 'var(--c-warn)';
  return base;
}
