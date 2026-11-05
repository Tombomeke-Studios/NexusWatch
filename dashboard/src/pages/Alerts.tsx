import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcknowledgeAlert, useAlerts, useSetRuleEnabled } from '@/api/queries';
import type { AlertsData } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/charts';
import { Kpi, PageHeader, Pill, Segmented, Swatch, Switch } from '@/components/ui/primitives';
import { EmptyState, QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatDuration, formatWhen } from '@/lib/format';
import { projectColor, projectName, projectPill, severityLabel, severityPill } from '@/lib/status';
import { routes } from '@/routes';

type Tab = 'active' | 'rules' | 'history';

export function AlertsPage() {
  const [tab, setTab] = useState<Tab>('active');
  const query = useAlerts();
  const activeCount = query.data?.active.length;

  return (
    <>
      <PageHeader title="Alerts" subtitle={<>Rules, notifications and history for all your projects{config.useMocks && ' · sample data'}</>}>
        <button type="button" className="btn pri" disabled title="Coming soon">
          + New rule
        </button>
      </PageHeader>

      <QueryState query={query} skeletonHeight={800}>
        {(data) => (
          <>
            <Summary data={data} />
            <div style={{ alignSelf: 'flex-start' }}>
              <Segmented
                tabs
                label="Alert view"
                value={tab}
                onChange={setTab}
                options={[
                  { id: 'active', label: activeCount === undefined ? 'Active' : `Active (${activeCount})` },
                  { id: 'rules', label: 'Rules' },
                  { id: 'history', label: 'History' },
                ]}
              />
            </div>
            {tab === 'active' && <ActiveAlerts data={data} />}
            {tab === 'rules' && <Rules data={data} />}
            {tab === 'history' && <History data={data} />}
          </>
        )}
      </QueryState>
    </>
  );
}

function Summary({ data }: { data: AlertsData }) {
  const s = data.summary;
  const critical = data.active.filter((a) => a.severity === 'critical');
  const warning = data.active.filter((a) => a.severity === 'warning');
  return (
    <section className="kpis" aria-label="Summary">
      <Kpi label="Critical" value={s.critical} valueColor="var(--down)" foot={critical.map((a) => a.title.split(' ')[0]).join(', ') || 'none'} />
      <Kpi label="Warning" value={s.warning} valueColor="var(--warn)" foot={warning.map((a) => a.title.split(' ')[0]).join(', ') || 'none'} />
      <Kpi label="Muted" value={s.muted} foot={s.muted ? `${s.muted} silenced rules` : 'no silenced rules'} />
      <Kpi label="Resolved (24h)" value={s.resolved24h} foot={`${s.resolvedAuto24h} resolved on their own`} />
      <Kpi label="Mean time to recover" value={s.mttrMinutes} unit="min" foot="last 30 days" />
    </section>
  );
}

function ActiveAlerts({ data }: { data: AlertsData }) {
  const ack = useAcknowledgeAlert();
  if (data.active.length === 0) return <Card><EmptyState>No active alerts. Everything is quiet.</EmptyState></Card>;
  return (
    <section aria-label="Active alerts" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.active.map((a) => (
        <article key={a.id} className={`box acard ${a.severity}`}>
          <div style={{ flex: '2 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Pill tone={severityPill[a.severity]}>{severityLabel[a.severity]}</Pill>
              <Pill tone={projectPill[a.project]}>{projectName[a.project]}</Pill>
              {a.acknowledged && <Pill tone="p-mute">acknowledged</Pill>}
              <span className="mono subtle" style={{ fontSize: 12 }}>
                since {formatWhen(a.startedAt)} · ongoing {formatDuration(a.durationSeconds)}
              </span>
            </div>
            <h2 className="h" style={{ fontSize: 18 }}>{a.title}</h2>
            <div className="muted">{a.description}</div>
            <div className="mono" style={{ fontSize: 12.5, background: 'var(--code)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>{a.rule}</div>
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
            <div className="lbl">Current value</div>
            <div className="num" style={{ fontSize: 30, color: a.severity === 'critical' ? 'var(--down)' : 'var(--warn)' }}>{a.value}</div>
            <Sparkline values={a.trend} color={a.severity === 'critical' ? 'var(--c-down)' : 'var(--c-warn)'} label="Trend" height={40} />
          </div>
          <div style={{ flex: '0 1 190px', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn pri" disabled={a.acknowledged || ack.isPending} onClick={() => ack.mutate(a.id)}>
              {a.acknowledged ? 'Acknowledged' : 'Acknowledge'}
            </button>
            <button type="button" className="btn" disabled title="Coming soon">Mute for 1 hour</button>
            <Link className="btn" to={routes.service(a.serviceId)} style={{ color: 'var(--primary)' }}>
              Open service
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}

function Rules({ data }: { data: AlertsData }) {
  const setEnabled = useSetRuleEnabled();
  const enabled = data.rules.filter((r) => r.enabled).length;
  return (
    <Card label="Rules">
      <CardHeader title="Alert rules" hint={`${data.rules.length} rules · ${enabled} enabled`} />
      <div className="tbl">
        <div className="tr th" style={{ minWidth: 820 }}>
          <span style={{ flex: '2 1 200px' }}>Rule</span>
          <span style={{ flex: '3 1 280px' }}>Condition</span>
          <span style={{ flex: '1 1 110px' }}>Project</span>
          <span style={{ flex: '1 1 100px' }}>Severity</span>
          <span style={{ flex: '1 1 110px' }}>Channel</span>
          <span style={{ flex: '0 0 40px' }} />
        </div>
        {data.rules.map((r) => (
          <div key={r.id} className="tr" style={{ minWidth: 820 }}>
            <span style={{ flex: '2 1 200px', fontWeight: 600 }}>{r.name}</span>
            <span className="mono muted" style={{ flex: '3 1 280px', fontSize: 12.5 }}>{r.condition}</span>
            <span className="muted" style={{ flex: '1 1 110px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Swatch color={projectColor[r.project]} />
              {projectName[r.project]}
            </span>
            <span style={{ flex: '1 1 100px' }}><Pill tone={severityPill[r.severity]}>{severityLabel[r.severity]}</Pill></span>
            <span className="muted" style={{ flex: '1 1 110px' }}>{r.channels}</span>
            <Switch on={r.enabled} label={`Rule ${r.name} (${projectName[r.project]}) enabled`} onChange={(v) => setEnabled.mutate({ id: r.id, enabled: v })} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function History({ data }: { data: AlertsData }) {
  return (
    <Card label="History">
      <CardHeader title="History" hint="last 7 days" />
      <div className="tbl">
        <div className="tr th" style={{ minWidth: 700 }}>
          <span style={{ flex: '0 0 90px' }}>Status</span>
          <span style={{ flex: '3 1 300px' }}>Alert</span>
          <span style={{ flex: '1 1 110px' }}>Project</span>
          <span style={{ flex: '1 1 130px' }}>Started</span>
          <span className="r" style={{ flex: '1 1 90px' }}>Duration</span>
        </div>
        {data.history.map((h) => (
          <div key={h.id} className="tr" style={{ minWidth: 700 }}>
            <span style={{ flex: '0 0 90px' }}><Pill tone={h.open ? 'p-down' : 'p-ok'}>{h.open ? 'open' : 'resolved'}</Pill></span>
            <span style={{ flex: '3 1 300px', fontWeight: 600 }}>{h.title}</span>
            <span className="muted" style={{ flex: '1 1 110px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Swatch color={projectColor[h.project]} />
              {projectName[h.project]}
            </span>
            <span className="mono muted" style={{ flex: '1 1 130px' }}>{formatWhen(h.startedAt)}</span>
            <span className="mono r" style={{ flex: '1 1 90px' }}>{formatDuration(h.durationSeconds)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
