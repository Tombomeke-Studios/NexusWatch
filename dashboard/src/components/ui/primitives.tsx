import type { CSSProperties, ReactNode } from 'react';
import type { HealthStatus } from '@/api/types';
import { statusColor, statusGlow } from '@/lib/status';

export function Pill({ tone, children, plain, style }: { tone: string; children: ReactNode; plain?: boolean; style?: CSSProperties }) {
  return (
    <span className={`pill ${tone}${plain ? ' plain' : ''}`} style={style}>
      {children}
    </span>
  );
}

/** Coloured status dot; `ring` adds the soft halo used in lists, `live` pulses. */
export function StatusDot({ status, ring, live, size = 8, color }: { status?: HealthStatus; ring?: boolean; live?: boolean; size?: number; color?: string }) {
  const bg = color ?? (status ? statusColor[status] : 'var(--c-ok)');
  return (
    <span
      className={`dot${live ? ' live' : ''}`}
      aria-hidden="true"
      style={{ width: size, height: size, flex: `0 0 ${size}px`, background: bg, boxShadow: ring && status ? `0 0 0 4px ${statusGlow[status]}` : undefined }}
    />
  );
}

export function Swatch({ color, size = 9, style }: { color: string; size?: number; style?: CSSProperties }) {
  return <span className="sq" aria-hidden="true" style={{ background: color, width: size, height: size, flex: `0 0 ${size}px`, ...style }} />;
}

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
}

/** Segmented control (the design's `.seg`). `role="tablist"` when it switches panels. */
export function Segmented<T extends string>({
  options, value, onChange, label, mono, small, tabs,
}: { options: readonly SegmentOption<T>[]; value: T; onChange: (v: T) => void; label: string; mono?: boolean; small?: boolean; tabs?: boolean }) {
  return (
    <div className={`seg${mono ? ' mono' : ''}${small ? ' sm' : ''}`} role={tabs ? 'tablist' : 'group'} aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.id === value ? 'on' : ''}
          onClick={() => onChange(o.id)}
          {...(tabs ? { role: 'tab', 'aria-selected': o.id === value } : { 'aria-pressed': o.id === value })}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** A KPI tile: label, big number, optional unit and a footnote or trend underneath. */
export function Kpi({ label, value, unit, valueColor, foot, accent, labelColor, swatch, valueStyle }: {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  valueColor?: string;
  foot?: ReactNode;
  accent?: 'nx' | 'fv';
  labelColor?: string;
  swatch?: string;
  valueStyle?: CSSProperties;
}) {
  return (
    <div className={`box kpi${accent ? ` bd-${accent}` : ''}`}>
      <div className="lbl" style={{ color: labelColor }}>
        {swatch && <Swatch color={swatch} />}
        {label}
      </div>
      <div className="baseline">
        <span className="num v" style={{ color: valueColor, ...valueStyle }}>{value}</span>
        {unit !== undefined && <span className="num subtle" style={{ fontSize: 18 }}>{unit}</span>}
      </div>
      {foot && <div className="muted small">{foot}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children, icon }: { title: string; subtitle?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="head">
      {icon}
      <div className="grow">
        <h1 className="t">{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {children}
    </header>
  );
}
