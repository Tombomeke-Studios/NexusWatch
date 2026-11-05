import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useService } from '@/api/queries';
import type { LogEntry, ServiceDetail } from '@/api/types';
import { LogDocument } from '@/components/LogDocument';
import { Card, CardHeader } from '@/components/ui/Card';
import { LineChart, StatusStrip } from '@/components/ui/charts';
import { Kpi, PageHeader, Pill, StatusDot, Swatch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatClock, formatDuration, formatPercent, formatWhen } from '@/lib/format';
import { levelText, projectColor, projectName, statusPill } from '@/lib/status';
import { routes } from '@/routes';

const TONE_DOT = { error: 'var(--c-down)', warn: 'var(--c-warn)', ok: 'var(--c-ok)', info: 'var(--c-nx)', nx: 'var(--c-nx)' } as const;

export function ServiceDetailPage() {
  const { serviceId = '' } = useParams();
  const query = useService(serviceId);
  return (
    <QueryState query={query} skeletonHeight={1200}>
      {(data) => <ServiceBody data={data} />}
    </QueryState>
  );
}

/** Log lines that unfold into their full document, one at a time. */
function ExpandableLogs({ entries }: { entries: LogEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div>
      {entries.map((l) => {
        const open = l.id === openId;
        return (
          <Fragment key={l.id}>
            <button
              type="button"
              className={`logline lr${open ? ' sel' : ''}`}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : l.id)}
            >
              <span className="subtle" style={{ flex: '0 0 76px' }}>{formatClock(l.time)}</span>
              <span style={{ flex: '0 0 52px', fontWeight: 600, color: levelText[l.level], textTransform: 'uppercase' }}>{l.level}</span>
              <span style={{ flex: 1, wordBreak: 'break-word' }}>{l.message}</span>
              <span className="subtle" aria-hidden="true" style={{ flex: '0 0 12px', transition: 'transform 150ms', transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
            </button>
            {open && <LogDocument entry={l} link="logs" />}
          </Fragment>
        );
      })}
    </div>
  );
}

function ServiceBody({ data }: { data: ServiceDetail }) {
  const { service, kpis } = data;
  const down = service.status === 'down';
  const answered = data.responseTimes.filter((v): v is number => v !== null);
  const span = answered.length / data.responseTimes.length;

  return (
    <>
      <nav className="crumb" aria-label="Breadcrumb">
        <Link to={routes.heartbeats}>Heartbeats</Link>
        <span>/</span>
        <Link to={routes.project(service.project)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Swatch color={projectColor[service.project]} />
          {projectName[service.project]}
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }} aria-current="page">{service.name}</span>
      </nav>

      <PageHeader
        title={service.name}
        subtitle={
          <>
            <span className="mono">{data.target}</span> · checked every {data.intervalSeconds} s{config.useMocks && ' · sample data'}
          </>
        }
      >
        <button type="button" className="btn" disabled title="Coming soon">Test now</button>
        <button type="button" className="btn" disabled title="Coming soon">Pause monitor</button>
        <button type="button" className="btn danger" disabled title="Coming soon">Restart container</button>
      </PageHeader>

      {down && data.downSince && (
        <section className="box" role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 20px', padding: '18px 22px', borderColor: 'var(--c-down)', background: 'var(--downS)' }}>
          <StatusDot live size={12} color="var(--c-down)" />
          <div style={{ flex: '1 1 320px' }}>
            <div className="num" style={{ fontSize: 22, color: 'var(--down)' }}>Down since {formatClock(data.downSince, 'min')}</div>
            <div className="muted">{data.failure}</div>
          </div>
          <Link className="btn" to={routes.alerts}>View alert</Link>
        </section>
      )}

      <section className="kpis" aria-label="Key figures">
        <Kpi label="Uptime 24h" value={formatPercent(kpis.uptime24h)} valueColor={down ? 'var(--down)' : undefined} foot={kpis.downtime24hSeconds ? `${formatDuration(kpis.downtime24hSeconds)} downtime` : 'no downtime'} />
        <Kpi label="Uptime 30 days" value={formatPercent(kpis.uptime30d)} foot={`${kpis.incidents30d} incidents`} />
        <Kpi label={down ? 'Response time (before outage)' : 'Response time'} value={kpis.avgLatencyMs} unit="ms" foot={`p95 ${kpis.p95LatencyMs} ms`} />
        <Kpi label="Last check" value={formatClock(kpis.lastCheckAt)} valueStyle={{ fontSize: 24, fontWeight: 500, fontFamily: "'JetBrains Mono', monospace" }} foot={kpis.lastCheckNote} />
        <Kpi label="Restarts (24h)" value={kpis.restarts24h} valueColor={kpis.restarts24h > 2 ? 'var(--warn)' : undefined} foot={kpis.restarts24h > 2 ? 'crash loop suspected' : 'stable'} />
      </section>

      <Card padded labelledBy="rt">
        <CardHeader flat id="rt" title="Response time" hint="last 24 hours, per check" />
        <LineChart
          label={down ? 'Response time until the outage, then no answer' : 'Response time over 24 hours'}
          series={[{ name: 'response', color: 'nx', values: answered }]}
          height={220}
          max={200}
          span={span}
          dangerFrom={down ? span : undefined}
          yLabels={['200 ms', '150', '100', '50', '0']}
          xLabels={['-24h', '-18h', '-12h', '-6h', down && data.downSince ? `${formatClock(data.downSince, 'min')} outage` : 'now']}
        />
      </Card>

      <Card padded labelledBy="ck">
        <CardHeader
          flat
          id="ck"
          title={`Last ${data.checks.length} checks`}
          end={
            <div className="legend">
              <span><Swatch color="var(--c-ok)" />ok</span>
              <span><Swatch color="var(--c-warn)" />slow</span>
              <span><Swatch color="var(--c-down)" />failed</span>
            </div>
          }
        />
        <StatusStrip statuses={data.checks} height={38} gap={3} radius={3} />
      </Card>

      <div className="cols">
        <Card padded labelledBy="dp" style={{ flex: '3 1 520px', minWidth: 0 }}>
          <CardHeader flat id="dp" title="Dependencies" hint="who talks to whom" />
          {data.dependencies.map((chain, ci) => (
            <div key={ci} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: ci ? 14 : 0 }}>
              {chain.nodes.map((n, i) => (
                <Fragment key={n.name}>
                  <div className={`dep${n.status === 'down' ? ' bad' : ''}`}>
                    <span className="mono" style={{ fontWeight: 500 }}>{n.name}</span>
                    <Pill tone={statusPill[n.status]} style={{ alignSelf: 'flex-start' }}>{n.note}</Pill>
                  </div>
                  {i < chain.nodes.length - 1 && <div className={`arr${chain.broken[i] ? ' bad' : ''}`} aria-hidden="true" />}
                </Fragment>
              ))}
            </div>
          ))}
        </Card>

        <Card padded labelledBy="cf" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <CardHeader flat id="cf" title="Monitor settings" />
          {data.settings.map((s) => (
            <div key={s.label} className="kv">
              <span className="muted">{s.label}</span>
              <span className="mono">{s.value}</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="cols">
        <Card labelledBy="lg2" style={{ flex: '3 1 520px', minWidth: 0, overflow: 'hidden' }}>
          <CardHeader id="lg2" title="Recent logs" hint="click a line for details" link={{ to: routes.logsFor(service.name), label: 'Open in logs' }} />
          <ExpandableLogs entries={data.logs} />
        </Card>
        <Card padded labelledBy="tl" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <CardHeader flat id="tl" title="Timeline" />
          <ol style={{ display: 'flex', flexDirection: 'column', gap: 14, listStyle: 'none', margin: 0, padding: 0 }}>
            {data.timeline.map((e) => (
              <li key={e.title} style={{ display: 'flex', gap: 12 }}>
                <span style={{ marginTop: 7 }}><StatusDot color={TONE_DOT[e.tone]} /></span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{e.title}</div>
                  <div className="mono subtle" style={{ fontSize: 12 }}>{formatWhen(e.when)}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
