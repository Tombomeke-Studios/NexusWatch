import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDeleteMaintenance, useDeletePolicy, useDeleteSilence, useSetRuleEnabled } from '@/api/queries';
import type { ActiveAlert, AlertHistoryItem, AlertRule, AlertsData, EscalationPolicy, MaintenanceWindow, ProjectId, Severity } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/charts';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Pill, Segmented, Swatch, Switch } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/QueryState';
import { formatDuration, formatWeekly, formatWhen } from '@/lib/format';
import {
  ALL_HISTORY, escalationProgress, filterHistory, formatCondition, formatCountdown, formatPolicy, formatSpan, remainingSeconds,
  windowOccurrence, type HistoryFilter, type StepState,
} from '@/lib/rules';
import { projectColor, projectName, projectPill, severityLabel, severityPill } from '@/lib/status';
import { useNow } from '@/lib/useNow';
import { routes } from '@/routes';
import { MaintenanceDialog, MuteDialog, NoteDialog, PolicyEditor, type MuteTarget } from './dialogs';
import { useChannels } from './shared';

type NoteAction = { action: 'acknowledge' | 'resolve'; alert: { id: string; title: string } };

const STEP_PILL: Record<StepState, string> = { sent: 'p-ok', upcoming: 'p-info', skipped: 'p-mute', paused: 'p-warn', suppressed: 'p-mute' };

function ProjectCell({ project, flex }: { project: ProjectId; flex: string }) {
  return (
    <span className="muted" style={{ flex, display: 'flex', alignItems: 'center', gap: 8 }}>
      <Swatch color={projectColor[project]} />
      {projectName[project]}
    </span>
  );
}

function SilenceLeft({ endsAt, now }: { endsAt: string | null; now: number }) {
  const left = remainingSeconds(endsAt, now);
  return <>{left === null ? 'until resolved' : `${formatCountdown(left)} left`}</>;
}

// ── Active ─────────────────────────────────────────────────────────────
export function ActiveAlerts({ data }: { data: AlertsData }) {
  const [note, setNote] = useState<NoteAction | null>(null);
  const [mute, setMute] = useState<MuteTarget | null>(null);
  const unmute = useDeleteSilence();
  const now = useNow();
  if (data.active.length === 0) return <Card><EmptyState>No active alerts. Everything is quiet.</EmptyState></Card>;
  return (
    <section aria-label="Active alerts" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.active.map((a) => {
        const rule = data.rules.find((r) => r.id === a.ruleId);
        const silence = data.silences.find((s) => s.id === a.silenceId);
        const window = data.maintenance.find((w) => w.id === a.maintenanceId);
        const tone = a.severity === 'critical' ? 'down' : 'warn';
        return (
          <article key={a.id} className={`box acard ${a.severity}`} aria-label={a.title}>
            <div style={{ flex: '2 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Pill tone={severityPill[a.severity]}>{severityLabel[a.severity]}</Pill>
                <Pill tone={projectPill[a.project]}>{projectName[a.project]}</Pill>
                {a.acknowledged && <Pill tone="p-mute">acknowledged</Pill>}
                {silence && <Pill tone="p-mute">muted · <SilenceLeft endsAt={silence.endsAt} now={now} /></Pill>}
                {window && <Pill tone="p-info">in maintenance · notifications suppressed</Pill>}
                <span className="mono subtle" style={{ fontSize: 12 }}>
                  since {formatWhen(a.startedAt)} · ongoing {formatDuration(a.durationSeconds)}
                </span>
              </div>
              <h2 className="h" style={{ fontSize: 18 }}>{a.title}</h2>
              <div className="muted">{a.description}</div>
              {window && <div className="muted small">Maintenance: {window.title}</div>}
              <div className="mono" style={{ fontSize: 12.5, background: 'var(--code)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', overflowWrap: 'anywhere' }}>{a.rule}</div>
              <Escalation alert={a} rule={rule} policies={data.policies} now={now} />
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
              <div className="lbl">Current value</div>
              <div className="num" style={{ fontSize: 30, color: `var(--${tone})` }}>{a.value}</div>
              <Sparkline values={a.trend} color={`var(--c-${tone})`} label="Trend" height={40} />
            </div>
            <div style={{ flex: '0 1 190px', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
              <button type="button" className="btn pri" disabled={a.acknowledged} onClick={() => setNote({ action: 'acknowledge', alert: a })}>
                {a.acknowledged ? 'Acknowledged' : 'Acknowledge'}
              </button>
              <button type="button" className="btn" onClick={() => setNote({ action: 'resolve', alert: a })}>Resolve</button>
              {silence ? (
                <button type="button" className="btn" disabled={unmute.isPending} onClick={() => unmute.mutate(silence.id)}>Unmute</button>
              ) : (
                <button type="button" className="btn" onClick={() => setMute({ kind: 'alert', id: a.id, label: a.title, canWaitForResolve: true })}>Mute…</button>
              )}
              <Link className="btn" to={routes.service(a.serviceId)} style={{ color: 'var(--primary)' }}>Open service</Link>
              {rule?.runbookUrl && <a className="btn" href={rule.runbookUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Runbook ↗</a>}
            </div>
          </article>
        );
      })}
      {note && <NoteDialog action={note.action} alert={note.alert} onClose={() => setNote(null)} />}
      {mute && <MuteDialog target={mute} onClose={() => setMute(null)} />}
    </section>
  );
}

function Escalation({ alert, rule, policies, now }: { alert: ActiveAlert; rule?: AlertRule; policies: EscalationPolicy[]; now: number }) {
  const { name } = useChannels();
  const policy = policies.find((p) => p.id === rule?.escalationPolicyId);
  if (!policy) return <div className="subtle small">No escalation policy · notified {rule ? rule.channels.map(name).join(', ') : '—'}</div>;
  const started = Date.parse(alert.startedAt);
  const progress = escalationProgress(policy, {
    elapsedSeconds: Math.max(0, (now - started) / 1000),
    acknowledgedAfterSeconds: alert.acknowledgedAt ? Math.max(0, (Date.parse(alert.acknowledgedAt) - started) / 1000) : null,
    silenced: alert.silenceId !== null,
    inMaintenance: alert.maintenanceId !== null,
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="lbl">Escalation · {policy.name}</div>
      <ol className="esc" aria-label={`Escalation ${policy.name}`}>
        {progress.map((p, i) => (
          <li key={i}>
            <span className="small" style={{ fontWeight: 600 }}>{name(p.step.channel)}</span>
            <span className="subtle small">{p.step.afterMinutes === 0 ? 'at once' : `+${formatSpan(p.step.afterMinutes * 60)}`}</span>
            <Pill tone={STEP_PILL[p.state]}>{p.state === 'upcoming' ? `in ${formatCountdown(p.inSeconds ?? 0)}` : p.state}</Pill>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Rules ──────────────────────────────────────────────────────────────
export function RulesPanel({ data, onEdit, onNew }: { data: AlertsData; onEdit: (rule: AlertRule) => void; onNew: () => void }) {
  const setEnabled = useSetRuleEnabled();
  const [mute, setMute] = useState<MuteTarget | null>(null);
  const { name } = useChannels();
  const enabled = data.rules.filter((r) => r.enabled).length;
  const W = 1040;
  return (
    <Card label="Rules">
      <CardHeader title="Alert rules" hint={`${data.rules.length} rules · ${enabled} enabled`} end={<button type="button" className="btn sm" onClick={onNew}>+ New rule</button>} />
      {data.rules.length === 0 ? (
        <EmptyState>No rules yet. Create one to start alerting.</EmptyState>
      ) : (
        <div className="tbl">
          <div className="tr th" style={{ minWidth: W }}>
            <span style={{ flex: '2 1 190px' }}>Rule</span>
            <span style={{ flex: '3 1 230px' }}>Condition</span>
            <span style={{ flex: '1 1 110px' }}>Project</span>
            <span style={{ flex: '1 1 90px' }}>Severity</span>
            <span style={{ flex: '1 1 130px' }}>Channels</span>
            <span style={{ flex: '1 1 110px' }}>Escalation</span>
            <span style={{ flex: '0 0 130px' }}>Actions</span>
            <span style={{ flex: '0 0 40px' }} />
          </div>
          {data.rules.map((r) => {
            const silence = data.silences.find((s) => s.kind === 'rule' && s.targetId === r.id);
            const label = `${r.name} (${projectName[r.project]})`;
            return (
              <div key={r.id} className="tr" style={{ minWidth: W }}>
                <span style={{ flex: '2 1 190px', fontWeight: 600, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {r.name}
                  {silence && <Pill tone="p-mute">muted</Pill>}
                </span>
                <span className="mono muted" style={{ flex: '3 1 230px', fontSize: 12.5 }}>{formatCondition(r.condition)}</span>
                <ProjectCell project={r.project} flex="1 1 110px" />
                <span style={{ flex: '1 1 90px' }}><Pill tone={severityPill[r.severity]}>{severityLabel[r.severity]}</Pill></span>
                <span className="muted" style={{ flex: '1 1 130px' }}>{r.channels.map(name).join(' + ')}</span>
                <span className="muted" style={{ flex: '1 1 110px' }}>{data.policies.find((p) => p.id === r.escalationPolicyId)?.name ?? '—'}</span>
                <span style={{ flex: '0 0 130px', display: 'flex', gap: 6 }}>
                  <button type="button" className="btn sm" aria-label={`Edit ${label}`} onClick={() => onEdit(r)}>Edit</button>
                  <button type="button" className="btn sm" aria-label={`Mute ${label}`} disabled={!!silence} onClick={() => setMute({ kind: 'rule', id: r.id, label, canWaitForResolve: data.active.some((a) => a.ruleId === r.id) })}>Mute</button>
                </span>
                <Switch on={r.enabled} label={`Rule ${label} enabled`} onChange={(v) => setEnabled.mutate({ id: r.id, enabled: v })} />
              </div>
            );
          })}
        </div>
      )}
      {mute && <MuteDialog target={mute} onClose={() => setMute(null)} />}
    </Card>
  );
}

// ── Silences ───────────────────────────────────────────────────────────
export function SilencesPanel({ data }: { data: AlertsData }) {
  const unmute = useDeleteSilence();
  const now = useNow();
  return (
    <Card label="Silences">
      <CardHeader title="Silences" hint="muted alerts and rules send no notifications and pause escalation" />
      {data.silences.length === 0 ? (
        <EmptyState>Nothing is muted.</EmptyState>
      ) : (
        <ul className="plain-list">
          {data.silences.map((s) => (
            <li key={s.id} className="list-row">
              <div style={{ flex: '2 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Pill tone="p-mute">{s.kind}</Pill>
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                </div>
                <div className="muted small">{s.reason} · muted {formatWhen(s.createdAt)}</div>
              </div>
              <span className="mono" style={{ flex: '0 0 auto' }} aria-label="Time left"><SilenceLeft endsAt={s.endsAt} now={now} /></span>
              <button type="button" className="btn sm" aria-label={`Unmute ${s.label}`} disabled={unmute.isPending} onClick={() => unmute.mutate(s.id)}>Unmute</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Maintenance ────────────────────────────────────────────────────────
function windowStatus(w: MaintenanceWindow, now: number): { tone: string; text: string } {
  const occ = windowOccurrence(w, now);
  if (!occ) return { tone: 'p-mute', text: 'ended' };
  if (occ.start <= now) return { tone: 'p-info', text: `active · ${formatCountdown((occ.end - now) / 1000)} left` };
  return { tone: 'p-mute', text: `next ${formatWhen(new Date(occ.start).toISOString())}` };
}

export function MaintenancePanel({ data }: { data: AlertsData }) {
  const [editing, setEditing] = useState<MaintenanceWindow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MaintenanceWindow | null>(null);
  const remove = useDeleteMaintenance();
  const now = useNow(10_000);
  return (
    <Card label="Maintenance windows">
      <CardHeader title="Maintenance windows" hint="alerts inside a window send no notifications" end={<button type="button" className="btn sm" onClick={() => setEditing('new')}>+ Schedule</button>} />
      {data.maintenance.length === 0 ? (
        <EmptyState>No maintenance scheduled.</EmptyState>
      ) : (
        <ul className="plain-list">
          {data.maintenance.map((w) => {
            const status = windowStatus(w, now);
            const service = data.services.find((s) => s.id === w.serviceId);
            return (
              <li key={w.id} className="list-row">
                <div style={{ flex: '2 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{w.title}</span>
                    <Pill tone={status.tone}>{status.text}</Pill>
                  </div>
                  <div className="muted small" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <Swatch color={projectColor[w.project]} />
                    {projectName[w.project]} · {service ? service.name : 'whole project'} ·{' '}
                    {w.recurrence === 'weekly' ? `every ${formatWeekly(w.startsAt)}` : formatWhen(w.startsAt)} for {formatSpan(w.durationMinutes * 60)}
                  </div>
                </div>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn sm" aria-label={`Edit ${w.title}`} onClick={() => setEditing(w)}>Edit</button>
                  <button type="button" className="btn sm danger" aria-label={`Delete ${w.title}`} onClick={() => setDeleting(w)}>Delete</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <MaintenanceDialog window={editing === 'new' ? null : editing} services={data.services} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog title={`Delete "${deleting.title}"?`} confirmLabel="Delete window" busy={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}>
          Alerts in this scope will notify again straight away.
        </ConfirmDialog>
      )}
    </Card>
  );
}

// ── Escalation policies ────────────────────────────────────────────────
export function EscalationPanel({ data }: { data: AlertsData }) {
  const [editing, setEditing] = useState<EscalationPolicy | 'new' | null>(null);
  const [deleting, setDeleting] = useState<EscalationPolicy | null>(null);
  const remove = useDeletePolicy();
  const { name } = useChannels();
  return (
    <Card label="Escalation policies">
      <CardHeader title="Escalation policies" hint="what happens while nobody acknowledges" end={<button type="button" className="btn sm" onClick={() => setEditing('new')}>+ New policy</button>} />
      {data.policies.length === 0 ? (
        <EmptyState>No policies. Rules then notify their channels once.</EmptyState>
      ) : (
        <ul className="plain-list">
          {data.policies.map((p) => {
            const used = data.rules.filter((r) => r.escalationPolicyId === p.id).length;
            return (
              <li key={p.id} className="list-row">
                <div style={{ flex: '2 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span className="mono muted small">{formatPolicy(p.steps, name)}</span>
                  <span className="subtle small">used by {used} {used === 1 ? 'rule' : 'rules'}</span>
                </div>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn sm" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>Edit</button>
                  <button type="button" className="btn sm danger" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>Delete</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <PolicyEditor policy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog title={`Delete "${deleting.name}"?`} confirmLabel="Delete policy" busy={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}>
          Rules that use it will only notify their own channels.
        </ConfirmDialog>
      )}
    </Card>
  );
}

// ── History ────────────────────────────────────────────────────────────
const PROJECT_FILTER: { id: HistoryFilter['project']; label: string }[] = [{ id: 'all', label: 'All projects' }, { id: 'nexusinfra', label: 'NexusInfra' }, { id: 'finvault', label: 'FinVault' }];
const SEVERITY_FILTER: { id: Severity | 'all'; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'critical', label: 'Critical' }, { id: 'warning', label: 'Warning' }, { id: 'info', label: 'Info' }];
const STATE_FILTER: { id: HistoryFilter['state']; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'open', label: 'Open' }, { id: 'resolved', label: 'Resolved' }];

export function HistoryPanel({ data }: { data: AlertsData }) {
  const [filter, setFilter] = useState<HistoryFilter>(ALL_HISTORY);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<NoteAction | null>(null);
  const items = filterHistory(data.history, filter);
  const W = 760;
  return (
    <Card label="History">
      <CardHeader title="History" hint={`last 7 days · ${items.length} of ${data.history.length}`} />
      <div className="filters" role="group" aria-label="History filters">
        <Segmented small label="Project" options={PROJECT_FILTER} value={filter.project} onChange={(project) => setFilter({ ...filter, project })} />
        <Segmented small label="Severity" options={SEVERITY_FILTER} value={filter.severity} onChange={(severity) => setFilter({ ...filter, severity })} />
        <Segmented small label="Status" options={STATE_FILTER} value={filter.state} onChange={(state) => setFilter({ ...filter, state })} />
      </div>
      {items.length === 0 ? (
        <EmptyState>No alerts match these filters.</EmptyState>
      ) : (
        <div className="tbl">
          <div className="tr th" style={{ minWidth: W }}>
            <span style={{ flex: '0 0 90px' }}>Status</span>
            <span style={{ flex: '3 1 260px' }}>Alert</span>
            <span style={{ flex: '1 1 90px' }}>Severity</span>
            <span style={{ flex: '1 1 110px' }}>Project</span>
            <span style={{ flex: '1 1 120px' }}>Started</span>
            <span className="r" style={{ flex: '1 1 80px' }}>Duration</span>
          </div>
          {items.map((h) => (
            <Fragment key={h.id}>
              <button type="button" className="tr hrow" style={{ minWidth: W }} aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                <span style={{ flex: '0 0 90px' }}><Pill tone={h.open ? 'p-down' : 'p-ok'}>{h.open ? 'open' : 'resolved'}</Pill></span>
                <span style={{ flex: '3 1 260px', fontWeight: 600 }}>
                  {h.title}
                  {h.notes.length > 0 && <span className="subtle small" style={{ fontWeight: 400 }}> · {h.notes.length} {h.notes.length === 1 ? 'note' : 'notes'}</span>}
                </span>
                <span style={{ flex: '1 1 90px' }}><Pill tone={severityPill[h.severity]}>{severityLabel[h.severity]}</Pill></span>
                <ProjectCell project={h.project} flex="1 1 110px" />
                <span className="mono muted" style={{ flex: '1 1 120px' }}>{formatWhen(h.startedAt)}</span>
                <span className="mono r" style={{ flex: '1 1 80px' }}>{formatDuration(h.durationSeconds)}</span>
              </button>
              {open === h.id && <HistoryNotes item={h} acknowledged={data.active.find((a) => a.id === h.alertId)?.acknowledged ?? true} onAction={setNote} />}
            </Fragment>
          ))}
        </div>
      )}
      {note && <NoteDialog action={note.action} alert={note.alert} onClose={() => setNote(null)} />}
    </Card>
  );
}

function HistoryNotes({ item, acknowledged, onAction }: { item: AlertHistoryItem; acknowledged: boolean; onAction: (n: NoteAction) => void }) {
  const alert = item.alertId ? { id: item.alertId, title: item.title } : null;
  return (
    <div className="hnotes">
      {item.notes.length === 0 ? (
        <div className="subtle small">No notes.</div>
      ) : (
        <ol className="plain-list" aria-label={`Notes on ${item.title}`}>
          {item.notes.map((n) => (
            <li key={n.id} className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
              <Pill tone={n.kind === 'resolved' ? 'p-ok' : 'p-info'}>{n.kind}</Pill>
              <span className="mono subtle">{formatWhen(n.at)}</span>
              <span>{n.text || <span className="subtle">no note</span>}</span>
            </li>
          ))}
        </ol>
      )}
      {item.open && alert && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {!acknowledged && <button type="button" className="btn sm" onClick={() => onAction({ action: 'acknowledge', alert })}>Acknowledge with note</button>}
          <button type="button" className="btn sm" onClick={() => onAction({ action: 'resolve', alert })}>Resolve with note</button>
        </div>
      )}
    </div>
  );
}
