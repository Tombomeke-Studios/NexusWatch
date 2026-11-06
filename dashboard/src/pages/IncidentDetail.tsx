import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useIncident, usePostIncidentUpdate, useResolveIncident } from '@/api/queries';
import type { IncidentDetail, NewIncidentUpdate, Postmortem } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Kpi, PageHeader, Pill, Segmented, StatusDot, Swatch, Switch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatClock, formatDuration, formatWhen } from '@/lib/format';
import { INCIDENT_STEPS, incidentStatusLabel, incidentStatusPill, projectColor, severityLabel, severityPill } from '@/lib/status';
import { routes } from '@/routes';
import '@/styles/reliability.css';

const STEP_DOT = { investigating: 'var(--c-down)', identified: 'var(--c-warn)', monitoring: 'var(--c-nx)', resolved: 'var(--c-ok)' } as const;

export function IncidentDetailPage() {
  const { incidentId = '' } = useParams();
  const query = useIncident(incidentId);
  return (
    <QueryState query={query} skeletonHeight={900}>
      {(data) => <IncidentBody incident={data} />}
    </QueryState>
  );
}

function IncidentBody({ incident }: { incident: IncidentDetail }) {
  const open = incident.status !== 'resolved';
  const [resolving, setResolving] = useState(false);
  const step = INCIDENT_STEPS.indexOf(incident.status);

  return (
    <>
      <nav className="crumb" aria-label="Breadcrumb">
        <Link to={routes.incidents}>Incidents</Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }} aria-current="page">{incident.title}</span>
      </nav>

      <PageHeader
        title={incident.title}
        subtitle={
          <>
            <Pill tone={incidentStatusPill[incident.status]}>{incidentStatusLabel[incident.status]}</Pill>
            <Pill tone={severityPill[incident.severity]} plain>{severityLabel[incident.severity]}</Pill>
            <span>started {formatWhen(incident.startedAt)}{config.useMocks && ' · sample data'}</span>
          </>
        }
      >
        {open && !resolving && (
          <button type="button" className="btn pri" onClick={() => setResolving(true)}>Resolve…</button>
        )}
      </PageHeader>

      <Card padded label="Lifecycle">
        <ol className="steps">
          {INCIDENT_STEPS.map((s, i) => (
            <li key={s} className={`${i < step ? 'done' : i === step ? 'now' : ''}${s === 'resolved' ? ' resolved' : ''}`} aria-current={i === step ? 'step' : undefined}>
              {incidentStatusLabel[s]}
            </li>
          ))}
        </ol>
      </Card>

      <section className="kpis" aria-label="Key figures">
        <Kpi label={open ? 'Ongoing for' : 'Lasted'} value={formatDuration(incident.durationSeconds)} valueColor={open ? 'var(--down)' : undefined} foot={open ? `since ${formatClock(incident.startedAt, 'min')}` : `resolved ${formatWhen(incident.resolvedAt!)}`} />
        <Kpi label="Affected services" value={incident.affected.length} foot={incident.affected.map((a) => a.name).join(', ')} />
        <Kpi label="Updates" value={incident.updates.length} foot={`${incident.updates.filter((u) => u.public).length} public`} />
        <Kpi label="Status page" value={incident.public ? 'Public' : 'Internal'} valueStyle={{ fontSize: 26 }} foot={incident.public ? `as “${incident.publicTitle}”` : 'not shown publicly'} />
      </section>

      {resolving && open && <ResolveForm incident={incident} onClose={() => setResolving(false)} />}

      <div className="cols">
        <Card padded labelledBy="upd" style={{ flex: '3 1 520px', minWidth: 0 }}>
          <CardHeader flat id="upd" title="Updates" hint="newest first" />
          {open && <UpdateForm incident={incident} />}
          <ol className="updates" style={{ marginTop: open ? 18 : 0 }}>
            {incident.updates.map((u) => (
              <li key={u.id}>
                <StatusDot color={STEP_DOT[u.status]} size={9} />
                <div className="meta">
                  <span style={{ fontWeight: 600 }}>{incidentStatusLabel[u.status]}</span>
                  <span className="mono subtle" style={{ fontSize: 12 }}>{formatWhen(u.at)} · {u.author}</span>
                  {!u.public && <Pill tone="p-mute" plain>internal</Pill>}
                </div>
                <p className="prose" style={{ fontSize: 13.5 }}>{u.message}</p>
              </li>
            ))}
          </ol>
        </Card>

        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card padded labelledBy="aff">
            <CardHeader flat id="aff" title="Affected services" />
            {incident.affected.map((a) => (
              <Link key={a.serviceId} to={routes.service(a.serviceId)} className="row" style={{ padding: '9px 8px', margin: '0 -8px' }}>
                <Swatch color={projectColor[a.project]} />
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                <span className="subtle" style={{ marginLeft: 'auto' }}>→</span>
              </Link>
            ))}
          </Card>
          <Card padded labelledBy="pm-s">
            <CardHeader flat id="pm-s" title="Timeline" />
            <div className="kv"><span className="muted">Started</span><span className="mono">{formatWhen(incident.startedAt)}</span></div>
            {[...incident.updates].reverse().filter((u, i, all) => i === 0 || u.status !== all[i - 1].status).slice(1).map((u) => (
              <div key={u.id} className="kv"><span className="muted">{incidentStatusLabel[u.status]}</span><span className="mono">{formatWhen(u.at)}</span></div>
            ))}
          </Card>
        </div>
      </div>

      <PostmortemCard incident={incident} />
    </>
  );
}

const OPEN_STEPS = INCIDENT_STEPS.filter((s): s is NewIncidentUpdate['status'] => s !== 'resolved').map((id) => ({ id, label: incidentStatusLabel[id] }));

function UpdateForm({ incident }: { incident: IncidentDetail }) {
  const post = usePostIncidentUpdate(incident.id);
  const [status, setStatus] = useState<NewIncidentUpdate['status']>(incident.status === 'resolved' ? 'monitoring' : incident.status);
  const [message, setMessage] = useState('');
  const [isPublic, setPublic] = useState(incident.public);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    await post.mutateAsync({ status, message, public: isPublic });
    setMessage('');
  };

  return (
    <form className="form" onSubmit={submit} aria-label="Post an update" style={{ padding: 14, borderRadius: 12, background: 'var(--surface2)' }}>
      <Segmented label="New status" small value={status} onChange={setStatus} options={OPEN_STEPS} />
      <label className="field">
        <span>Update</span>
        <textarea className="inp ta" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What changed?" />
      </label>
      {post.isError && <div className="form-error" role="alert">{post.error.message}</div>}
      <div className="actions">
        <button type="submit" className="btn pri sm" disabled={!message.trim() || post.isPending}>{post.isPending ? 'Posting…' : 'Post update'}</button>
        <Switch on={isPublic} onChange={setPublic} label="Public update" disabled={!incident.public} />
        <span className="muted small">{incident.public ? 'public — no hosts, ports or IPs' : 'internal incident'}</span>
      </div>
    </form>
  );
}

/** "Title — owner" per line; the owner is optional. */
function parseActionItems(text: string): Postmortem['actionItems'] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [title, owner] = line.split(/\s+[—-]\s+/);
      return { id: `ai_new_${i}`, title: title.trim(), owner: owner?.trim() || 'unassigned', done: false };
    });
}

function ResolveForm({ incident, onClose }: { incident: IncidentDetail; onClose: () => void }) {
  const resolve = useResolveIncident(incident.id);
  const [message, setMessage] = useState('');
  const [isPublic, setPublic] = useState(incident.public);
  const [summary, setSummary] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [actions, setActions] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const hasPostmortem = summary.trim() || rootCause.trim() || actions.trim();
    await resolve.mutateAsync({
      message,
      public: isPublic,
      postmortem: hasPostmortem ? { summary: summary.trim(), rootCause: rootCause.trim(), actionItems: parseActionItems(actions) } : null,
    });
    onClose();
  };

  return (
    <Card padded labelledBy="res">
      <CardHeader flat id="res" title="Resolve incident" hint="the postmortem can be filled in now or left empty" />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Closing update</span>
          <textarea className="inp ta" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="This incident has been resolved." />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Postmortem summary</span>
            <textarea className="inp ta" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened and who noticed?" />
          </label>
          <label className="field">
            <span>Root cause</span>
            <textarea className="inp ta" value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Why did it happen?" />
          </label>
        </div>
        <label className="field">
          <span>Action items — one per line, “title — owner”</span>
          <textarea className="inp ta" value={actions} onChange={(e) => setActions(e.target.value)} placeholder="Alert on queue consumers = 0 — tom" />
        </label>
        {resolve.isError && <div className="form-error" role="alert">{resolve.error.message}</div>}
        <div className="actions">
          <button type="submit" className="btn pri" disabled={resolve.isPending}>{resolve.isPending ? 'Resolving…' : 'Resolve incident'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <Switch on={isPublic} onChange={setPublic} label="Public closing update" disabled={!incident.public} />
          <span className="muted small">{isPublic ? 'closing update is public' : 'closing update is internal'}</span>
        </div>
      </form>
    </Card>
  );
}

function PostmortemCard({ incident }: { incident: IncidentDetail }) {
  const pm = incident.postmortem;
  return (
    <Card padded labelledBy="pm">
      <CardHeader flat id="pm" title="Postmortem" hint={pm ? 'blameless' : undefined} />
      {!pm ? (
        <p className="muted prose">
          {incident.status === 'resolved' ? 'No postmortem was written for this incident.' : 'Written when the incident is resolved: summary, root cause and action items.'}
        </p>
      ) : (
        <div className="cols" style={{ gap: 24 }}>
          <div style={{ flex: '2 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section aria-labelledby="pm-sum">
              <div className="lbl" id="pm-sum" style={{ marginBottom: 6 }}>Summary</div>
              <p className="prose">{pm.summary || '—'}</p>
            </section>
            <section aria-labelledby="pm-rc">
              <div className="lbl" id="pm-rc" style={{ marginBottom: 6 }}>Root cause</div>
              <p className="prose">{pm.rootCause || '—'}</p>
            </section>
          </div>
          <section aria-labelledby="pm-ai" style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div className="lbl" id="pm-ai" style={{ marginBottom: 6 }}>
              Action items · {pm.actionItems.filter((a) => a.done).length}/{pm.actionItems.length} done
            </div>
            {pm.actionItems.length === 0 && <p className="muted prose">None.</p>}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {pm.actionItems.map((a) => (
                <li key={a.id} className="kv" style={{ justifyContent: 'flex-start', alignItems: 'flex-start' }}>
                  <span className={`chk${a.done ? ' on' : ''}`} aria-hidden="true" style={{ flex: '0 0 22px', cursor: 'default' }}>{a.done && <Icon name="check" style={{ width: 14, height: 14 }} />}</span>
                  <span style={{ flex: 1, minWidth: 0, textDecoration: a.done ? 'line-through' : undefined, color: a.done ? 'var(--muted)' : undefined }}>
                    {a.title}
                    <span className="sr-only">{a.done ? ' (done)' : ' (open)'}</span>
                  </span>
                  <span className="mono subtle" style={{ fontSize: 12 }}>{a.owner}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Card>
  );
}
