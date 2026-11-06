import { useSlos } from '@/api/queries';
import { Card, CardHeader } from '@/components/ui/Card';
import { Meter } from '@/components/ui/charts';
import { Pill } from '@/components/ui/primitives';
import { formatBudgetMinutes, formatBurn, formatExhaustion, formatPercent } from '@/lib/format';
import { summarizeSlo } from '@/lib/slo';
import { projectColor, sloStateLabel, sloStatePill, sloStateText } from '@/lib/status';
import { routes } from '@/routes';

/** A service's SLO in one small card (Service detail). Renders nothing for a service without an SLO. */
export function SloCard({ serviceId }: { serviceId: string }) {
  const slo = useSlos().data?.slos.find((s) => s.serviceId === serviceId);
  if (!slo) return null;
  const s = summarizeSlo(slo);
  const stat = { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px', minWidth: 0 } as const;
  return (
    <Card padded labelledBy="slo-card">
      <CardHeader
        flat
        id="slo-card"
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>SLO <Pill tone={sloStatePill[s.state]}>{sloStateLabel[s.state]}</Pill></span>}
        hint={`${slo.targetPct}% over ${slo.windowDays} days · ${slo.objective.toLowerCase()}`}
        link={{ to: routes.sloFor(serviceId), label: 'Burn-down' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px' }}>
        <div style={stat}>
          <span className="lbl">Attained</span>
          <span className="num" style={{ fontSize: 22, color: sloStateText[s.state] }}>{s.attainment === null ? 'no data' : formatPercent(s.attainment, 3)}</span>
        </div>
        <div style={stat}>
          <span className="lbl">Budget left</span>
          <span className="num" style={{ fontSize: 22, color: sloStateText[s.state] }}>{formatBudgetMinutes(s.remainingMinutes)}</span>
          <Meter pct={(s.remaining ?? 0) * 100} color={s.state === 'breached' ? 'var(--c-down)' : s.state === 'at-risk' ? 'var(--c-warn)' : projectColor[slo.project]} height={5} />
        </div>
        <div style={stat}>
          <span className="lbl">Burn 1h · 6h · 24h</span>
          <span className="num mono" style={{ fontSize: 17, fontWeight: 500 }}>
            {formatBurn(s.burn['1h'])} · {formatBurn(s.burn['6h'])} · {formatBurn(s.burn['24h'])}
          </span>
        </div>
        <div style={stat}>
          <span className="lbl">Runs out in</span>
          <span className="num" style={{ fontSize: 22 }}>{formatExhaustion(s.exhaustionMinutes)}</span>
          {s.alerts.length > 0 && <span className="small" style={{ color: 'var(--down)' }}>{s.alerts.map((a) => a.label).join(', ')}</span>}
        </div>
      </div>
    </Card>
  );
}
