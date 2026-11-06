# API contract

What the dashboard expects from the NexusWatch backend. Shapes are defined in
[`dashboard/src/api/types.ts`](../dashboard/src/api/types.ts); calls are made in
[`dashboard/src/api/endpoints.ts`](../dashboard/src/api/endpoints.ts). Change all three together.

- Base path: `/api` (configurable with `VITE_API_BASE`).
- JSON in and out. Non-2xx answers are errors; the body text is shown to the user.
- Timestamps: UTC ISO-8601 strings. Series: oldest → newest.
- A measurement that could not be made is `null`, never `0`.
- `range` is one of `1h`, `24h`, `7d`, `30d`.
- A log entry's `id` is stable: the same line has the same id in `/logs` and `/services/:id` and on every poll.
  `fields` holds the full structured document, shown when a line is opened.

## Read

| Method & path | Query | Response type | Used by |
|---|---|---|---|
| `GET /health` | | `CollectorHealth` | The collector itself: version, which parts are live, each source's last run/error. Also served at `/health` (no `/api`) for Docker |
| `GET /host` | | `HostInfo` | Sidebar host card |
| `GET /nav` | | `NavCounts` | Sidebar badge and project counts |
| `GET /overview` | `range` | `OverviewData` | Overview |
| `GET /metrics` | `range` | `MetricsOverview` | Metrics summaries + top consumers |
| `GET /metrics/:id` | `range` | `MetricData` (`id` ∈ cpu, memory, disk, network, queues) | Metrics chart + statistics |
| `GET /logs` | `q`, `range`, `level` (comma list), `project` | `LogsData` (400 on an unknown range, level or project) | Logs |
| `GET /heartbeats` | | `HeartbeatsData` | Heartbeats |
| `GET /alerts` | | `AlertsData` | Alerts |
| `GET /services/:id` | | `ServiceDetail` (404 when unknown) | Service detail |
| `GET /projects/nexusinfra` | | `NexusInfraData` | Project NexusInfra |
| `GET /projects/finvault` | | `FinVaultData` | Project FinVault |
| `GET /settings` | | `SettingsData` | Settings |

## Write

| Method & path | Body | Effect |
|---|---|---|
| `POST /alerts/:id/ack` | | Marks an active alert as acknowledged |
| `PATCH /alert-rules/:id` | `{ enabled: boolean }` | Enables or disables a rule |
| `PATCH /settings` | any of `{ channels, routing, retention }` | Replaces the given settings sections |

Notification channel ids are `discord`, `telegram`, `email` and `push`; `routing` has an entry for
every channel under every severity (`critical`, `warning`, `info`). A Telegram target is a bot
`sendMessage` URL with the chat id — the bot token is a secret and, like agent tokens, should only be
returned masked once the backend stores real values.

Agent tokens are only ever returned as a hint (last four characters); a full token is shown once, at creation.

## Served by the collector

The backend is `collector/` (see [architecture.md](architecture.md)). Every endpoint above is always
served: a part with a configured source is answered from stored data ("live"), every other part from
the dashboard's own sample generators, so the API is complete from the first start. `GET /health`
lists which parts are live.

Rules the live answers follow, beyond the shapes:

- **Series are never padded.** A live series starts at its first measurement in the window and is
  shorter than the full length until enough history exists (`beats` ≤ 48, `checks` ≤ 120,
  `responseTimes` ≤ 96, `days` ≤ 60, metric series ≤ 90). A metric nobody measures has no series at
  all. An empty bucket after the first measurement repeats the previous value.
- **Unknown is `null`** where the contract allows it: a failed check's latency, `FinVaultService.rps`
  and `errorPct` while no request-rate source covers FinVault.
- A few fields are not nullable yet and read `0` while unmeasured: `Monitor.avgLatencyMs`,
  `ServiceDetail.kpis.avgLatencyMs` / `p95LatencyMs` (no answered check in 24h), `restarts24h` and
  `NodeSummary.containers` (need the agent). TODO.md tracks making them nullable.
- Incidents are opened by the collector itself (N failed checks in a row, or a heartbeat source going
  offline) and every open incident is an active alert. Alert *rules* are not evaluated yet; their
  list and toggles are stored but the rules themselves are the sample set.
- Writes are stored in SQLite and survive restarts. `PATCH /settings` answers 400 when a retention
  value is not one of that kind's `options`.

## Reliability: SLOs, incidents, public status

| Method & path | Body | Response type | Used by |
|---|---|---|---|
| `GET /slos` | | `SloData` | SLOs, Service detail SLO card |
| `GET /incidents` | | `IncidentsData` (open first, then newest first) | Incidents |
| `GET /incidents/:id` | | `IncidentDetail` (404 when unknown) | Incident detail |
| `POST /incidents` | `NewIncident` | `IncidentDetail` (status `investigating`) | Declare incident |
| `POST /incidents/:id/updates` | `NewIncidentUpdate` | `IncidentDetail` | Post update (409 once resolved) |
| `POST /incidents/:id/resolve` | `ResolveIncident` | `IncidentDetail` | Resolve, optionally with a postmortem (409 once resolved) |
| `GET /status` | | `StatusPageData` | Public status page |

**SLOs.** The backend sends raw check tallies — per day of the rolling window and per burn window
(`5m`, `30m`, `1h`, `2h`, `6h`, `24h`) — and the dashboard derives attainment, budget, burn rate and
time to exhaustion in `lib/slo.ts`, so the maths lives in one tested place. A check is `good` when the
service answered (up or slow: this is an availability objective), `bad` when it failed and `unknown`
when there is no data (agent offline, collector gap). Unknown checks are left out of every
calculation; they are never counted as up or as down. `daily` has `windowDays` entries, oldest first,
and sums to `window`. Burn alerts follow the Google SRE multi-window rule: 2% of the budget in 1 h
(confirmed over 5 min), 5% in 6 h (30 min), 10% in 24 h (2 h).

**Incidents.** Lifecycle `investigating → identified → monitoring → resolved`; every update carries
the status it moved to, so `updates[0].status` is the current status. `resolvedAt` is null until
resolved. `durationSeconds` runs until now while open. Heartbeats' incident list (`HeartbeatsData.incidents`)
is a summary of the same incidents, with the same ids.

**Public status (`GET /status`).** The only endpoint meant to be served without authentication.
`StatusPageData` is its own set of types on purpose: it carries no hosts, addresses, ports, check
targets, node names, internal service ids or update authors — a test walks the type and the response
to enforce that. Components have a public `slug` and name and may group several services
(the worst status wins). Only incidents with `public: true` appear, under their `publicTitle`, with
only their public updates. `days` holds 90 entries, oldest first; `null` is a day without data and is
drawn as "no data", never as up. `recent` holds public incidents resolved in the last 14 days;
`maintenance` holds windows that have not ended yet.
