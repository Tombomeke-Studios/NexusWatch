import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOverview } from '@/api/queries';
import type { OverviewData, ProjectId, TimeRange } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { BarChart, Legend, LineChart, Sparkline, StatusStrip, XAxis } from '@/components/ui/charts';
import { Kpi, PageHeader, Pill, Segmented, StatusDot, Swatch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatClock, formatEur, formatLatency, formatPercent } from '@/lib/format';
import { axisLabels, TIME_RANGES } from '@/lib/ranges';
import { levelPill, projectColor, projectName, statusText } from '@/lib/status';
import { routes } from '@/routes';

type Filter = 'all' | ProjectId;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'nexusinfra', label: 'NexusInfra' },
  { id: 'finvault', label: 'FinVault' },
];

export function OverviewPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [range, setRange] = useState<TimeRange>('24h');
  const query = useOverview(range);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          <>
            <StatusDot live /> Live · refreshes every {Math.round(config.refreshMs / 1000)} s{config.useMocks && ' · sample data'}
          </>
        }
      >
        <Segmented label="Project filter" options={FILTERS} value={filter} onChange={setFilter} />
        <Segmented label="Time range" options={TIME_RANGES} value={range} onChange={setRange} mono />
      </PageHeader>
      <QueryState query={query} skeletonHeight={900}>
        {(data) => <OverviewBody data={data} filter={filter} range={range} />}
      </QueryState>
    </>
  );
}

function OverviewBody({ data, filter, range }: { data: OverviewData; filter: Filter; range: TimeRange }) {
  const { kpis } = data;
  const services = data.services.filter((s) => filter === 'all' || s.project === filter);
  const xLabels = axisLabels(range);

  return (
    <>
      <section className="kpis" aria-label="Key figures">
        <Kpi
          label="Services online"
          value={kpis.servicesUp}
          unit={`/ ${kpis.servicesTotal}`}
          foot={
            <>
              <span style={{ color: 'var(--warn)' }}>{kpis.servicesSlow} slow</span> · <span style={{ color: 'var(--down)' }}>{kpis.servicesDown} down</span>
            </>
          }
        />
        <Kpi label="Response time p95" value={kpis.p95Ms} unit="ms" foot={<Sparkline values={kpis.p95Trend} color="var(--c-nx)" label="Response time trend" />} />
        <Kpi label="Open alerts" value={kpis.openAlerts} valueColor={kpis.openAlerts ? 'var(--down)' : undefined} foot={kpis.openAlertsSummary} />
        <Kpi
          accent="fv"
          label="FinVault top-ups"
          labelColor="var(--fv)"
          swatch="var(--c-fv)"
          value={kpis.topupsToday}
          unit="today"
          foot={<Sparkline values={kpis.topupsTrend} color="var(--c-fv)" label="Top-up trend" />}
        />
        <Kpi
          accent="nx"
          label="NexusInfra payments"
          labelColor="var(--primary)"
          swatch="var(--c-nx)"
          value={formatEur(kpis.paymentsMonthEur, true)}
          unit="this month"
          foot={<Sparkline values={kpis.paymentsTrend} color="var(--c-nx)" label="Payment trend" />}
        />
      </section>

      <div className="cols">
        <Card labelledBy="hb" style={{ flex: '2 1 560px', minWidth: 0 }}>
          <CardHeader id="hb" title="Heartbeats" hint="last 48 checks · every 30 s" link={{ to: routes.heartbeats, label: 'All monitors' }} />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 8px 10px' }}>
            {services.map((s) => (
              <Link key={s.id} className="row" to={routes.service(s.id)}>
                <div style={{ flex: '1 1 180px', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <StatusDot status={s.status} ring size={10} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div className="subtle" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <Swatch color={projectColor[s.project]} size={7} />
                      {projectName[s.project]} · <span className="mono">{s.port}</span>
                    </div>
                  </div>
                </div>
                <div style={{ flex: '2 1 220px' }}>
                  <StatusStrip statuses={s.beats} />
                </div>
                <div className="mono" style={{ flex: '0 0 64px', textAlign: 'right', fontSize: 13, color: statusText[s.status] }}>{formatLatency(s.latencyMs)}</div>
                <div className="mono muted" style={{ flex: '0 0 66px', textAlign: 'right', fontSize: 13 }}>{formatPercent(s.uptimePct)}</div>
              </Link>
            ))}
          </div>
        </Card>

        <Card labelledBy="ev" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <CardHeader id="ev" title="Recent events" link={{ to: routes.logs, label: 'Open logs' }} />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 8px 12px' }}>
            {data.events.map((e) => (
              <div key={e.id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <Pill tone={levelPill[e.level]} style={{ marginTop: 2 }}>{e.level}</Pill>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>{e.message}</div>
                  <div className="mono subtle" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {formatClock(e.time)} · {e.service}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="cols">
        <Card padded labelledBy="c1" style={{ flex: '1 1 400px', minWidth: 0 }}>
          <CardHeader flat id="c1" title="CPU per node" end={<Legend series={data.cpuByNode} />} />
          <LineChart label="CPU usage per node" series={data.cpuByNode} yLabels={['100%', '75', '50', '25', '0']} xLabels={xLabels} />
        </Card>
        <Card padded labelledBy="c2" style={{ flex: '1 1 400px', minWidth: 0 }}>
          <CardHeader flat id="c2" title="Requests & errors" end={<Legend series={[{ name: 'req/s', color: 'nx' }, { name: '5xx', color: 'down' }]} />} />
          <LineChart
            label="Requests per second and 5xx errors"
            area
            series={[
              { name: 'req/s', color: 'nx', values: data.requests.rps },
              { name: '5xx', color: 'down', values: data.requests.errors5xx },
            ]}
            xLabels={xLabels}
          />
        </Card>
      </div>

      <Card padded labelledBy="biz">
        <CardHeader flat id="biz" title="Business · FinVault ↔ NexusInfra" hint="top-ups per hour and payments for server capacity" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
          <div style={{ flex: '1 1 380px', minWidth: 0 }}>
            <div className="lbl" style={{ color: 'var(--fv)', marginBottom: 10, textTransform: 'none', fontSize: 13 }}>
              <Swatch color="var(--c-fv)" /> FinVault · top-ups per hour
            </div>
            <BarChart values={data.topupsPerHour} color="var(--c-fv)" label="FinVault top-ups per hour" />
            <XAxis labels={['00:00', '06:00', '12:00', '18:00', 'now']} />
          </div>
          <div style={{ flex: '1 1 380px', minWidth: 0 }}>
            <div className="lbl" style={{ color: 'var(--primary)', marginBottom: 10, textTransform: 'none', fontSize: 13 }}>
              <Swatch color="var(--c-nx)" /> NexusInfra · payments per day
            </div>
            <BarChart values={data.paymentsPerDay} color="var(--c-nx)" label="NexusInfra payments per day" />
            <XAxis labels={axisLabels('30d')} />
          </div>
        </div>
      </Card>
    </>
  );
}
