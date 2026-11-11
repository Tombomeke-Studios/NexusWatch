# Architecture

## As built

```
Browser ── React pages ── api/queries.ts (React Query, polling)
                              │
                         api/endpoints.ts ── VITE_USE_MOCKS=true  → api/mock/data.ts
                                         └── VITE_USE_MOCKS=false → api/client.ts → HTTP /api/* ─┐
                                                                                                 │
NexusInfra services ── GET /health ─────────────────┐                                            │
Control Room ── GET /status + /uptime ──────────────┤                                            ▼
NexusInfra services ── GET /metrics (Prometheus) ───┼──> collector sources ──> SQLite ──> views ──> /api
finvault.events ── monitoring.heartbeat.# (AMQP) ───┘                                  │
                                                     dashboard sample data (fallback) ─┘
```

- **One seam.** Pages only use the hooks in `queries.ts`. Swapping sample data for the collector is a
  config switch, not a page change. The response shapes are fixed in `api/types.ts` and described in
  [api.md](api.md).
- **Polling, not push.** Live views refetch every `VITE_REFRESH_MS` (10 s); the log tail every 2 s.
  Server-sent events can replace polling later without changing the pages.
- **No chart library.** Charts are plain SVG built from pure functions in `lib/series.ts`.

## The collector (`collector/`)

One Node/TypeScript service that gathers, stores and serves the `/api` contract (Express, port 8080).

**Sources** — each switched on by its environment variable (see `.env.example`), each a pure module
with an injected `fetch` and clock so it is tested without a network:

| Source | Reads | Feeds |
|---|---|---|
| Heartbeat checker (`sources/health.ts`) | `GET` every configured `/health`, own interval + timeout per target | services, monitors, service detail, logs, incidents |
| Control Room (`sources/controlRoom.ts`) | NexusInfra Control Room `GET /status` + `/uptime` | nodes (names matching `NW_NODE_PATTERN`) and service heartbeat sources, dead-letter depth |
| Prometheus (`sources/prometheus.ts`) | NexusInfra `/metrics`, text format; only request counters, the duration histogram, dead letters, outbox depth, agent containers | Overview requests/5xx and p95, queue depth, containers running |
| Event bus (`sources/bus.ts`) | `monitoring.heartbeat.#` on `finvault.events`, payloads via `readPayload()` | nodes with CPU / memory / disk, service heartbeats |

- A failed check is stored with `null` latency, never 0. The Nth failure in a row
  (`NW_HEALTH_FAILURES_FOR_INCIDENT`, default 3) opens an incident; the next good check closes it.
- Heartbeat sources heard on the bus age by the clock with the Control Room's own thresholds
  (slow after 3 s, offline after 10 s); sources reported by the Control Room keep the status of its
  last poll. Going offline opens an incident.

**Rule evaluation** — `collector/src/alerting`. A periodic task turns stored measurements into
readings (per service: heartbeat and latency from the health checks; per node: CPU, memory and disk
from the bus heartbeats, bucketed per minute) and evaluates every enabled rule with the dashboard's
own `evaluateRule`, so "test rule" in the editor and the collector cannot disagree. A target whose
condition held for the rule's duration opens an incident; it closes when the condition clears. A
missing measurement is unknown: it neither fires nor resolves. Outages stay with the health checker
and the heartbeat tracker, which open "not responding" / "offline" themselves.

**Notifications** — `collector/src/notify`. One sender per channel (Discord webhook, Telegram Bot API
`sendMessage`, ntfy as JSON, SMTP through nodemailer), each configured by its own `NW_*` variables and
off until they are set. A periodic task compares the incidents in the store with what it already
delivered and sends what is owed: "firing" when an incident opens, "resolved" when it closes. Because
that record is stored, a restart neither repeats nor loses a notification. While an alert stays
unacknowledged, the steps of its rule's escalation policy add their channels as they come due. Targets never pass through
the API, and no error text carries one.

**Storage** — one SQLite file through Node's built-in `node:sqlite` (no native module to compile).
It keeps log lines (each with a stored id, so deep links stay valid), health checks, metric samples,
the last-known state of heartbeat sources, incidents, and what the dashboard writes (settings,
acknowledgements, rule toggles, channel switches, which notifications were delivered, and a snapshot of the alerting and incident state — rules, silences,
maintenance windows, escalation policies, notes, declared incidents — taken after every write and
loaded at start). Retention is per kind — logs, metrics, heartbeats — and follows the
values chosen on the Settings page; pruning runs at start, every `NW_PRUNE_INTERVAL_MS`, and whenever
retention is changed. Open incidents are never pruned.

**Fallback** — every view checks whether its part is live (has a configured source). If not, it
returns the dashboard's sample generator for that part, so the API is complete with zero
configuration and a page never breaks because one source is missing. `GET /health` says which parts
are live.

**Sharing the contract** — the collector imports `dashboard/src/api/types.ts` (types) and
`dashboard/src/api/mock/data.ts` (fallback data) straight from source; nothing is copied, so the two
cannot drift. Because those files use the dashboard's bundler-style imports (extensionless, `@/`
alias), the collector typechecks with `moduleResolution: Bundler` and runs through `tsx` (as
NexusInfra's services do); its own imports use NodeNext-style `.js` specifiers so it can move to
NodeNext if the contract becomes its own package.

**Read-only.** NexusWatch observes; it never changes state in NexusInfra or FinVault and never reads
their databases. On the bus it only *checks* the `finvault.events` exchange (never declares or renames
it) and consumes from its own exclusive, auto-deleting queue, so it takes no message from any other
consumer and leaves nothing behind. The AES-256-GCM constants mirror NexusInfra's
`shared/src/events.ts` exactly; `payload.test.ts` decrypts a ciphertext made by NexusInfra itself.

**Deployment** — `docker-compose.yml` runs the collector (SQLite on a volume) and the dashboard
built with `VITE_USE_MOCKS=false`, served by nginx, which proxies `/api` to the collector.

## Planned (not built)

- **Agent**: the `nexuswatch/agent` container shown in Settings (heartbeats, metrics, logs, container
  inventory), authenticated with a per-node token. Until then Settings → Agents is sample data.
- **FinVault business data**: top-ups, payments, transactions and request rates from FinVault's
  gateway events (`bank.payment.*` and `events.<type>` keys on the same exchange).
- **Sources for the FinVault rule metrics** (queue depth, 5xx rate, top-ups).

- **Business view** (`/business`): the collector would read the Billing Bridge's top-up ledger, credit
  ledger, standing and suspensions (hosted edition only), watch `payment.request` and FinVault's
  `payment.confirmed`/`payment.failed` on the exchange (both key spellings), and ask the broker for queue
  depths, consumers and `finvault.events.dlq`. It reports what each side recorded; the dashboard
  reconciles (`lib/reconcile.ts`). Payer emails are masked before they leave the collector.

Open decisions: authentication for the dashboard; whether the collector should measure node
resources itself or keep relying on NexusInfra's heartbeats.
