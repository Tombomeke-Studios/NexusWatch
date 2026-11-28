import type { CSSProperties } from 'react';
import type { HealthStatus, Series } from '@/api/types';
import { areaPath, barHeights, linePath } from '@/lib/series';
import { chartColor, statusColor } from '@/lib/status';

const GRID_ROWS = 4;

function GridLines({ w, h }: { w: number; h: number }) {
  return (
    <g className="gl">
      {Array.from({ length: GRID_ROWS + 1 }, (_, i) => {
        const y = i === 0 ? 0.5 : i === GRID_ROWS ? h - 0.5 : (h / GRID_ROWS) * i;
        return <line key={i} x1="0" y1={y} x2={w} y2={y} />;
      })}
    </g>
  );
}

export function Legend({ series, style }: { series: Pick<Series, 'name' | 'color'>[]; style?: CSSProperties }) {
  return (
    <div className="legend" style={style}>
      {series.map((s) => (
        <span key={s.name}>
          <i style={{ background: chartColor(s.color) }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

export function XAxis({ labels, style }: { labels: string[]; style?: CSSProperties }) {
  return (
    <div className="xax" style={style}>
      {labels.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

interface LineChartProps {
  series: Series[];
  label: string;
  height?: number;
  max?: number;
  yLabels?: string[];
  xLabels?: string[];
  /** Fill the area under the first series. */
  area?: boolean;
  /** Shaded "outage" band at the right, as a fraction of the width (0–1). */
  dangerFrom?: number;
  /** Fraction of the width the data spans (the rest is left empty, e.g. no answers). */
  span?: number;
  /** Points in the whole window: a shorter live series is drawn against the right edge ("now"). */
  slots?: number;
}

/** Multi-series line chart, scaled to its container width. */
export function LineChart({ series, label, height = 200, max = 100, yLabels, xLabels, area, dangerFrom, span = 1, slots }: LineChartProps) {
  const W = 900;
  const H = height;
  const gutter = yLabels ? 44 : 0;
  const gradientId = `area-${label.replace(/\W/g, '')}`;
  return (
    <div>
      <div style={{ position: 'relative', paddingLeft: gutter }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ width: '100%', height: H, display: 'block' }}>
          {area && series[0] && (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: chartColor(series[0].color), stopOpacity: 0.34 }} />
                <stop offset="1" style={{ stopColor: chartColor(series[0].color), stopOpacity: 0 }} />
              </linearGradient>
            </defs>
          )}
          <GridLines w={W} h={H} />
          {dangerFrom !== undefined && <rect x={W * dangerFrom} y="0" width={W * (1 - dangerFrom)} height={H} style={{ fill: 'var(--c-down)', opacity: 0.14 }} />}
          {area && series[0] && <path d={areaPath(series[0].values, W, H, max, slots)} fill={`url(#${gradientId})`} />}
          {series.map((s) => (
            <path key={s.name} d={linePath(s.values, W, H, max, W * span, slots)} className="ln" style={{ stroke: chartColor(s.color) }} />
          ))}
        </svg>
        {yLabels && (
          <div className="yax">
            {yLabels.map((y, i) => (
              <span key={i}>{y}</span>
            ))}
          </div>
        )}
      </div>
      {xLabels && <XAxis labels={xLabels} style={{ paddingLeft: gutter }} />}
    </div>
  );
}

export function Sparkline({ values, color, label, height = 28, max = 100 }: { values: number[]; color: string; label: string; height?: number; max?: number }) {
  const W = 160;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ width: '100%', height }}>
      <path d={linePath(values, W, height, max)} className="ln" style={{ stroke: color }} />
    </svg>
  );
}

/** Vertical bars; the newest bar is fully opaque. Heights are relative to the peak. */
export function BarChart({ values, color, height = 120, label, slots = values.length }: { values: number[]; color: string; height?: number; label: string; slots?: number }) {
  const heights = barHeights(values);
  // A shorter (live) series keeps its bars at the right, under "now", with empty slots before it.
  const empty = Math.max(0, slots - values.length);
  return (
    <div className="bars" role="img" aria-label={label} style={{ height }}>
      {Array.from({ length: empty }, (_, i) => <span key={`e${i}`} style={{ height: 0 }} />)}
      {heights.map((h, i) => (
        <span key={i} style={{ height: `${h}%`, background: color, opacity: i === heights.length - 1 ? 1 : 0.78 }} />
      ))}
    </div>
  );
}

/** Row of status cells (heartbeats, checks, days). `null` is a cell without data — drawn empty, never as up. */
export function StatusStrip({ statuses, height = 22, gap = 2, radius = 2 }: { statuses: readonly (HealthStatus | null)[]; height?: number; gap?: number; radius?: number }) {
  return (
    <div className="strip" aria-hidden="true" style={{ height, gap }}>
      {statuses.map((s, i) => (
        <span key={i} style={{ background: s ? statusColor[s] : 'var(--border)', borderRadius: radius }} />
      ))}
    </div>
  );
}

export function Meter({ pct, color, height = 6, style }: { pct: number; color: string; height?: number; style?: CSSProperties }) {
  return (
    <div className="bar" style={{ height, ...style }}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function StackBar({ parts, label, height = 16 }: { parts: { pct: number; color: string }[]; label: string; height?: number }) {
  return (
    <div className="stack" role="img" aria-label={label} style={{ height }}>
      {parts.map((p, i) => (
        <span key={i} style={{ width: `${p.pct}%`, background: p.color }} />
      ))}
    </div>
  );
}
