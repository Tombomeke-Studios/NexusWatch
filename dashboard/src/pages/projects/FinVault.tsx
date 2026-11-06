import { Link } from 'react-router-dom';
import { useFinVault } from '@/api/queries';
import type { FinVaultData } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { BarChart, Meter, StackBar, XAxis } from '@/components/ui/charts';
import { Kpi, PageHeader, Pill, StatusDot, Swatch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatClock, formatEur, formatNumber, formatPercent } from '@/lib/format';
import { chartColor, statusLabel, statusPill } from '@/lib/status';
import { routes } from '@/routes';

const TX_PILL = { 'top-up': 'p-fv', SEPA: 'p-info', FX: 'p-warn', P2P: 'p-mute' } as const;
const STATE_PILL = { succeeded: 'p-ok', pending: 'p-warn', failed: 'p-down' } as const;

export function FinVaultPage() {
  const query = useFinVault();
  const down = query.data ? query.data.services.filter((s) => s.service.status === 'down').length : 0;
  return (
    <>
      <PageHeader
        title="FinVault"
        icon={
          <div className="hex p-fv" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 32 32">
              <path d="M9 6h15M9 6v21M9 15h11" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        }
        subtitle={<>Banking platform · web dashboard and mobile app{query.data && ` · ${query.data.services.length} services`}{config.useMocks && ' · sample data'}</>}
      >
        {down > 0 && <Pill tone="p-down">{down} service{down > 1 ? 's' : ''} down</Pill>}
        <button type="button" className="btn" disabled title="Dashboard URL not configured yet">Open dashboard ↗</button>
      </PageHeader>
      <QueryState query={query} skeletonHeight={1200}>
        {(data) => <Body data={data} />}
      </QueryState>
    </>
  );
}

function Body({ data }: { data: FinVaultData }) {
  const k = data.kpis;
  const top = data.funnel[0]?.count || 1;
  return (
    <>
      <section className="kpis" aria-label="Key figures">
        <Kpi accent="fv" label="Top-ups today" labelColor="var(--fv)" swatch="var(--c-fv)" value={k.topupsToday} unit={formatEur(k.topupsTodayEur, true)} foot={k.topupsDelta} />
        <Kpi label="Active wallets" value={k.activeWallets} foot="last 24 hours" />
        <Kpi label="Transfers" value={k.transfers} foot={`${formatPercent(k.transferSuccessPct, 1)} succeeded · P2P + SEPA`} />
        <Kpi label="Open invoices" value={k.openInvoices} valueColor="var(--warn)" foot={k.openInvoicesNote} />
        <Kpi label="FX conversions" value={k.fxConversions} foot={k.fxNote} />
      </section>

      <Card padded labelledBy="fn">
        <CardHeader flat id="fn" title="Top-up funnel" hint="from request to credits at NexusInfra · today" link={{ to: routes.business, label: 'Reconcile top-ups' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.funnel.map((f, i) => {
            const prev = i ? data.funnel[i - 1].count : f.count;
            return (
              <div key={f.label} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px' }}>
                <div style={{ flex: '0 0 200px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Swatch color={chartColor(f.color)} />
                  <span style={{ fontWeight: 600 }}>{f.label}</span>
                </div>
                <Meter pct={(f.count / top) * 100} color={chartColor(f.color)} height={14} style={{ flex: '1 1 240px' }} />
                <div className="mono r" style={{ flex: '0 0 130px' }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{f.count}</span>{' '}
                  <span className="subtle" style={{ fontSize: 12 }}>{Math.round((f.count / (prev || 1)) * 100)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="cols">
        <Card padded labelledBy="tu" style={{ flex: '2 1 460px', minWidth: 0 }}>
          <CardHeader flat id="tu" title="Top-ups per hour" hint="count" />
          <BarChart values={data.topupsPerHour} color="var(--c-fv)" height={130} label="Top-ups per hour" />
          <XAxis labels={['00:00', '06:00', '12:00', '18:00', 'now']} />
        </Card>
        <Card padded labelledBy="wt" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <CardHeader flat id="wt" title="Balance by wallet type" />
          <StackBar parts={data.walletSplit.map((w) => ({ pct: w.pct, color: chartColor(w.color) }))} label={`Split: ${data.walletSplit.map((w) => `${w.label} ${w.pct}%`).join(', ')}`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {data.walletSplit.map((w) => (
              <div key={w.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Swatch color={chartColor(w.color)} />
                <span style={{ flex: 1 }}>{w.label}</span>
                <span className="mono">{w.pct}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="cols">
        <Card labelledBy="sv" style={{ flex: '3 1 560px', minWidth: 0 }}>
          <CardHeader id="sv" title="Services" link={{ to: routes.heartbeats, label: 'Heartbeats' }} />
          <div className="tbl">
            <div className="tr th" style={{ minWidth: 700 }}>
              <span style={{ flex: '2 1 170px' }}>Service</span>
              <span style={{ flex: '1 1 60px' }}>Port</span>
              <span style={{ flex: '1 1 90px' }}>Status</span>
              <span className="r" style={{ flex: '1 1 70px' }}>p95</span>
              <span className="r" style={{ flex: '1 1 70px' }}>req/s</span>
              <span className="r" style={{ flex: '1 1 70px' }}>5xx</span>
            </div>
            {data.services.map(({ service: s, p95, rps, errorPct }) => (
              <Link key={s.id} className="tr" to={routes.service(s.id)} style={{ minWidth: 700 }}>
                <span style={{ flex: '2 1 170px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <StatusDot status={s.status} />
                  {s.name}
                </span>
                <span className="mono muted" data-label="Port" style={{ flex: '1 1 60px' }}>{s.port}</span>
                <span style={{ flex: '1 1 90px' }}><Pill tone={statusPill[s.status]}>{statusLabel[s.status]}</Pill></span>
                <span className="mono r" data-label="p95" style={{ flex: '1 1 70px' }}>{p95}</span>
                <span className="mono r" data-label="req/s" style={{ flex: '1 1 70px' }}>{rps === null ? '–' : formatNumber(rps)}</span>
                <span className="mono r" data-label="5xx" style={{ flex: '1 1 70px', color: errorPct === null ? 'var(--down)' : errorPct > 1 ? 'var(--warn)' : 'var(--muted)' }}>
                  {errorPct === null ? '–' : formatPercent(errorPct, 1)}
                </span>
              </Link>
            ))}
          </div>
        </Card>

        <Card padded labelledBy="qq" style={{ flex: '2 1 360px', minWidth: 0 }}>
          <CardHeader flat id="qq" title="RabbitMQ queues" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.queues.map((q) => {
              const over = q.ready > q.threshold;
              return (
                <div key={q.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 13 }}>{q.name}</span>
                    <span className="mono" style={{ fontSize: 13, color: over ? 'var(--down)' : 'var(--muted)' }}>{q.ready} waiting</span>
                  </div>
                  <Meter pct={(q.ready / q.capacity) * 100} color={over ? 'var(--c-down)' : 'var(--c-fv)'} height={8} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="cols">
        <Card labelledBy="tx" style={{ flex: '3 1 560px', minWidth: 0 }}>
          <CardHeader id="tx" title="Recent transactions" hint="ids only, no personal data" />
          <div className="tbl">
            <div className="tr th" style={{ minWidth: 700 }}>
              <span style={{ flex: '0 0 80px' }}>Time</span>
              <span style={{ flex: '1 1 90px' }}>Type</span>
              <span style={{ flex: '1 1 110px' }}>Wallet</span>
              <span className="r" style={{ flex: '1 1 90px' }}>Amount</span>
              <span className="r" style={{ flex: '1 1 100px' }}>Status</span>
            </div>
            {data.transactions.map((t) => (
              <div key={t.id} className="tr" style={{ minWidth: 700 }}>
                <span className="mono muted" style={{ flex: '0 0 80px' }}>{formatClock(t.time, 'min')}</span>
                <span style={{ flex: '1 1 90px' }}><Pill tone={TX_PILL[t.type]}>{t.type}</Pill></span>
                <span className="mono" data-label="Wallet" style={{ flex: '1 1 110px' }}>{t.wallet}</span>
                <span className="mono r" data-label="Amount" style={{ flex: '1 1 90px', color: t.incoming ? 'var(--ok)' : 'var(--text)' }}>{t.amount}</span>
                <span className="r" style={{ flex: '1 1 100px' }}><Pill tone={STATE_PILL[t.state]}>{t.state}</Pill></span>
              </div>
            ))}
          </div>
        </Card>

        <Card padded labelledBy="sec" style={{ flex: '1 1 280px', minWidth: 0 }}>
          <CardHeader flat id="sec" title="Security" hint="24h" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="baseline"><span className="num" style={{ fontSize: 28 }}>{data.security.failedLogins}</span><span className="muted">failed logins</span></div>
            <div className="baseline"><span className="num" style={{ fontSize: 28, color: data.security.tokenReuse ? 'var(--warn)' : undefined }}>{data.security.tokenReuse}</span><span className="muted">refresh-token reuse</span></div>
            <div className="baseline"><span className="num" style={{ fontSize: 28 }}>{data.security.rateLimitHits}</span><span className="muted">rate-limit hits (Redis)</span></div>
          </div>
        </Card>
      </div>
    </>
  );
}
