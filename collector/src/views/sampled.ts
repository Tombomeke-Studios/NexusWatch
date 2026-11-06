/**
 * Endpoints with no live source yet: business, SLOs, incidents, the public status page and the
 * alerting writes (rules, silences, maintenance, escalation). They answer from the dashboard's own
 * sample generators so every page works with VITE_USE_MOCKS=false. Their state lives in memory,
 * not in SQLite — TODO.md tracks moving each one to a real source.
 */
import { reliability, sample } from '../sample.js';
import { HttpError, type RouteHandler } from '../routes.js';

type Write = (id: string, body: never) => unknown;

/** Runs a sample mutation; `undefined` results become 204. Errors (ApiError 404/409/400) pass through. */
const run = <T>(fn: () => T) => {
  const out = fn();
  return out === undefined ? null : out;
};

const byId = (fn: Write): RouteHandler => (_ctx, { params, body }) => run(() => fn(params.id, body as never));
const withBody = (fn: (body: never) => unknown): RouteHandler => (_ctx, { body }) => run(() => fn(body as never));
const note = (body: unknown) => ((body as { note?: unknown } | null)?.note as string | undefined) ?? '';

export const sampledRoutes: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; handle: RouteHandler }[] = [
  { method: 'GET', path: '/business', handle: () => sample.business() },

  { method: 'GET', path: '/slos', handle: () => reliability.slos() },
  { method: 'GET', path: '/incidents', handle: () => reliability.incidents() },
  {
    method: 'GET',
    path: '/incidents/:id',
    handle: (_ctx, { params }) => {
      const detail = reliability.incident(params.id);
      if (!detail) throw new HttpError(404, `Incident ${params.id} not found`);
      return detail;
    },
  },
  { method: 'POST', path: '/incidents', handle: withBody(reliability.createIncident) },
  { method: 'POST', path: '/incidents/:id/updates', handle: byId(reliability.postIncidentUpdate) },
  { method: 'POST', path: '/incidents/:id/resolve', handle: byId(reliability.resolveIncident) },
  { method: 'GET', path: '/status', handle: () => reliability.statusPage() },

  { method: 'POST', path: '/alerts/:id/resolve', handle: (_ctx, { params, body }) => run(() => sample.resolveAlert(params.id, note(body))) },
  // `/alert-rules/test` before `/alert-rules/:id` — same method family, and "test" is not an id.
  { method: 'POST', path: '/alert-rules/test', handle: withBody(sample.testRule) },
  { method: 'POST', path: '/alert-rules', handle: withBody(sample.createRule) },
  { method: 'PUT', path: '/alert-rules/:id', handle: byId(sample.updateRule) },
  { method: 'DELETE', path: '/alert-rules/:id', handle: byId(sample.deleteRule) },
  { method: 'POST', path: '/silences', handle: withBody(sample.createSilence) },
  { method: 'DELETE', path: '/silences/:id', handle: byId(sample.deleteSilence) },
  { method: 'POST', path: '/maintenance-windows', handle: withBody(sample.createMaintenance) },
  { method: 'PUT', path: '/maintenance-windows/:id', handle: byId(sample.updateMaintenance) },
  { method: 'DELETE', path: '/maintenance-windows/:id', handle: byId(sample.deleteMaintenance) },
  { method: 'POST', path: '/escalation-policies', handle: withBody(sample.createPolicy) },
  { method: 'PUT', path: '/escalation-policies/:id', handle: byId(sample.updatePolicy) },
  { method: 'DELETE', path: '/escalation-policies/:id', handle: byId(sample.deletePolicy) },
];
