/**
 * Keeps what the alerting and incident writes change — rules, silences, maintenance windows,
 * escalation policies, acknowledgements, notes, declared incidents — across restarts.
 *
 * Those endpoints still run on the dashboard's sample modules (views/sampled.ts), which hold their
 * state in memory. After every successful write the collector stores a snapshot of that state in
 * SQLite; at start it loads the snapshot back. Nothing is stored until the first write, so an
 * untouched collector keeps serving sample data whose timestamps follow the clock.
 */
import { reliability, sample } from '../sample.js';
import type { Store } from '../store.js';

/** The sample modules' seeded examples, read before anything is restored. */
const SEEDED = {
  silences: new Set(sample.alertingState().silences.map((s) => s.id)),
  maintenance: new Set(sample.alertingState().maintenance.map((m) => m.id)),
  incidents: new Set(reliability.incidentState().incidents.map((i) => i.id)),
};
const SAMPLE_RUNBOOKS = 'https://wiki.home.example/';

const ALERTING = 'state.alerting';
const INCIDENTS = 'state.incidents';

type AlertingState = ReturnType<typeof sample.alertingState>;
type IncidentState = ReturnType<typeof reliability.incidentState>;

const isAlertingState = (v: unknown): v is AlertingState => {
  const s = v as Partial<AlertingState> | null;
  return (
    !!s &&
    typeof s.idCounter === 'number' &&
    [s.policies, s.rules, s.silences, s.maintenance, s.acknowledgedAt, s.resolvedAt, s.notes].every(Array.isArray)
  );
};

const isIncidentState = (v: unknown): v is IncidentState => {
  const s = v as Partial<IncidentState> | null;
  return !!s && typeof s.updateSeq === 'number' && Array.isArray(s.incidents);
};

/**
 * Loads the stored snapshots into the sample modules. A snapshot that does not parse is skipped, loudly.
 * `live`: the collector measures something, so the seeded examples (a silence, two maintenance windows,
 * a set of incidents, runbook links to an example wiki) are removed — rules and escalation policies stay
 * as editable defaults. Idempotent, so it also cleans a snapshot saved before this existed.
 */
export function restoreState(store: Store, live = false): void {
  const alerting = store.get<unknown>(ALERTING);
  if (isAlertingState(alerting)) sample.restoreAlertingState(alerting);
  else if (alerting !== undefined) console.warn('[collector] stored alerting state is unreadable — starting from the defaults');

  const incidents = store.get<unknown>(INCIDENTS);
  if (isIncidentState(incidents)) reliability.restoreIncidentState(incidents);
  else if (incidents !== undefined) console.warn('[collector] stored incident state is unreadable — starting from the defaults');

  if (live) {
    const a = sample.alertingState();
    sample.restoreAlertingState({
      ...a,
      silences: a.silences.filter((s) => !SEEDED.silences.has(s.id)),
      maintenance: a.maintenance.filter((m) => !SEEDED.maintenance.has(m.id)),
      rules: a.rules.map((r) => (r.runbookUrl.startsWith(SAMPLE_RUNBOOKS) ? { ...r, runbookUrl: '' } : r)),
    });
    const i = reliability.incidentState();
    reliability.restoreIncidentState({ ...i, incidents: i.incidents.filter((x) => !SEEDED.incidents.has(x.id)) });
  }
}

/** Stores the current snapshots. Call after a write succeeded. */
export function saveState(store: Store): void {
  store.set(ALERTING, sample.alertingState());
  store.set(INCIDENTS, reliability.incidentState());
}
