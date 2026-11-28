import { useState } from 'react';
import { useMetric, useMetricsOverview } from '@/api/queries';
import type { MetricData, MetricId, TimeRange } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { Legend, LineChart, Meter, Sparkline } from '@/components/ui/charts';
import { Icon } from '@/components/ui/Icon';
import { PageHeader, Pill, Segmented, Swatch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatBytes, formatNumber } from '@/lib/format';
import { axisLabels, TIME_RANGES } from '@/lib/ranges';
import { stats } from '@/lib/series';
import { chartColor, projectColor, projectName } from '@/lib/status';
import { routes } from '@/routes';

const METRIC_TABS: { id: MetricId; label: string }[] = [
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: 'Memory' },
  { id: 'disk', label: 'Disk' },
  { id: 'network', label: 'Network' },
  { id: 'queues', label: 'Queues' },
];

const TONE_PILL = { ok: 'p-ok', warn: 'p-warn', down: 'p-down', info: 'p-info', mute: 'p-mute' } as const;

export function MetricsPage() {
  const [range, setRange] = useState<TimeRange>('24h');
  const [metricId, setMetricId] = useState<MetricId>('cpu');
  const metric = useMetric(metricId, range);
  const overview = useMetricsOverview(range);

  return (
    <>
      <PageHeader title="Metrics" subtitle={<>Resources, network and queues across every node and project{config.useMocks && ' · sample data'}</>}>
        <Segmented label="Time range" options={TIME_RANGES} value={range} onChange={setRange} mono />
      </PageHeader>

      <label className="box search">
        <Icon name="search" className="muted" />
        <span className="sr-only">Metric query</span>
        <input type="text" readOnly value={metric.data?.query ?? ''} />
        <Pill tone="p-mute">Query</Pill>
      </label>

      <div style={{ alignSelf: 'flex-start' }}>
        <Segmented label="Metric" options={METRIC_TABS} value={metricId} onChange={setMetricId} tabs />
      </div>

      <QueryState query={metric} skeletonHeight={480}>
        {(data) => <MetricChart data={data} range={range} />}
      </QueryState>

      <QueryState query={overview} skeletonHeight={420}>
        {(data) => (
          <>
            <section aria-label="Summary" style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {data.summaries.map((m) => (
                <div key={m.title} className="box" style={{ flex: '1 1 280px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="lbl">{m.title}</span>
                    <Pill tone={TONE_PILL[m.tone]} style={{ marginLeft: 'auto' }}>{m.delta}</Pill>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span className="num" style={{ fontSize: 28 }}>{m.value}</span>
                    <span className="num subtle" style={{ fontSize: 15 }}>{m.unit}</span>
                  </div>
                  <Sparkline values={m.trend} color={chartColor(m.color)} label={`${m.title} trend`} height={36} />
                </div>
              ))}
            </section>

            <Card labelledBy="top">
              <CardHeader id="top" title="Top consumers" hint="containers by CPU, last 5 min" link={{ to: routes.project('nexusinfra'), label: 'All containers' }} />
              <div className="tbl">
                <div className="tr th">
                  <span style={{ flex: '2 1 200px' }}>Container</span>
                  <span style={{ flex: '1 1 100px' }}>Project</span>
                  <span style={{ flex: '1 1 80px' }}>Node</span>
                  <span style={{ flex: '2 1 200px' }}>CPU</span>
                  <span className="r" style={{ flex: '1 1 90px' }}>Memory</span>
                </div>
                {data.topContainers.map((c) => (
                  <div key={c.name} className="tr">
                    <span className="mono" style={{ flex: '2 1 200px', fontWeight: 500 }}>{c.name}</span>
                    <span className="muted" data-label="Project" style={{ flex: '1 1 100px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Swatch color={projectColor[c.project]} />
                      {projectName[c.project]}
                    </span>
                    <span className="mono muted" data-label="Node" style={{ flex: '1 1 80px' }}>{c.node}</span>
                    <span data-label="CPU" style={{ flex: '2 1 200px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Meter pct={c.cpuPct} color={c.cpuPct > 70 ? 'var(--c-warn)' : projectColor[c.project]} style={{ flex: 1 }} />
                      <span className="mono r" style={{ width: 44 }}>{c.cpuPct}%</span>
                    </span>
                    <span className="mono muted r" data-label="Memory" style={{ flex: '1 1 90px' }}>{formatBytes(c.memoryBytes)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </QueryState>
    </>
  );
}

function MetricChart({ data, range }: { data: MetricData; range: TimeRange }) {
  const pct = data.unit === '%';
  const fmt = (v: number) => `${formatNumber(v)}${pct ? '%' : ` ${data.unit}`}`;
  const yLabels = [100, 75, 50, 25, 0].map((v) => `${(v / 100) * data.max}${pct ? '%' : ''}`);

  return (
    <>
      <Card padded labelledBy="big">
        <div className="bh flat" style={{ paddingBottom: 14 }}>
          <div>
            <h2 className="h" id="big">{data.title}</h2>
            <div className="subtle" style={{ fontSize: 13 }}>{data.description}</div>
          </div>
          <div className="end"><Legend series={data.series} /></div>
        </div>
        <LineChart label={`${data.title} over time`} series={data.series} slots={90} height={280} max={data.max} yLabels={yLabels} xLabels={axisLabels(range, 7)} />
      </Card>

      <Card labelledBy="st">
        <CardHeader id="st" title="Statistics" hint="over the selected range" />
        <div className="tbl">
          <div className="tr th">
            <span style={{ flex: '2 1 180px' }}>Series</span>
            {['Min', 'Avg', 'p95', 'Max', 'Last'].map((h) => (
              <span key={h} className="r" style={{ flex: '1 1 80px' }}>{h}</span>
            ))}
          </div>
          {data.series.map((s) => {
            const st = stats(s.values);
            return (
              <div key={s.name} className="tr mono">
                <span style={{ flex: '2 1 180px', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>
                  <Swatch color={chartColor(s.color)} />
                  {s.name}
                </span>
                {[st.min, st.avg, st.p95, st.max].map((v, i) => (
                  <span key={i} className="muted r" data-label={['Min', 'Avg', 'p95', 'Max'][i]} style={{ flex: '1 1 80px' }}>{fmt(v)}</span>
                ))}
                <span className="r" data-label="Last" style={{ flex: '1 1 80px', fontWeight: 500 }}>{fmt(st.last)}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
