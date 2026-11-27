/**
 * Endpoints with no live source yet: business, SLOs, incidents, the public status page and the
 * alerting writes (rules, silences, maintenance, escalation). They answer from the dashboard's own
 * sample generators so every page works with VITE_USE_MOCKS=false. Their state lives in the sample
 * modules; every successful write stores a snapshot in SQLite (views/persist.ts) so it survives a
 * restart. TODO.md tracks moving each one to a real source.
 */
import { openAlertTargets, resolveLive } from './alerts.js';
import { reliability, sample } from '../sample.js';
import { businessData } from './business.js';
import { incidentLive, incidentsLive, slosLive, statusLive } from './reliability.js';
import { HttpError, type RouteHandler } from '../routes.js';
import type { Ctx } from './ctx.js';
import { saveState } from './persist.js';
import { testRuleLive } from '../alerting/evaluate.js';
import { METRICS } from '../../../dashboard/src/lib/rules.js';
import type { AlertRuleInput } from '../contract.js';

type Write = (id: string, body: never) => unknown;

/**
 * Runs a sample mutation, then stores the new state; `undefined` results become 204.
 * Errors (ApiError 404/409/400) pass through, and a refused write stores nothing.
 */
const run = <T>(ctx: Ctx, fn: () => T) => {
  const out = fn();
  saveState(ctx.store);
  return out === undefined ? null : out;
};

const byId = (fn: Write): RouteHandler => (ctx, { params, body }) => run(ctx, () => fn(params.id, body as never));
const withBody = (fn: (body: never) => unknown): RouteHandler => (ctx, { body }) => run(ctx, () => fn(body as never));
/** The part of a rule the test needs, or 422 — the live evaluation must not run on a malformed condition. */
function checkedRule(body: unknown): Pick<AlertRuleInput, 'project' | 'condition'> {
  const b = body as Partial<Pick<AlertRuleInput, 'project' | 'condition'>> | null;
  const c = b?.condition;
  const valid =
    (b?.project === 'nexusinfra' || b?.project === 'finvault') &&
    !!c && c.metric in METRICS && ['>', '>=', '<', '<=', '==', '!='].includes(c.comparator) &&
    Number.isFinite(c.threshold) && Number.isFinite(c.forSeconds) && c.forSeconds >= 0;
  if (!valid) throw new HttpError(422, 'A rule test needs a project and a condition (metric, comparator, threshold, forSeconds)');
  return { project: b.project as AlertRuleInput['project'], condition: c as AlertRuleInput['condition'] };
}

/** A maintenance window may be scoped to a monitored service; without health targets, to a sample one. */
const knownServices = (ctx: Ctx) => (ctx.live.logs ? ctx.config.health.targets : sample.services);

const note = (body: unknown) => ((body as { note?: unknown } | null)?.note as string | undefined) ?? '';

export const sampledRoutes: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; handle: RouteHandler }[] = [
  { method: 'GET', path: '/business', handle: (ctx) => (ctx.live.logs ? businessData(ctx) : sample.business()) },

  { method: 'GET', path: '/slos', handle: (ctx) => (ctx.live.logs ? slosLive(ctx) : reliability.slos()) },
  { method: 'GET', path: '/incidents', handle: (ctx) => (ctx.live.logs ? incidentsLive(ctx) : reliability.incidents()) },
  {
    method: 'GET',
    path: '/incidents/:id',
    handle: (ctx, { params }) => {
      const detail = ctx.live.logs ? incidentLive(ctx, params.id) : reliability.incident(params.id);
      if (!detail) throw new HttpError(404, `Incident ${params.id} not found`);
      return detail;
    },
  },
  { method: 'POST', path: '/incidents', handle: withBody(reliability.createIncident) },
  { method: 'POST', path: '/incidents/:id/updates', handle: byId(reliability.postIncidentUpdate) },
  { method: 'POST', path: '/incidents/:id/resolve', handle: byId(reliability.resolveIncident) },
  { method: 'GET', path: '/status', handle: (ctx) => (ctx.live.logs ? statusLive(ctx) : reliability.statusPage()) },

  {
    method: 'POST',
    path: '/alerts/:id/resolve',
    handle: (ctx, { params, body }) => (ctx.live.logs ? (resolveLive(ctx, params.id, note(body)), null) : run(ctx, () => sample.resolveAlert(params.id, note(body)))),
  },
  // `/alert-rules/test` before `/alert-rules/:id` — same method family, and "test" is not an id.
  { method: 'POST', path: '/alert-rules/test', handle: (ctx, { body }) => (ctx.live.logs ? testRuleLive(ctx, checkedRule(body)) : sample.testRule(body as never)) },
  { method: 'POST', path: '/alert-rules', handle: withBody(sample.createRule) },
  { method: 'PUT', path: '/alert-rules/:id', handle: byId(sample.updateRule) },
  { method: 'DELETE', path: '/alert-rules/:id', handle: byId(sample.deleteRule) },
  // Live: a silence on one alert, or "until resolved", is checked against the open alerts.
  { method: 'POST', path: '/silences', handle: (ctx, { body }) => run(ctx, () => sample.createSilence(body as never, ctx.live.logs ? openAlertTargets(ctx) : undefined)) },
  { method: 'DELETE', path: '/silences/:id', handle: byId(sample.deleteSilence) },
  { method: 'POST', path: '/maintenance-windows', handle: (ctx, { body }) => run(ctx, () => sample.createMaintenance(body as never, knownServices(ctx))) },
  { method: 'PUT', path: '/maintenance-windows/:id', handle: (ctx, { params, body }) => run(ctx, () => sample.updateMaintenance(params.id, body as never, knownServices(ctx))) },
  { method: 'DELETE', path: '/maintenance-windows/:id', handle: byId(sample.deleteMaintenance) },
  { method: 'POST', path: '/escalation-policies', handle: withBody(sample.createPolicy) },
  { method: 'PUT', path: '/escalation-policies/:id', handle: byId(sample.updatePolicy) },
  { method: 'DELETE', path: '/escalation-policies/:id', handle: byId(sample.deletePolicy) },
];
