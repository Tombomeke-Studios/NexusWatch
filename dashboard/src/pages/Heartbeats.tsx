import { Link } from 'react-router-dom';
import { useHeartbeats } from '@/api/queries';
import { NodeCard } from '@/components/NodeCard';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusStrip } from '@/components/ui/charts';
import { PageHeader, Pill, Swatch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatDuration, formatLatency, formatPercent, formatWhen } from '@/lib/format';
import { projectColor, severityPill } from '@/lib/status';
import { routes } from '@/routes';

const uptimeColor = { up: 'var(--ok)', slow: 'var(--warn)', down: 'var(--down)' } as const;

export function HeartbeatsPage() {
  const query = useHeartbeats();
  return (
    <>
      <PageHeader title="Heartbeats" subtitle={<>Uptime of every service and node, last 60 days{config.useMocks && ' · sample data'}</>}>
        <button type="button" className="btn pri" disabled title="Monitors are the collector's NW_HEALTH_TARGETS">
          + Add monitor
        </button>
      </PageHeader>

      <QueryState query={query} skeletonHeight={1000}>
        {(data) => (
          <>
            <section aria-labelledby="nd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 className="h" id="nd">Nodes</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                {data.nodes.map((n) => (
                  <NodeCard key={n.id} node={n} />
                ))}
              </div>
            </section>

            <Card labelledBy="mon">
              <CardHeader
                id="mon"
                title="Monitors"
                end={
                  <div className="legend">
                    <span><Swatch color="var(--c-ok)" />online</span>
                    <span><Swatch color="var(--c-warn)" />slow</span>
                    <span><Swatch color="var(--c-down)" />down</span>
                  </div>
                }
              />
              <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 20px 10px' }}>
                {data.monitors.map((m) => (
                  <Link key={m.id} className="mrow" to={routes.service(m.serviceId)}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
                      <Swatch color={projectColor[m.project]} />
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      <span className="mono subtle" style={{ fontSize: 12 }}>{m.target}</span>
                      <span className="num" style={{ marginLeft: 'auto', fontSize: 20, color: uptimeColor[m.status] }}>{formatPercent(m.uptimePct)}</span>
                    </div>
                    <StatusStrip statuses={m.days} height={30} />
                    <div className="mono subtle" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span>60 days ago</span>
                      <span>avg {formatLatency(m.avgLatencyMs)} · now {formatLatency(m.nowLatencyMs)}</span>
                      <span>today</span>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>

            <Card padded labelledBy="inc">
              <CardHeader flat id="inc" title="Incidents" link={{ to: routes.incidents, label: 'All incidents' }} />
              {data.incidents.map((i) => (
                <Link key={i.id} to={routes.incident(i.id)} className="mrow" style={{ flexDirection: 'row', gap: 14, padding: '12px 0', borderTop: '1px solid var(--surface2)', borderBottom: 0 }}>
                  <Pill tone={i.open ? severityPill[i.severity] : 'p-ok'} style={{ height: 'fit-content', marginTop: 2 }}>{i.open ? 'open' : 'resolved'}</Pill>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{i.title}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{i.note}</div>
                  </div>
                  <div className="mono subtle" style={{ textAlign: 'right', fontSize: 12 }}>
                    {formatWhen(i.startedAt)}
                    <br />
                    {i.open ? `ongoing ${formatDuration(i.durationSeconds)}` : formatDuration(i.durationSeconds)}
                  </div>
                </Link>
              ))}
            </Card>
          </>
        )}
      </QueryState>
    </>
  );
}
