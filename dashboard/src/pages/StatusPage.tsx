import { useEffect } from 'react';
import { useStatusPage } from '@/api/queries';
import type { PublicIncident, StatusGroup, StatusPageData } from '@/api/types';
import { Logo } from '@/components/layout/Logo';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusStrip } from '@/components/ui/charts';
import { Icon } from '@/components/ui/Icon';
import { Pill, StatusDot, Swatch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { formatClock, formatPercent, formatWhen } from '@/lib/format';
import { incidentStatusLabel, incidentStatusPill, projectColor, publicStatusColor, publicStatusHeadline, publicStatusLabel, publicStatusPill } from '@/lib/status';
import { useTheme } from '@/theme';
import '@/styles/reliability.css';

/**
 * The public, shareable status page. Rendered outside the app shell: no sidebar, no links into the
 * dashboard, and it reads nothing but `GET /status` (StatusPageData — public-safe fields only).
 */
export function StatusPage() {
  const query = useStatusPage();
  useEffect(() => {
    const previous = document.title;
    document.title = 'Status · NexusInfra & FinVault';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <>
      <div className="bgl" aria-hidden="true">
        <div className="grid" />
        <div className="au au1" />
        <div className="au au2" />
      </div>
      <main className="sp" id="main">
        <header className="sp-top">
          <span className="brand">
            <Logo size={26} />
            <h1 className="t" style={{ fontSize: 24 }}>Service status</h1>
          </span>
          <span className="muted">NexusInfra · FinVault</span>
          <ThemeToggle />
        </header>
        <QueryState query={query} skeletonHeight={900}>
          {(data) => <StatusBody data={data} />}
        </QueryState>
      </main>
    </>
  );
}

function ThemeToggle() {
  const { theme, setPreference } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setPreference(next)} aria-label={`Switch to ${next} theme`}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

function StatusBody({ data }: { data: StatusPageData }) {
  return (
    <>
      <section className="box banner" role="status" style={{ borderLeftColor: publicStatusColor[data.overall] }}>
        <StatusDot size={14} live={data.overall !== 'operational'} color={publicStatusColor[data.overall]} />
        <div style={{ flex: '1 1 260px' }}>
          <div className="num">{publicStatusHeadline[data.overall]}</div>
          <div className="muted small">Updated {formatClock(data.updatedAt, 'min')} · refreshes every minute</div>
        </div>
      </section>

      {data.active.length > 0 && (
        <section aria-labelledby="sp-active" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="h" id="sp-active">Active incidents</h2>
          {data.active.map((i) => <IncidentCard key={i.slug} incident={i} />)}
        </section>
      )}

      {data.maintenance.length > 0 && (
        <Card padded labelledBy="sp-mnt">
          <CardHeader flat id="sp-mnt" title="Scheduled maintenance" />
          {data.maintenance.map((m) => (
            <div key={m.slug} className="rule">
              <Pill tone="p-info">Scheduled</Pill>
              <span style={{ fontWeight: 600 }}>{m.title}</span>
              <span className="mono subtle" style={{ marginLeft: 'auto', fontSize: 12 }}>{formatWhen(m.startsAt)} – {formatClock(m.endsAt, 'min')}</span>
              <span className="muted small" style={{ flexBasis: '100%' }}>{m.description} Affects {m.components.join(', ')}.</span>
            </div>
          ))}
        </Card>
      )}

      {data.groups.map((g) => <GroupCard key={g.project} group={g} />)}

      <Card padded labelledBy="sp-past">
        <CardHeader flat id="sp-past" title="Past incidents" hint="last 14 days" />
        {data.recent.length === 0 && <p className="muted prose">No incidents in the last 14 days.</p>}
        {data.recent.map((i) => (
          <div key={i.slug} className="rule">
            <Pill tone={incidentStatusPill[i.status]}>{incidentStatusLabel[i.status]}</Pill>
            <span style={{ fontWeight: 600 }}>{i.title}</span>
            <span className="mono subtle" style={{ marginLeft: 'auto', fontSize: 12 }}>{formatWhen(i.startedAt)}</span>
            {i.updates[0] && <span className="muted small" style={{ flexBasis: '100%' }}>{i.updates[0].message}</span>}
          </div>
        ))}
      </Card>

      <footer className="sp-foot">
        <span>Times in your local time zone.</span>
        <span>Powered by NexusWatch</span>
      </footer>
    </>
  );
}

function IncidentCard({ incident }: { incident: PublicIncident }) {
  return (
    <article className={`box acard ${incident.impact}`} style={{ flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Pill tone={incidentStatusPill[incident.status]}>{incidentStatusLabel[incident.status]}</Pill>
        <span style={{ fontWeight: 650, fontSize: 16 }}>{incident.title}</span>
        <span className="muted small" style={{ marginLeft: 'auto' }}>since {formatWhen(incident.startedAt)} · {incident.components.join(', ')}</span>
      </div>
      <ol className="updates">
        {incident.updates.map((u) => (
          <li key={u.at + u.status}>
            <StatusDot color={u.status === 'resolved' ? 'var(--c-ok)' : u.status === 'monitoring' ? 'var(--c-nx)' : u.status === 'identified' ? 'var(--c-warn)' : 'var(--c-down)'} size={9} />
            <div className="meta">
              <span style={{ fontWeight: 600 }}>{incidentStatusLabel[u.status]}</span>
              <span className="mono subtle" style={{ fontSize: 12 }}>{formatWhen(u.at)}</span>
            </div>
            <p className="prose" style={{ fontSize: 13.5 }}>{u.message}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}

function GroupCard({ group }: { group: StatusGroup }) {
  const id = `sp-${group.project}`;
  return (
    <Card labelledBy={id} accent={group.project === 'nexusinfra' ? 'nx' : 'fv'}>
      <CardHeader
        id={id}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Swatch color={projectColor[group.project]} />{group.name}</span>}
        end={
          <div className="legend">
            <span><Swatch color="var(--c-ok)" />up</span>
            <span><Swatch color="var(--c-warn)" />degraded</span>
            <span><Swatch color="var(--c-down)" />outage</span>
            <span><Swatch color="var(--border)" />no data</span>
          </div>
        }
      />
      {group.components.map((c) => (
        <div key={c.slug} className="comp">
          <div className="comp-head">
            <span style={{ fontWeight: 600 }}>{c.name}</span>
            <Pill tone={publicStatusPill[c.status]}>{publicStatusLabel[c.status]}</Pill>
            <span className="num" style={{ marginLeft: 'auto', fontSize: 17 }}>{c.uptimePct === null ? 'no data' : formatPercent(c.uptimePct, 2)}</span>
          </div>
          <StatusStrip statuses={c.days} height={28} />
          <div className="mono subtle" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span>90 days ago</span>
            <span>uptime</span>
            <span>today</span>
          </div>
        </div>
      ))}
    </Card>
  );
}
