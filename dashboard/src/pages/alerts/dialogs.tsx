import { useId, useRef, useState } from 'react';
import { useAcknowledgeAlert, useCreateSilence, useResolveAlert, useSaveMaintenance, useSavePolicy } from '@/api/queries';
import type { ChannelId, EscalationPolicy, EscalationStep, MaintenanceWindow, ProjectId, ServiceRef, SilenceDuration, SilenceInput } from '@/api/types';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented } from '@/components/ui/primitives';
import { formatClock, fromLocalInput, toLocalInput } from '@/lib/format';
import { REASON_MAX, SILENCE_OPTIONS, STEP_MAX_MINUTES, formatPolicy, silenceEndsAt, validatePolicy, validateReason, validateWindow } from '@/lib/rules';
import { Field, FormError, fieldProps, useChannels } from './shared';

// ── Mute ───────────────────────────────────────────────────────────────
export interface MuteTarget {
  kind: SilenceInput['kind'];
  id: string;
  label: string;
  /** Whether "until resolved" has something to wait for. */
  canWaitForResolve: boolean;
}

export function MuteDialog({ target, onClose }: { target: MuteTarget; onClose: () => void }) {
  const [duration, setDuration] = useState<SilenceDuration>('1h');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const mute = useCreateSilence();
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const error = touched ? validateReason(reason) : undefined;
  const options = SILENCE_OPTIONS.filter((o) => o.id !== 'resolved' || target.canWaitForResolve);
  const endsAt = silenceEndsAt(duration, Date.now());

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (validateReason(reason)) {
      reasonRef.current?.focus();
      return;
    }
    mute.mutate({ kind: target.kind, targetId: target.id, duration, reason }, { onSuccess: onClose });
  }

  return (
    <Dialog
      title={`Mute ${target.kind === 'rule' ? 'rule' : 'alert'}`}
      description={target.label}
      onClose={onClose}
      size="sm"
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn pri" disabled={mute.isPending}>{mute.isPending ? 'Muting…' : 'Mute'}</button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="fld">
          <span className="fl">For how long</span>
          <Segmented small label="Mute duration" options={options} value={duration} onChange={setDuration} />
          <div className="hint">
            {endsAt ? `No notifications until ${formatClock(endsAt, 'min')}.` : `No notifications until ${target.kind === 'rule' ? 'every alert of this rule' : 'this alert'} resolves.`}
            {!target.canWaitForResolve && target.kind === 'rule' && ' "Until resolved" needs an active alert.'}
          </div>
        </div>
        <Field id={`${id}-reason`} label="Reason" error={error}>
          <textarea ref={reasonRef} className="inp" {...fieldProps(`${id}-reason`, error)} value={reason} maxLength={REASON_MAX + 20} placeholder="Deploying a fix, known issue, …" onChange={(e) => { setReason(e.target.value); setTouched(true); }} />
        </Field>
        <FormError error={mute.error} />
      </form>
    </Dialog>
  );
}

// ── Acknowledge / resolve with a note ──────────────────────────────────
export function NoteDialog({ action, alert, onClose }: { action: 'acknowledge' | 'resolve'; alert: { id: string; title: string }; onClose: () => void }) {
  const [note, setNote] = useState('');
  const ack = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const mutation = action === 'acknowledge' ? ack : resolve;
  const id = useId();
  const label = action === 'acknowledge' ? 'Acknowledge' : 'Resolve';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({ id: alert.id, note }, { onSuccess: onClose });
  }

  return (
    <Dialog
      title={`${label} alert`}
      description={alert.title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn pri" disabled={mutation.isPending}>{mutation.isPending ? `${label.replace(/e$/, '')}ing…` : label}</button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field id={`${id}-note`} label="Note (optional)" hint={action === 'acknowledge' ? 'Stops the escalation. The note is kept in the history.' : 'What fixed it? The note is kept in the history.'}>
          <textarea className="inp" {...fieldProps(`${id}-note`, undefined, true)} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError error={mutation.error} />
      </form>
    </Dialog>
  );
}

// ── Maintenance window ─────────────────────────────────────────────────
const DURATIONS = [15, 30, 60, 120, 240, 480, 1440];
const durationLabel = (m: number) => (m < 60 ? `${m} min` : m === 1440 ? '1 day' : `${m / 60} h`);

export function MaintenanceDialog({ window: existing, services, onClose }: { window: MaintenanceWindow | null; services: ServiceRef[]; onClose: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [project, setProject] = useState<ProjectId>(existing?.project ?? 'nexusinfra');
  const [serviceId, setServiceId] = useState<string | null>(existing?.serviceId ?? null);
  const [start, setStart] = useState(() => toLocalInput(existing?.startsAt ?? new Date(Math.ceil(Date.now() / 900_000) * 900_000).toISOString()));
  const [durationMinutes, setDuration] = useState(existing?.durationMinutes ?? 60);
  const [weekly, setWeekly] = useState(existing?.recurrence === 'weekly');
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveMaintenance();
  const id = useId();
  const startsAt = fromLocalInput(start);
  const errors = validateWindow({ title, startsAt, durationMinutes });
  const show = (k: keyof typeof errors) => (submitted || (k === 'title' ? title !== (existing?.title ?? '') : true) ? errors[k] : undefined);
  const durations = DURATIONS.includes(durationMinutes) ? DURATIONS : [...DURATIONS, durationMinutes].sort((a, b) => a - b);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    save.mutate({ id: existing?.id, input: { title, project, serviceId, startsAt, durationMinutes, recurrence: weekly ? 'weekly' : 'none' } }, { onSuccess: onClose });
  }

  return (
    <Dialog
      title={existing ? 'Edit maintenance window' : 'Schedule maintenance'}
      description="Alerts inside the window are kept but send no notifications."
      onClose={onClose}
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn pri" disabled={save.isPending}>{save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Schedule'}</button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field id={`${id}-title`} label="Title" error={show('title')}>
          <input className="inp" {...fieldProps(`${id}-title`, show('title'))} value={title} maxLength={80} placeholder="Kernel update node-02" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="frow">
          <Field id={`${id}-project`} label="Project" narrow>
            <select className="inp" id={`${id}-project`} value={project} onChange={(e) => { setProject(e.target.value as ProjectId); setServiceId(null); }}>
              <option value="nexusinfra">NexusInfra</option>
              <option value="finvault">FinVault</option>
            </select>
          </Field>
          <Field id={`${id}-service`} label="Scope">
            <select className="inp" id={`${id}-service`} value={serviceId ?? ''} onChange={(e) => setServiceId(e.target.value || null)}>
              <option value="">Whole project</option>
              {services.filter((s) => s.project === project).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="frow">
          <Field id={`${id}-start`} label="Starts" error={show('startsAt')}>
            <input className="inp" type="datetime-local" {...fieldProps(`${id}-start`, show('startsAt'))} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field id={`${id}-duration`} label="Lasts" error={show('duration')} narrow>
            <select className="inp" {...fieldProps(`${id}-duration`, show('duration'))} value={durationMinutes} onChange={(e) => setDuration(Number(e.target.value))}>
              {durations.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </select>
          </Field>
        </div>
        <label className="ckl" style={{ alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
          Repeat every week
        </label>
        <FormError error={save.error} />
      </form>
    </Dialog>
  );
}

// ── Escalation policy ──────────────────────────────────────────────────
export function PolicyEditor({ policy, onClose }: { policy: EscalationPolicy | null; onClose: () => void }) {
  const [name, setName] = useState(policy?.name ?? '');
  const [steps, setSteps] = useState<EscalationStep[]>(() => policy?.steps.map((s) => ({ ...s })) ?? [{ channel: 'discord', afterMinutes: 0 }]);
  const [submitted, setSubmitted] = useState(false);
  const save = useSavePolicy();
  const { channels, name: channelName } = useChannels();
  const id = useId();
  const errors = validatePolicy({ name, steps });
  const nameError = submitted || name !== (policy?.name ?? '') ? errors.name : undefined;

  const update = (i: number, patch: Partial<EscalationStep>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = () => setSteps((all) => [...all, { channel: 'push' as ChannelId, afterMinutes: Math.min(STEP_MAX_MINUTES, (all.at(-1)?.afterMinutes ?? -5) + 5) }]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    save.mutate({ id: policy?.id, input: { name, steps } }, { onSuccess: onClose });
  }

  return (
    <Dialog
      title={policy ? 'Edit escalation policy' : 'New escalation policy'}
      description="Steps after the first run only while the alert is not acknowledged."
      onClose={onClose}
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn pri" disabled={save.isPending}>{save.isPending ? 'Saving…' : policy ? 'Save changes' : 'Create policy'}</button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field id={`${id}-name`} label="Name" error={nameError}>
          <input className="inp" {...fieldProps(`${id}-name`, nameError)} value={name} maxLength={60} placeholder="On-call" onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="fld">
          <legend>Steps</legend>
          <ol className="steps-edit">
            {steps.map((s, i) => (
              <li key={i}>
                <span className="subtle mono small" aria-hidden="true">{i + 1}</span>
                <select className="inp" aria-label={`Step ${i + 1} channel`} value={s.channel} onChange={(e) => update(i, { channel: e.target.value as ChannelId })}>
                  {(channels.length ? channels : [{ id: s.channel, name: channelName(s.channel) }]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="inp-u">
                  <input className="inp" type="number" min={0} max={STEP_MAX_MINUTES} aria-label={`Step ${i + 1} minutes after the alert`} value={s.afterMinutes} onChange={(e) => update(i, { afterMinutes: e.target.value === '' ? 0 : Math.round(Number(e.target.value)) })} />
                  <span className="u">min after</span>
                </div>
                <button type="button" className="btn sm" aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ol>
          {errors.steps && <div className="err" role="alert">{errors.steps}</div>}
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={addStep}>+ Add step</button>
        </fieldset>
        <div className="rule-preview">
          <div className="lbl">Preview</div>
          <code className="mono">{steps.length ? formatPolicy(steps, channelName) : '—'}</code>
        </div>
        <FormError error={save.error} />
      </form>
    </Dialog>
  );
}
