import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateIncident, useIncidents, useOverview } from '@/api/queries';
import type { IncidentDetail, Severity } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { Kpi, PageHeader, Pill, Segmented, Swatch, Switch } from '@/components/ui/primitives';
import { EmptyState, QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatDuration, formatWhen } from '@/lib/format';
import { incidentStatusLabel, incidentStatusPill, projectColor, severityLabel, severityPill } from '@/lib/status';
import { routes } from '@/routes';
import '@/styles/reliability.css';

export function IncidentsPage() {
  const query = useIncidents();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Incidents" subtitle={<>Declared outages, their updates and postmortems{config.useMocks && ' · sample data'}</>}>
        <Link className="btn" to={routes.status} target="_blank" rel="noreferrer">Public status page ↗</Link>
        {!creating && (
          <button type="button" className="btn pri" onClick={() => setCreating(true)}>+ Declare incident</button>
        )}
      </PageHeader>

      {creating && <NewIncidentForm onClose={() => setCreating(false)} />}

      <QueryState query={query} skeletonHeight={700}>
        {(data) => {
          const open = data.incidents.filter((i) => i.status !== 'resolved');
          const resolved = data.incidents.filter((i) => i.status === 'resolved');
          return (
            <>
              <section className="kpis" aria-label="Summary">
                <Kpi label="Open" value={data.summary.open} valueColor={data.summary.open ? 'var(--down)' : undefined} foot={open.map((i) => incidentStatusLabel[i.status].toLowerCase()).join(', ') || 'none'} />
                <Kpi label="Last 30 days" value={data.summary.last30d} foot="declared incidents" />
                <Kpi label="Mean time to resolve" value={data.summary.mttrMinutes ?? 'no data'} unit={data.summary.mttrMinutes === null ? undefined : 'min'} foot="resolved, last 30 days" />
              </section>
              <IncidentList id="open" title="Open" incidents={open} empty="No open incidents." />
              <IncidentList id="resolved" title="Resolved" incidents={resolved} empty="Nothing resolved yet." />
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function IncidentList({ id, title, incidents, empty }: { id: string; title: string; incidents: IncidentDetail[]; empty: string }) {
  return (
    <Card labelledBy={`il-${id}`}>
      <CardHeader id={`il-${id}`} title={title} hint={incidents.length ? `${incidents.length}` : undefined} />
      {incidents.length === 0 && <EmptyState>{empty}</EmptyState>}
      {incidents.map((i) => (
        <Link key={i.id} className="irow" to={routes.incident(i.id)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 112px' }}>
            <Pill tone={incidentStatusPill[i.status]} style={{ alignSelf: 'flex-start' }}>{incidentStatusLabel[i.status]}</Pill>
            <Pill tone={severityPill[i.severity]} plain style={{ alignSelf: 'flex-start' }}>{severityLabel[i.severity]}</Pill>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 600 }}>{i.title}</span>
            <span className="muted" style={{ fontSize: 13 }}>{i.updates[0]?.message ?? i.summary}</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12.5 }} className="muted">
              {i.affected.map((a) => (
                <span key={a.serviceId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Swatch color={projectColor[a.project]} size={8} />
                  {a.name}
                </span>
              ))}
            </span>
          </div>
          <div className="mono subtle" style={{ fontSize: 12, textAlign: 'right', marginLeft: 'auto' }}>
            {formatWhen(i.startedAt)}
            <br />
            {i.status === 'resolved' ? `lasted ${formatDuration(i.durationSeconds)}` : `ongoing ${formatDuration(i.durationSeconds)}`}
          </div>
        </Link>
      ))}
    </Card>
  );
}

const SEVERITIES = [
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
  { id: 'info', label: 'Info' },
] as const;

function NewIncidentForm({ onClose }: { onClose: () => void }) {
  const services = useOverview('24h').data?.services ?? [];
  const create = useCreateIncident();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity>('critical');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [isPublic, setPublic] = useState(false);
  const [publicTitle, setPublicTitle] = useState('');

  const toggle = (id: string) => setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const canSubmit = title.trim() !== '' && serviceIds.length > 0 && !create.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const created = await create.mutateAsync({ title, severity, serviceIds, message, public: isPublic, publicTitle: isPublic ? publicTitle : undefined });
    navigate(routes.incident(created.id));
  };

  return (
    <Card padded labelledBy="new-inc">
      <CardHeader flat id="new-inc" title="Declare an incident" hint="starts as investigating" />
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label className="field">
            <span>Title</span>
            <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="invoice-service is not responding" required />
          </label>
          <div className="field" style={{ flex: '0 1 auto' }}>
            <span id="sev-l">Severity</span>
            <Segmented label="Severity" small value={severity} onChange={setSeverity} options={SEVERITIES} />
          </div>
        </div>
        <div className="field">
          <span id="aff-l">Affected services</span>
          <div className="svc-pick" role="group" aria-labelledby="aff-l">
            {services.map((s) => (
              <button key={s.id} type="button" aria-pressed={serviceIds.includes(s.id)} onClick={() => toggle(s.id)}>
                <Swatch color={projectColor[s.project]} size={8} />
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>First update</span>
          <textarea className="inp ta" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What is happening, and what is affected?" />
        </label>
        <div className="form-row" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch on={isPublic} onChange={setPublic} label="Show on the public status page" />
            <span className="muted small">Show on the public status page</span>
          </div>
          {isPublic && (
            <label className="field">
              <span>Public title</span>
              <input className="inp" value={publicTitle} onChange={(e) => setPublicTitle(e.target.value)} placeholder="Invoices unavailable — no hosts or ports" />
            </label>
          )}
        </div>
        {create.isError && <div className="form-error" role="alert">{create.error.message}</div>}
        <div className="actions">
          <button type="submit" className="btn pri" disabled={!canSubmit}>{create.isPending ? 'Declaring…' : 'Declare incident'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {serviceIds.length === 0 && <span className="subtle small">Pick at least one affected service.</span>}
        </div>
      </form>
    </Card>
  );
}
