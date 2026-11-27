import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSlos } from '@/api/queries';
import type { ChartColor, Slo } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { Legend, LineChart, Meter } from '@/components/ui/charts';
import { Kpi, PageHeader, Pill, Swatch } from '@/components/ui/primitives';
import { EmptyState, QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatBudgetMinutes, formatBurn, formatExhaustion, formatNumber, formatPercent } from '@/lib/format';
import { BURN_RULES, burnThreshold, summarizeSlo, type SloSummary } from '@/lib/slo';
import { projectColor, severityPill, sloStateLabel, sloStatePill, sloStateText } from '@/lib/status';
import { routes } from '@/routes';
import '@/styles/reliability.css';

interface Row {
  slo: Slo;
  s: SloSummary;
}

const PROJECT_SERIES: Record<Slo['project'], ChartColor> = { nexusinfra: 'nx', finvault: 'fv' };
const RULE_HOURS = { fast: 1, medium: 6, slow: 24 } as const;

/** Lowest budget left first; SLOs without data last. */
const byRisk = (a: Row, b: Row) => (a.s.remaining ?? Infinity) - (b.s.remaining ?? Infinity);

export function SloPage() {
  const query = useSlos();
  return (
    <>
      <PageHeader title="SLOs" subtitle={<>Availability objectives and error budgets per service, rolling window{config.useMocks && ' · sample data'}</>}>
        <button type="button" className="btn pri" disabled title="Every monitored service has one; the target is the collector's NW_SLO_TARGET">+ New SLO</button>
      </PageHeader>
      <QueryState query={query} skeletonHeight={900}>
        {(data) => <SloBody slos={data.slos} />}
      </QueryState>
    </>
  );
}

function SloBody({ slos }: { slos: Slo[] }) {
  const rows = useMemo(() => slos.map((slo) => ({ slo, s: summarizeSlo(slo) })).sort(byRisk), [slos]);
  const [params, setParams] = useSearchParams();
  const selected = rows.find((r) => r.slo.serviceId === params.get('service')) ?? rows[0];
  const count = (state: SloSummary['state']) => rows.filter((r) => r.s.state === state).length;
  const burning = rows.filter((r) => r.s.alerts.length > 0);
  const alertCount = burning.reduce((n, r) => n + r.s.alerts.length, 0);

  if (rows.length === 0) return <Card><EmptyState>No SLOs defined yet.</EmptyState></Card>;

  return (
    <>
      <section className="kpis" aria-label="Summary">
        <Kpi label="On target" value={count('healthy')} unit={`/ ${rows.length}`} foot="budget left and no burn alert" />
        <Kpi label="At risk" value={count('at-risk')} valueColor={count('at-risk') ? 'var(--warn)' : undefined} foot="under 25% left, or burning" />
        <Kpi label="Breached" value={count('breached')} valueColor={count('breached') ? 'var(--down)' : undefined} foot={rows.filter((r) => r.s.state === 'breached').map((r) => r.slo.name).join(', ') || 'none'} />
        <Kpi label="Burn alerts" value={alertCount} valueColor={alertCount ? 'var(--down)' : undefined} foot={burning.length ? `${burning.length} ${burning.length === 1 ? 'service' : 'services'} burning` : 'all quiet'} />
      </section>

      {burning.length > 0 && (
        <section aria-label="Burn alerts" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {burning.map(({ slo, s }) => (
            <article key={slo.id} className={`box acard ${s.alerts[0].severity}`}>
              <div style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <Pill tone={severityPill[s.alerts[0].severity]}>{s.alerts[0].severity === 'critical' ? 'Page' : 'Ticket'}</Pill>
                  <Swatch color={projectColor[slo.project]} />
                  <Link to={routes.service(slo.serviceId)} style={{ fontWeight: 600, color: 'var(--text)' }}>{slo.name}</Link>
                  <span className="muted">· {s.alerts.map((a) => a.label.toLowerCase()).join(', ')}</span>
                </div>
                {s.alerts.map((alert) => (
                  <div key={alert.id} className="muted small">
                    <span className="mono">{formatBurn(alert.longBurn)}</span> over {alert.long} and <span className="mono">{formatBurn(alert.shortBurn)}</span> over {alert.short}, both
                    above <span className="mono">{formatBurn(alert.threshold)}</span>: {alert.budgetFraction * 100}% of the {slo.windowDays}-day budget in {alert.long}.
                  </div>
                ))}
              </div>
              <div style={{ flex: '1 1 160px' }}>
                <div className="lbl">Budget runs out in</div>
                <div className="num" style={{ fontSize: 22, color: sloStateText[s.state] }}>{formatExhaustion(s.exhaustionMinutes)}</div>
              </div>
            </article>
          ))}
        </section>
      )}

      <Card labelledBy="eb">
        <CardHeader
          id="eb"
          title="Error budgets"
          hint="pick a service for its burn-down"
          end={
            <div className="legend">
              <span><Swatch color="var(--c-nx)" />NexusInfra</span>
              <span><Swatch color="var(--c-fv)" />FinVault</span>
            </div>
          }
        />
        <div className="tbl">
          <div className="tr th slo-tr" aria-hidden="true">
            <span style={{ flex: '2 1 170px' }}>Service</span>
            <span style={{ flex: '0 0 64px' }} className="r">Target</span>
            <span style={{ flex: '0 0 84px' }} className="r">Attained</span>
            <span style={{ flex: '1 1 150px' }}>Budget left</span>
            <span style={{ flex: '0 0 156px' }} className="burns"><span>1h</span><span>6h</span><span>24h</span></span>
            <span style={{ flex: '0 0 92px' }} className="r">Runs out</span>
            <span style={{ flex: '0 0 80px' }} className="r">State</span>
          </div>
          {rows.map(({ slo, s }) => {
            const isSel = slo.id === selected.slo.id;
            return (
              <button
                key={slo.id}
                type="button"
                className={`tr slo-tr${isSel ? ' sel' : ''}`}
                aria-pressed={isSel}
                aria-label={`${slo.name}: ${sloStateLabel[s.state]}, ${formatBudgetMinutes(s.remainingMinutes)} of budget left`}
                onClick={() => setParams({ service: slo.serviceId }, { replace: true })}
              >
                <span style={{ flex: '2 1 170px', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Swatch color={projectColor[slo.project]} />
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slo.name}</span>
                </span>
                <span style={{ flex: '0 0 64px' }} className="r mono">{slo.targetPct}%</span>
                <span style={{ flex: '0 0 84px', color: sloStateText[s.state] }} className="r mono">{s.attainment === null ? 'no data' : formatPercent(s.attainment, 3)}</span>
                <span style={{ flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span className="mono" style={{ color: sloStateText[s.state], whiteSpace: 'nowrap' }}>
                    {formatBudgetMinutes(s.remainingMinutes)} <span className="subtle">of {formatBudgetMinutes(s.budgetMinutes)}</span>
                  </span>
                  <Meter pct={(s.remaining ?? 0) * 100} color={s.state === 'breached' ? 'var(--c-down)' : s.state === 'at-risk' ? 'var(--c-warn)' : projectColor[slo.project]} height={5} />
                </span>
                <span style={{ flex: '0 0 156px' }} className="burns mono">
                  {(['1h', '6h', '24h'] as const).map((w) => (
                    <span key={w} style={{ color: (s.burn[w] ?? 0) >= 1 ? 'var(--warn)' : s.burn[w] === null ? 'var(--subtle)' : undefined }}>{formatBurn(s.burn[w])}</span>
                  ))}
                </span>
                <span style={{ flex: '0 0 92px' }} className="r mono">{formatExhaustion(s.exhaustionMinutes)}</span>
                <span style={{ flex: '0 0 80px', display: 'flex', justifyContent: 'flex-end' }}><Pill tone={sloStatePill[s.state]}>{sloStateLabel[s.state]}</Pill></span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="cols">
        <BurnDown row={selected} />
        <Card padded labelledBy="br" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <CardHeader flat id="br" title="Burn alert rules" hint="multi-window" />
          {BURN_RULES.map((r) => (
            <div key={r.id} className="rule">
              <Pill tone={severityPill[r.severity]}>{r.severity === 'critical' ? 'Page' : 'Ticket'}</Pill>
              <span style={{ fontWeight: 600 }}>{r.label}</span>
              <span className="mono subtle" style={{ marginLeft: 'auto' }}>≥ {formatBurn(burnThreshold(r.budgetFraction, selected.slo.windowDays, RULE_HOURS[r.id]))}</span>
              <span className="muted small" style={{ flexBasis: '100%' }}>
                {r.budgetFraction * 100}% of the budget in {r.long}, still burning over the last {r.short}.
              </span>
            </div>
          ))}
          <p className="muted small" style={{ margin: '12px 0 0' }}>
            Checks without data are left out: they neither spend nor save budget.
          </p>
        </Card>
      </div>
    </>
  );
}

function BurnDown({ row }: { row: Row }) {
  const { slo, s } = row;
  const n = s.burnDown.length;
  const actual = s.burnDown.map((v) => Math.max(0, Math.min(100, v * 100)));
  const steady = Array.from({ length: n }, (_, i) => 100 * (1 - (i + 1) / n));
  const exhaustedAt = s.burnDown.findIndex((v) => v < 0);
  const spent = slo.window.bad;
  return (
    <Card padded labelledBy="bd" style={{ flex: '3 1 520px', minWidth: 0 }}>
      <CardHeader
        flat
        id="bd"
        title={<>Budget burn-down · <span style={{ color: sloStateText[s.state] }}>{slo.name}</span></>}
        hint={`${slo.targetPct}% over ${slo.windowDays} days`}
        end={<Legend series={[{ name: 'budget left', color: PROJECT_SERIES[slo.project] }, { name: 'steady burn', color: 'sky' }]} />}
      />
      {n === 0 ? (
        <EmptyState>No answered checks in this window.</EmptyState>
      ) : (
        <LineChart
          label={`Error budget left per day for ${slo.name}`}
          series={[
            { name: 'budget left', color: PROJECT_SERIES[slo.project], values: actual },
            { name: 'steady burn', color: 'sky', values: steady },
          ]}
          area
          height={200}
          max={100}
          dangerFrom={exhaustedAt >= 0 ? exhaustedAt / Math.max(1, n - 1) : undefined}
          yLabels={['100%', '75', '50', '25', '0']}
          xLabels={[`-${slo.windowDays}d`, `-${Math.round((slo.windowDays * 2) / 3)}d`, `-${Math.round(slo.windowDays / 3)}d`, 'today']}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 28px', marginTop: 14 }}>
        <div className="kv" style={{ flex: '1 1 180px' }}><span className="muted">Budget</span><span className="mono">{formatBudgetMinutes(s.budgetMinutes)}</span></div>
        <div className="kv" style={{ flex: '1 1 180px' }}><span className="muted">Left</span><span className="mono" style={{ color: sloStateText[s.state] }}>{formatBudgetMinutes(s.remainingMinutes)}</span></div>
        <div className="kv" style={{ flex: '1 1 180px' }}><span className="muted">Failed checks</span><span className="mono">{formatNumber(spent, 0)}</span></div>
        <div className="kv" style={{ flex: '1 1 180px' }}><span className="muted">No data (excluded)</span><span className="mono">{formatNumber(slo.window.unknown, 0)}</span></div>
      </div>
      {exhaustedAt >= 0 && (
        <p className="small" style={{ margin: '10px 0 0', color: 'var(--down)' }}>
          Budget ran out {n - 1 - exhaustedAt === 0 ? 'today' : `${n - 1 - exhaustedAt} days ago`}.
        </p>
      )}
    </Card>
  );
}
