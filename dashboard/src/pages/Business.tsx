import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusiness } from '@/api/queries';
import type { BusinessData, BusHealth } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { BarChart, Meter, StackBar, XAxis } from '@/components/ui/charts';
import { Kpi, PageHeader, Pill, Segmented, Swatch } from '@/components/ui/primitives';
import { EmptyState, QueryState } from '@/components/ui/QueryState';
import { creditState, describeDlq, formatHoursLeft, maskEmail, sortByHoursLeft, type CreditState } from '@/lib/business';
import { config } from '@/lib/config';
import { formatDuration, formatEur, formatPercent, formatWhen } from '@/lib/format';
import { axisLabels } from '@/lib/ranges';
import { anomalyLabel, reconcileAll, summarize, type Outcome, type ReconciledTopUp, type StepState } from '@/lib/reconcile';
import { chartColor, severityLabel, severityPill } from '@/lib/status';
import { routes } from '@/routes';
import './Business.css';

type Filter = 'all' | 'anomalies' | 'in-flight' | 'failed';
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'in-flight', label: 'In flight' },
  { id: 'failed', label: 'Failed' },
] as const;

const OUTCOME: Record<Outcome, { tone: string; label: string }> = {
  credited: { tone: 'p-ok', label: 'credited' },
  confirmed: { tone: 'p-ok', label: 'confirmed' },
  failed: { tone: 'p-mute', label: 'failed' },
  'in-flight': { tone: 'p-info', label: 'in flight' },
  'not-confirmed': { tone: 'p-warn', label: 'not confirmed' },
  anomaly: { tone: 'p-down', label: 'anomaly' },
};

const CREDIT: Record<CreditState, { tone: string; label: string }> = {
  out: { tone: 'p-down', label: 'out of credit' },
  low: { tone: 'p-warn', label: 'low' },
  ok: { tone: 'p-ok', label: 'ok' },
  idle: { tone: 'p-mute', label: 'nothing running' },
};

export function BusinessPage() {
  const query = useBusiness();
  return (
    <>
      <PageHeader
        title="Business"
        subtitle={<>Money flow FinVault → NexusInfra · top-ups, credit and the event bus · ids only{config.useMocks && ' · sample data'}</>}
      >
        <Link className="btn" to={routes.project('finvault')}><Swatch color="var(--c-fv)" />FinVault</Link>
        <Link className="btn" to={routes.project('nexusinfra')}><Swatch color="var(--c-nx)" />NexusInfra</Link>
      </PageHeader>
      <QueryState query={query} skeletonHeight={1400}>
        {(data) => <Body data={data} now={query.dataUpdatedAt} />}
      </QueryState>
    </>
  );
}

/** `now` is when the data arrived, so the page judges timeouts against the same moment the data describes. */
function Body({ data, now }: { data: BusinessData; now: number }) {
  const rows = useMemo(() => reconcileAll(data.topUps, { now: new Date(now), timeoutMs: data.topUpTimeoutMs }), [data, now]);
  const s = summarize(rows);
  const creditedEur = rows.filter((r) => r.outcome === 'credited' || r.outcome === 'confirmed').reduce((sum, r) => sum + r.record.amountEur, 0);
  // A bus-only backend sees FinVault's confirmation, not the bridge's credit (credits: null).
  const creditsSeen = rows.every((r) => r.record.credits !== null);

  return (
    <>
      <div className="biz-section">
        <h2>Top-up reconciliation</h2>
        <span className="subtle small">payment.request → FinVault → NexusInfra wallet · last 7 days · timeout {formatDuration(data.topUpTimeoutMs / 1000)}</span>
      </div>
      <section className="kpis" aria-label="Reconciliation figures">
        <Kpi accent="fv" label="Success rate" value={s.successRate === null ? 'unknown' : formatPercent(s.successRate, 1)} foot={`${s.credited + s.confirmed} of ${s.settled} settled ${creditsSeen ? 'credited' : 'confirmed'} · ${s.inFlight} in flight`} />
        <Kpi label="Median time to credit" value={s.medianTimeToCreditMs === null ? 'unknown' : formatDuration(s.medianTimeToCreditMs / 1000)} foot={creditsSeen ? 'request → credit, includes paying in FinVault' : 'the bridge publishes no credit event'} />
        <Kpi label="Open anomalies" value={s.openAnomalies} valueColor={s.openAnomalies ? 'var(--down)' : 'var(--ok)'} foot={s.notedAnomalies ? `+ ${s.notedAnomalies} noted (healed on its own)` : 'none noted'} />
        <Kpi accent="nx" label={creditsSeen ? 'Credited' : 'Confirmed'} value={formatEur(creditedEur, true)} foot={creditsSeen ? `${s.credited} top-ups into NexusInfra wallets` : `${s.confirmed} top-ups confirmed by FinVault`} />
      </section>

      <Anomalies rows={rows} />
      <Pipeline rows={rows} />

      <div className="biz-section">
        <h2>Credit and standing</h2>
        <span className="subtle small">Billing Bridge · low under {data.lowCreditHours} h of runtime</span>
      </div>
      <Credit data={data} now={now} />

      <div className="biz-section">
        <h2>Event bus</h2>
        <span className="mono subtle small">{data.bus.exchange}</span>
      </div>
      <Bus bus={data.bus} />
    </>
  );
}

function Anomalies({ rows }: { rows: ReconciledTopUp[] }) {
  const items = rows.flatMap((r) => r.anomalies.map((a, i) => ({ ...a, row: r, key: `${r.record.reference}-${a.kind}-${i}` })));
  const order = { critical: 0, warning: 1, info: 2 } as const;
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <Card labelledBy="an">
      <CardHeader id="an" title="Anomalies" hint={items.length ? `${items.length} found` : undefined} />
      {items.length === 0 ? (
        <EmptyState>
          {rows.every((r) => r.record.credits !== null)
            ? 'No anomalies — every settled top-up was credited once, for the amount asked.'
            : 'No anomalies in what the bus shows — FinVault answered every settled top-up, for the amount asked. Credits are not observed.'}
        </EmptyState>
      ) : (
        <div>
          {items.map((a) => (
            <div key={a.key} className={`biz-anom ${a.severity}`}>
              <Pill tone={severityPill[a.severity]}>{severityLabel[a.severity]}</Pill>
              <span style={{ fontWeight: 600 }}>{anomalyLabel[a.kind]}</span>
              <span className="mono small">{a.row.record.reference}</span>
              <span className="mono subtle small">{a.row.record.accountId}</span>
              <span className="subtle small" style={{ marginLeft: 'auto' }}>{formatWhen(a.row.record.requestedAt)}</span>
              <span className="reason">{a.reason}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function stepLabels(r: ReconciledTopUp): [string, string, string] {
  const { record, steps } = r;
  const n = record.credits?.length ?? 0;
  const request = steps.request === 'done' ? 'sent' : 'not sent';
  const finvault = { done: 'confirmed', late: 'confirmed late', waiting: 'waiting', failed: record.finvault ? 'failed' : 'no answer', skipped: '—', unknown: 'not observed' }[steps.finvault];
  const credit = {
    done: 'credited',
    late: 'credited',
    waiting: 'waiting',
    failed: n > 1 ? `credited ×${n}` : n === 1 ? 'credited ≠' : 'not credited',
    skipped: '—',
    unknown: 'not observed',
  }[steps.credit];
  return [request, finvault, credit];
}

function Steps({ row }: { row: ReconciledTopUp }) {
  const states: StepState[] = [row.steps.request, row.steps.finvault, row.steps.credit];
  const labels = stepLabels(row);
  const names = ['Request', 'FinVault', 'Wallet'];
  return (
    <span className="biz-steps" role="img" aria-label={names.map((n, i) => `${n}: ${labels[i]}`).join(', ')}>
      {states.map((state, i) => (
        <span key={names[i]} style={{ display: 'contents' }}>
          {i > 0 && <span className="biz-join" aria-hidden="true" />}
          <span className={`biz-step ${state}`} aria-hidden="true">
            <i />
            {labels[i]}
          </span>
        </span>
      ))}
    </span>
  );
}

function Pipeline({ rows }: { rows: ReconciledTopUp[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const shown = rows.filter((r) =>
    filter === 'all' ? true
      : filter === 'anomalies' ? r.anomalies.length > 0
      : filter === 'in-flight' ? r.outcome === 'in-flight'
      : r.outcome === 'failed',
  );
  return (
    <Card labelledBy="pl">
      <CardHeader id="pl" title="Top-up pipeline" hint={`${rows.length} top-ups`} end={<Segmented small options={FILTERS} value={filter} onChange={setFilter} label="Show top-ups" />} />
      {shown.length === 0 ? (
        <EmptyState>No top-ups match this filter.</EmptyState>
      ) : (
        <div className="tbl">
          <div className="tr th" style={{ minWidth: 900 }}>
            <span style={{ flex: '0 0 132px' }}>Requested</span>
            <span style={{ flex: '1 1 90px' }}>Reference</span>
            <span style={{ flex: '1 1 110px' }}>Account</span>
            <span className="r" style={{ flex: '0 0 76px' }}>Amount</span>
            <span style={{ flex: '0 0 260px' }}>Pipeline</span>
            <span style={{ flex: '2 1 200px' }}>Outcome</span>
          </div>
          {shown.map((r) => {
            const o = OUTCOME[r.outcome];
            const note = r.anomalies[0]?.reason ?? (r.record.finvault?.outcome === 'failed' ? `FinVault: ${r.record.finvault.reason ?? 'no reason given'}` : !r.record.sent ? 'The broker did not take the request.' : null);
            return (
              <div key={r.record.reference} className="tr" style={{ minWidth: 900 }}>
                <span className="mono muted" style={{ flex: '0 0 132px' }}>{formatWhen(r.record.requestedAt)}</span>
                <span className="mono" style={{ flex: '1 1 90px' }}>{r.record.reference}</span>
                <span style={{ flex: '1 1 110px', minWidth: 0 }}>
                  <span className="mono">{r.record.accountId}</span>
                  {r.record.payer && <span className="biz-reason mono">{maskEmail(r.record.payer)}</span>}
                </span>
                <span className="mono r" style={{ flex: '0 0 76px' }}>{formatEur(r.record.amountEur)}</span>
                <span style={{ flex: '0 0 260px' }}><Steps row={r} /></span>
                <span style={{ flex: '2 1 200px', minWidth: 0 }}>
                  <Pill tone={o.tone}>{o.label}</Pill>
                  {r.anomalies.length > 1 && <span className="subtle small"> +{r.anomalies.length - 1}</span>}
                  {r.timeToCreditMs !== null && r.outcome === 'credited' && <span className="subtle small"> in {formatDuration(r.timeToCreditMs / 1000)}</span>}
                  {note && <span className="biz-reason">{note}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Credit({ data, now }: { data: BusinessData; now: number }) {
  const accounts = sortByHoursLeft(data.accounts);
  const states = accounts.map((a) => creditState(a, data.lowCreditHours));
  const low = states.filter((x) => x === 'low').length;
  const out = states.filter((x) => x === 'out').length;
  // A week of runtime fills the meter; the threshold sits at lowCreditHours of it.
  const scale = 7 * 24;
  const total = data.revenueByPlan.reduce((sum, p) => sum + p.revenueEur, 0);
  const perDay = data.revenueByPlan[0]?.perDay.map((_, i) => data.revenueByPlan.reduce((sum, p) => sum + (p.perDay[i] ?? 0), 0)) ?? [];

  return (
    <>
      <section className="kpis" aria-label="Credit figures">
        <Kpi label="Low credit" value={accounts.length ? low : 'unknown'} valueColor={low ? 'var(--warn)' : undefined} foot={`under ${data.lowCreditHours} h of runtime left`} />
        <Kpi label="Out of credit" value={accounts.length ? out : 'unknown'} valueColor={out ? 'var(--down)' : undefined} foot="starts answer 402" />
        <Kpi label="Suspended servers" value={data.suspended.length} valueColor={data.suspended.length ? 'var(--down)' : undefined} foot="stopped by billing.server.suspend" />
        <Kpi accent="nx" label="Revenue · 30 days" value={data.revenueByPlan.length ? formatEur(total, true) : 'unknown'} foot={data.revenueByPlan.length ? `${data.revenueByPlan.length} plans` : 'plans live in the bridge, not on the bus'} />
      </section>

      <div className="cols">
        <Card labelledBy="ac" style={{ flex: '3 1 560px', minWidth: 0 }}>
          <CardHeader id="ac" title="Accounts by hours left" hint="ids only" />
          <div className="tbl">
            <div className="tr th" style={{ minWidth: 680 }}>
              <span style={{ flex: '1 1 90px' }}>Account</span>
              <span style={{ flex: '1 1 80px' }}>Plan</span>
              <span className="r" style={{ flex: '0 0 84px' }}>Available</span>
              <span style={{ flex: '2 1 180px' }}>Left to spend</span>
              <span className="r" style={{ flex: '1 1 120px' }}>Standing</span>
            </div>
            {accounts.length === 0 && <EmptyState>No account standing to show — the Billing Bridge keeps it in its own database; only low-credit warnings and suspensions reach the bus.</EmptyState>}
            {accounts.map((a, i) => {
              const st = states[i];
              const c = CREDIT[st];
              const color = st === 'out' ? 'var(--c-down)' : st === 'low' ? 'var(--c-warn)' : 'var(--c-nx)';
              return (
                <div key={a.accountId} className="tr" style={{ minWidth: 680 }}>
                  <span className="mono" style={{ flex: '1 1 90px' }}>{a.accountId}</span>
                  <span className="muted" style={{ flex: '1 1 80px' }}>{a.planId}</span>
                  <span className="mono r" style={{ flex: '0 0 84px' }}>{formatEur(a.availableEur)}</span>
                  <span style={{ flex: '2 1 180px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {a.hoursLeft === null
                      ? <span className="subtle small">— no estimate</span>
                      : <>
                          <Meter pct={Math.min(100, (a.hoursLeft / scale) * 100)} color={color} style={{ flex: 1 }} />
                          <span className="mono r" style={{ width: 52 }}>{formatHoursLeft(a.hoursLeft)}</span>
                        </>}
                  </span>
                  <span className="r" style={{ flex: '1 1 120px' }}>
                    <Pill tone={c.tone}>{c.label}</Pill>
                    {a.lowCreditWarnedAt && <span className="biz-reason">warned {formatWhen(a.lowCreditWarnedAt)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <div style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card labelledBy="su">
            <CardHeader id="su" title="Suspended for credit" hint={`${data.suspended.length} servers`} />
            {data.suspended.length === 0 ? (
              <EmptyState>No server is suspended for credit.</EmptyState>
            ) : (
              <div className="biz-list">
                {data.suspended.map((s) => (
                  <div key={s.deploymentId} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div><span className="mono" style={{ fontWeight: 600 }}>{s.deploymentId}</span> <span className="mono subtle small">{s.accountId}</span></div>
                      <div className="muted small">{s.reason}</div>
                    </div>
                    <div className="r small" style={{ flex: '0 0 auto' }}>
                      <div className="muted">since {formatWhen(s.suspendedAt)}</div>
                      <div className="subtle">{formatDuration((now - Date.parse(s.suspendedAt)) / 1000)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card padded labelledBy="rv">
            <CardHeader flat id="rv" title="Revenue per plan" hint="usage charged · 30 days" />
            {data.revenueByPlan.length === 0 && <EmptyState>Not measured — usage per plan is not published on the bus.</EmptyState>}
            <BarChart values={perDay} slots={30} color="var(--c-nx)" height={90} label="Revenue per day, all plans, last 30 days" />
            <XAxis labels={axisLabels('30d')} />
            <div style={{ marginTop: 16 }}>
              <StackBar parts={data.revenueByPlan.map((p) => ({ pct: total ? (p.revenueEur / total) * 100 : 0, color: chartColor(p.color) }))} label={`Share: ${data.revenueByPlan.map((p) => `${p.name} ${formatEur(p.revenueEur, true)}`).join(', ')}`} height={10} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {data.revenueByPlan.map((p) => (
                <div key={p.planId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Swatch color={chartColor(p.color)} />
                  <span style={{ flex: 1 }}>{p.name} <span className="subtle small">· {p.accounts} accounts</span></span>
                  <span className="mono">{formatEur(p.revenueEur)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Unknown({ why }: { why?: string }) {
  return <span className="biz-unknown" title={why ?? 'could not be asked'}>unknown</span>;
}

function Bus({ bus }: { bus: BusHealth }) {
  const last = bus.throughputPerMin.at(-1);
  const avg = bus.throughputPerMin.length ? bus.throughputPerMin.reduce((a, b) => a + b, 0) / bus.throughputPerMin.length : null;
  const max = Math.max(0, ...bus.throughputPerMin);
  const depth = bus.dlq.depth;
  const dlqColor = depth === null ? 'var(--warn)' : depth > 0 ? 'var(--down)' : 'var(--ok)';
  return (
    <>
      <div className="cols">
        <Card padded labelledBy="tp" className="biz-dense" style={{ flex: '2 1 420px', minWidth: 0 }}>
          <CardHeader flat id="tp" title="Throughput" hint="messages per minute · last hour" />
          <div className="baseline" style={{ marginBottom: 10 }}>
            <span className="num biz-big">{last ?? <Unknown />}</span>
            <span className="muted small">now · avg {avg === null ? '—' : Math.round(avg)} · peak {max}</span>
          </div>
          <BarChart values={bus.throughputPerMin} slots={60} color="var(--c-fv)" height={90} label="Messages per minute on finvault.events, last hour" />
          <XAxis labels={axisLabels('1h')} />
        </Card>

        <Card padded labelledBy="dl" style={{ flex: '1 1 260px', minWidth: 0 }}>
          <CardHeader flat id="dl" title="Dead-letter queue" hint={<span className="mono">{bus.dlq.name}</span>} />
          <div className="num biz-big" style={{ color: dlqColor }}>{depth === null ? 'unknown' : depth}</div>
          <p className="muted small" style={{ margin: '8px 0 0' }}>{describeDlq(depth)}</p>
          {bus.dlq.error && <p className="subtle small mono" style={{ margin: '6px 0 0' }}>{bus.dlq.error}</p>}
          <p className="subtle small" style={{ margin: '6px 0 0' }}>checked {formatWhen(bus.dlq.checkedAt)}</p>
        </Card>

        <Card labelledBy="ob" style={{ flex: '1 1 280px', minWidth: 0 }}>
          <CardHeader id="ob" title="Outbox backlog" hint="held publishes (#167)" />
          <div className="biz-list">
            {bus.outboxes.map((o) => (
              <div key={o.service} className="row" style={{ flexWrap: 'nowrap' }}>
                <span className="mono small" style={{ flex: 1, minWidth: 0 }}>{o.service}</span>
                <span className="mono small r" style={{ color: o.pending ? 'var(--warn)' : undefined }}>
                  {o.pending === null ? <Unknown why="the service did not report" /> : `${o.pending} pending`}
                </span>
                {!!o.dropped && <span className="mono small" style={{ color: 'var(--down)' }}>{o.dropped} dropped</span>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card labelledBy="qs">
        <CardHeader id="qs" title="Queues on the exchange" hint="consumers and waiting messages" />
        <div className="tbl">
          <div className="tr th" style={{ minWidth: 720 }}>
            <span style={{ flex: '2 1 220px' }}>Queue</span>
            <span style={{ flex: '2 1 220px' }}>Bound to</span>
            <span className="r" style={{ flex: '1 1 100px' }}>Consumers</span>
            <span className="r" style={{ flex: '1 1 80px' }}>Ready</span>
          </div>
          {bus.queues.length === 0 && <EmptyState>Not measured — needs the broker's management API.</EmptyState>}
          {bus.queues.map((q) => (
            <div key={q.name} className="tr" style={{ minWidth: 720 }}>
              <span className="mono" style={{ flex: '2 1 220px' }}>{q.name}</span>
              <span className="mono subtle small" style={{ flex: '2 1 220px' }}>{q.bindings.join(' · ')}</span>
              <span className="mono r" style={{ flex: '1 1 100px', color: q.consumers === 0 ? 'var(--down)' : undefined }}>
                {q.consumers === null ? <Unknown /> : q.consumers === 0 ? '0 — nobody reads' : q.consumers}
              </span>
              <span className="mono r" style={{ flex: '1 1 80px', color: q.ready ? 'var(--warn)' : undefined }}>
                {q.ready === null ? <Unknown /> : q.ready}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
