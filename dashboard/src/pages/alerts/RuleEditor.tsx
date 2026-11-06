import { useId, useRef, useState } from 'react';
import { useDeleteRule, useSaveRule, useTestRule } from '@/api/queries';
import type { AlertRule, ChannelId, Comparator, EscalationPolicy, ProjectId, RuleMetric, RuleTestResult, Severity } from '@/api/types';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Pill, Segmented, Switch } from '@/components/ui/primitives';
import {
  COMPARATORS, METRICS, draftCondition, draftFromRule, emptyDraft, formatCondition, formatMetricValue, formatPolicy, formatSpan,
  metricsFor, validateDraft, type RuleDraft, type RuleField,
} from '@/lib/rules';
import { projectName, severityLabel } from '@/lib/status';
import { Field, FormError, fieldProps, useChannels } from './shared';

export type RuleEditorMode = { kind: 'new' } | { kind: 'edit'; rule: AlertRule } | { kind: 'copy'; rule: AlertRule };

const FIELD_ORDER: RuleField[] = ['name', 'metric', 'threshold', 'for', 'channels', 'runbookUrl'];
const SEVERITIES: { id: Severity; label: string }[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
  { id: 'info', label: 'Info' },
];
const COMPARATOR_LABEL: Record<Comparator, string> = { '>': '> above', '>=': '≥ at least', '<': '< below', '<=': '≤ at most', '==': '= equals', '!=': '≠ not' };
const STATE_PILL: Record<RuleTestResult['targets'][number]['state'], [string, string]> = {
  firing: ['p-down', 'would fire'],
  pending: ['p-warn', 'pending'],
  ok: ['p-ok', 'ok'],
  no_data: ['p-mute', 'no data'],
};

function initialDraft(mode: RuleEditorMode): RuleDraft {
  if (mode.kind === 'new') return emptyDraft();
  return draftFromRule(mode.rule, mode.kind === 'copy');
}

/** Create, edit or duplicate a rule; delete from edit mode. Validation runs on every keystroke. */
export function RuleEditor({ mode, policies, onClose, onModeChange }: {
  mode: RuleEditorMode;
  policies: EscalationPolicy[];
  onClose: () => void;
  onModeChange: (mode: RuleEditorMode) => void;
}) {
  const [draft, setDraft] = useState<RuleDraft>(() => initialDraft(mode));
  const [touched, setTouched] = useState<Set<RuleField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveRule();
  const remove = useDeleteRule();
  const test = useTestRule();
  const { channels, name: channelName } = useChannels();
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const { errors, rule } = validateDraft(draft);
  const show = (f: RuleField) => (submitted || touched.has(f) ? errors[f] : undefined);
  const condition = draftCondition(draft);
  const metric = METRICS[draft.metric];
  const policy = policies.find((p) => p.id === draft.escalationPolicyId);

  function set<K extends keyof RuleDraft>(key: K, value: RuleDraft[K], field?: RuleField) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (field) setTouched((t) => new Set(t).add(field));
    test.reset();
  }

  function setProject(project: ProjectId) {
    // Keep the metric when the new project measures it; otherwise fall back to the first one it does.
    const metrics = metricsFor(project);
    setDraft((d) => ({ ...d, project, metric: metrics.some((m) => m.id === d.metric) ? d.metric : metrics[0].id }));
    test.reset();
  }

  function setMetric(m: RuleMetric) {
    const def = METRICS[m];
    // A heartbeat threshold of 85 makes no sense: snap the threshold into the new metric's range.
    setDraft((d) => {
      const n = Number(d.threshold);
      const fits = d.threshold.trim() !== '' && Number.isFinite(n) && n >= def.min && (def.max === undefined || n <= def.max);
      return { ...d, metric: m, threshold: fits ? d.threshold : String(def.min) };
    });
    test.reset();
  }

  function toggleChannel(c: ChannelId, on: boolean) {
    set('channels', on ? [...draft.channels, c] : draft.channels.filter((x) => x !== c), 'channels');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!rule) {
      const first = FIELD_ORDER.find((f) => errors[f]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    save.mutate({ id: mode.kind === 'edit' ? mode.rule.id : undefined, rule }, { onSuccess: onClose });
  }

  const title = mode.kind === 'edit' ? 'Edit rule' : mode.kind === 'copy' ? 'Duplicate rule' : 'New rule';
  const fid = (f: RuleField | 'project' | 'comparator' | 'policy' | 'severity') => `${id}-${f}`;

  return (
    <Dialog
      title={title}
      description={mode.kind === 'copy' ? `A copy of "${mode.rule.name}". Nothing is saved until you press Save.` : 'Fires when the condition holds for the given time.'}
      onClose={onClose}
      size="lg"
      closeOnBackdrop={false}
      initialFocus={nameRef}
      footer={
        <>
          {mode.kind === 'edit' && (
            <div className="start">
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete</button>
              <button type="button" className="btn" onClick={() => onModeChange({ kind: 'copy', rule: mode.rule })}>Duplicate</button>
            </div>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn pri" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : mode.kind === 'edit' ? 'Save changes' : 'Create rule'}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="frow">
          <Field id={fid('name')} label="Name" error={show('name')}>
            <input ref={nameRef} className="inp" {...fieldProps(fid('name'), show('name'))} value={draft.name} maxLength={80} autoComplete="off" onChange={(e) => set('name', e.target.value, 'name')} />
          </Field>
          <Field id={fid('project')} label="Project" narrow>
            <select className="inp" id={fid('project')} value={draft.project} onChange={(e) => setProject(e.target.value as ProjectId)}>
              <option value="nexusinfra">NexusInfra</option>
              <option value="finvault">FinVault</option>
            </select>
          </Field>
        </div>

        <div className="frow">
          <Field id={fid('metric')} label="Metric" error={show('metric')} hint={metric.source}>
            <select className="inp" {...fieldProps(fid('metric'), show('metric'), true)} value={draft.metric} onChange={(e) => setMetric(e.target.value as RuleMetric)}>
              {metricsFor(draft.project).map((m) => <option key={m.id} value={m.id}>{m.label} ({m.key})</option>)}
            </select>
          </Field>
          <Field id={fid('comparator')} label="Comparator" narrow>
            <select className="inp" id={fid('comparator')} value={draft.comparator} onChange={(e) => set('comparator', e.target.value as Comparator)}>
              {COMPARATORS.map((c) => <option key={c} value={c}>{COMPARATOR_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field id={fid('threshold')} label="Threshold" error={show('threshold')} narrow>
            <div className="inp-u">
              <input className="inp" inputMode="decimal" {...fieldProps(fid('threshold'), show('threshold'))} value={draft.threshold} onChange={(e) => set('threshold', e.target.value, 'threshold')} />
              <span className="u">{metric.unit}</span>
            </div>
          </Field>
          <Field id={fid('for')} label="For" error={show('for')} hint="e.g. 90s, 5m, 1h30m; empty = at once" narrow>
            <input className="inp" {...fieldProps(fid('for'), show('for'), true)} value={draft.forText} placeholder="5m" autoComplete="off" onChange={(e) => set('forText', e.target.value, 'for')} />
          </Field>
        </div>

        <div className="fld">
          <span className="fl" id={fid('severity')}>Severity</span>
          <div style={{ alignSelf: 'flex-start' }}>
            <Segmented small label="Severity" options={SEVERITIES} value={draft.severity} onChange={(v) => set('severity', v)} />
          </div>
        </div>

        <fieldset className="fld" aria-describedby={show('channels') ? fid('channels') + '-err' : undefined}>
          <legend>Notify at once</legend>
          <div className="ckls" id={fid('channels')} tabIndex={-1}>
            {channels.map((c) => (
              <label key={c.id} className="ckl">
                <input type="checkbox" checked={draft.channels.includes(c.id)} onChange={(e) => toggleChannel(c.id, e.target.checked)} />
                {c.name}
                {!c.enabled && <span className="subtle small">(off in Settings)</span>}
              </label>
            ))}
            {channels.length === 0 && <span className="subtle small">Loading channels…</span>}
          </div>
          {show('channels') && <div id={`${fid('channels')}-err`} className="err">{show('channels')}</div>}
        </fieldset>

        <div className="frow">
          <Field id={fid('policy')} label="Escalation" hint={policy ? formatPolicy(policy.steps, channelName) : 'Only the channels above, once'}>
            <select className="inp" {...fieldProps(fid('policy'), undefined, true)} value={draft.escalationPolicyId ?? ''} onChange={(e) => set('escalationPolicyId', e.target.value || null)}>
              <option value="">No escalation</option>
              {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field id={fid('runbookUrl')} label="Runbook link (optional)" error={show('runbookUrl')}>
            <input className="inp" type="url" {...fieldProps(fid('runbookUrl'), show('runbookUrl'))} value={draft.runbookUrl} placeholder="https://wiki.example/runbooks/…" onChange={(e) => set('runbookUrl', e.target.value, 'runbookUrl')} />
          </Field>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch on={draft.enabled} label="Rule enabled" onChange={(v) => set('enabled', v)} />
          <span className="muted small">{draft.enabled ? 'Enabled — evaluated on every check' : 'Disabled — saved but never fires'}</span>
        </div>

        <section aria-label="Condition preview" className="rule-preview">
          <div className="lbl">Preview</div>
          <code className="mono" data-testid="condition-preview">{condition ? formatCondition(condition) : '—'}</code>
          <div className="muted small">
            {condition
              ? `${severityLabel[draft.severity]} on ${projectName[draft.project]} when ${metric.label.toLowerCase()} is ${COMPARATOR_LABEL[draft.comparator].split(' ').slice(1).join(' ')} ${draft.threshold.trim()}${metric.unit === '%' ? '%' : ''}${condition.forSeconds ? ` for ${formatSpan(condition.forSeconds)}` : ''} → ${draft.channels.map(channelName).join(', ') || 'no channel'}${policy ? `, then ${policy.name}` : ''}.`
              : 'Fix the condition fields to see the rule.'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <button type="button" className="btn sm" disabled={!condition || test.isPending} onClick={() => condition && test.mutate({ project: draft.project, condition })}>
              {test.isPending ? 'Testing…' : 'Test against current data'}
            </button>
            {test.data && (
              <Pill tone={test.data.fires ? 'p-down' : 'p-ok'}>{test.data.fires ? 'Would fire now' : 'Would not fire now'}</Pill>
            )}
          </div>
          {test.data && <TestResult result={test.data} metric={draft.metric} />}
          <FormError error={test.error} />
        </section>

        <FormError error={save.error ?? remove.error} />
      </form>

      {confirmDelete && mode.kind === 'edit' && (
        <ConfirmDialog
          title={`Delete "${mode.rule.name}"?`}
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete rule'}
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate(mode.rule.id, { onSuccess: onClose, onSettled: () => setConfirmDelete(false) })}
        >
          The rule stops alerting and its silences are lifted. This cannot be undone.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

function TestResult({ result, metric }: { result: RuleTestResult; metric: RuleMetric }) {
  if (result.targets.length === 0) return <div className="muted small" role="status">Nothing is measured for this metric on this project yet.</div>;
  return (
    <ul className="test-list" role="status" aria-label="Test result">
      {result.targets.map((t) => {
        const [tone, label] = STATE_PILL[t.state];
        return (
          <li key={t.target}>
            <span className="mono" style={{ flex: '1 1 160px', minWidth: 0 }}>{t.target}</span>
            <span className="mono muted">{formatMetricValue(metric, t.value)}</span>
            <Pill tone={tone}>{t.state === 'pending' ? `${label} · ${formatSpan(t.heldSeconds)}` : label}</Pill>
          </li>
        );
      })}
    </ul>
  );
}
