import { Link } from 'react-router-dom';
import { useNexusInfra } from '@/api/queries';
import type { NexusInfraData } from '@/api/types';
import { NodeCard } from '@/components/NodeCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { BarChart, Meter, XAxis } from '@/components/ui/charts';
import { Kpi, PageHeader, Pill, StatusDot } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatEur, formatLatency, formatWhen } from '@/lib/format';
import { axisLabels } from '@/lib/ranges';
import { routes } from '@/routes';

const STATE_PILL = { running: 'p-ok', stopped: 'p-mute', restarting: 'p-warn' } as const;

export function NexusInfraPage() {
  const query = useNexusInfra();
  const warnings = query.data ? query.data.nodes.filter((n) => n.status !== 'up').length : 0;
  return (
    <>
      <PageHeader
        title="NexusInfra"
        icon={
          <div className="hex p-info" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 32 32">
              <path d="M16 2.5 28 9.5v13L16 29.5 4 22.5v-13z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
            </svg>
          </div>
        }
        subtitle={
          <>
            Docker server management
            {query.data && ` · ${query.data.kpis.nodesTotal} nodes · ${query.data.kpis.containersTotal} containers`}
            {config.useMocks && ' · sample data'}
          </>
        }
      >
        {warnings > 0 && <Pill tone="p-warn">{warnings} warning{warnings > 1 ? 's' : ''}</Pill>}
        <button type="button" className="btn" disabled title="Panel URL not configured yet">Open panel ↗</button>
      </PageHeader>
      <QueryState query={query} skeletonHeight={1200}>
        {(data) => <Body data={data} />}
      </QueryState>
    </>
  );
}

function Body({ data }: { data: NexusInfraData }) {
  const k = data.kpis;
  return (
    <>
      <section className="kpis" aria-label="Key figures">
        <Kpi label="Nodes online" value={k.nodesOnline} unit={`/ ${k.nodesTotal}`} foot={<span style={{ color: 'var(--warn)' }}>{k.nodeNote}</span>} />
        <Kpi label="Containers running" value={k.containersRunning} unit={`/ ${k.containersTotal}`} foot={k.containersNote} />
        <Kpi label="CPU average" value={k.cpuPct} unit="%" foot={<Meter pct={k.cpuPct} color="var(--c-nx)" />} />
        <Kpi label="Memory" value={k.memoryUsedGb} unit={`/ ${k.memoryTotalGb} GB`} foot={k.memoryTotalGb ? <Meter pct={(k.memoryUsedGb / k.memoryTotalGb) * 100} color="var(--c-nx)" /> : <span className="subtle">no node reports memory</span>} />
        <Kpi accent="nx" label="Payments" labelColor="var(--primary)" swatch="var(--c-nx)" value={formatEur(k.paymentsMonthEur, true)} foot="this month · via FinVault" />
      </section>

      <section aria-labelledby="nd">
        <h2 className="h" id="nd" style={{ marginBottom: 12 }}>Nodes</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {data.nodes.map((n) => (
            <NodeCard key={n.id} node={n} showMeta={false} />
          ))}
        </div>
      </section>

      <Card labelledBy="ct">
        <CardHeader id="ct" title="Containers" hint={`${data.containers.length || data.kpis.containersTotal} total`} link={{ to: routes.logs, label: 'Open logs' }} />
        <div className="tbl">
          <div className="tr th" style={{ minWidth: 760 }}>
            <span style={{ flex: '2 1 170px' }}>Name</span>
            <span style={{ flex: '2 1 170px' }}>Image</span>
            <span style={{ flex: '1 1 70px' }}>Node</span>
            <span style={{ flex: '1 1 90px' }}>Status</span>
            <span style={{ flex: '2 1 150px' }}>CPU</span>
            <span className="r" style={{ flex: '1 1 80px' }}>Memory</span>
            <span className="r" style={{ flex: '1 1 80px' }}>Uptime</span>
            <span className="r" style={{ flex: '0 0 60px' }}>Restarts</span>
          </div>
          {data.containers.length === 0 && (
            <p className="muted" style={{ margin: 0, padding: '14px 20px' }}>
              {data.kpis.containersRunning} running of {data.kpis.containersTotal} — the list per container needs the node agent's API, which takes NexusInfra's internal token.
            </p>
          )}
          {data.containers.map((c) => (
            <div key={c.name} className="tr" style={{ minWidth: 760 }}>
              <span className="mono" style={{ flex: '2 1 170px', fontWeight: 500 }}>{c.name}</span>
              <span className="mono muted" data-label="Image" style={{ flex: '2 1 170px', fontSize: 12 }}>{c.image}</span>
              <span className="mono muted" data-label="Node" style={{ flex: '1 1 70px' }}>{c.node}</span>
              <span style={{ flex: '1 1 90px' }}><Pill tone={STATE_PILL[c.state]}>{c.state}</Pill></span>
              <span data-label="CPU" style={{ flex: '2 1 150px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Meter pct={c.cpuPct} color={c.cpuPct > 70 ? 'var(--c-warn)' : 'var(--c-nx)'} style={{ flex: 1 }} />
                <span className="mono r" style={{ width: 40 }}>{c.cpuPct}%</span>
              </span>
              <span className="mono muted r" data-label="Memory" style={{ flex: '1 1 80px' }}>{c.memory}</span>
              <span className="mono muted r" data-label="Uptime" style={{ flex: '1 1 80px' }}>{c.uptime}</span>
              <span className="mono r" data-label="Restarts" style={{ flex: '0 0 60px', color: c.restarts > 2 ? 'var(--warn)' : 'var(--muted)' }}>{c.restarts}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="cols">
        <Card labelledBy="cp" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <CardHeader id="cp" title="Platform components" />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 8px 10px' }}>
            {data.components.map((c) => (
              <Link key={c.id} to={routes.service(c.id)} className="row" style={{ flexWrap: 'nowrap' }}>
                <StatusDot status={c.status} />
                <span style={{ fontWeight: 600, flex: 1 }}>{c.name}</span>
                <span className="mono subtle" style={{ fontSize: 12 }}>{c.port}</span>
                <span className="mono muted r" style={{ width: 70, fontSize: 13 }}>{formatLatency(c.latencyMs)}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card labelledBy="pay" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <CardHeader id="pay" title="Payments" hint="funded by FinVault top-ups" />
          <div style={{ padding: '16px 20px 4px' }}>
            <BarChart values={data.paymentsPerDay} slots={30} color="var(--c-nx)" label="Payments per day, last 30 days" />
            <XAxis labels={axisLabels('30d')} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 8px 12px' }}>
            {data.payments.map((p) => (
              <div key={p.id} className="row" style={{ flexWrap: 'nowrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 13 }}>{p.server}</div>
                  <div className="subtle" style={{ fontSize: 12 }}>{p.user} · {formatWhen(p.when)}</div>
                </div>
                <span className="num" style={{ fontSize: 15 }}>{formatEur(p.amountEur)}</span>
                <Pill tone={p.paid ? 'p-ok' : 'p-warn'}>{p.paid ? 'paid' : 'pending'}</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
