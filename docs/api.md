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
| `GET /business` | | `BusinessData` | Business (money flow FinVault → NexusInfra) |

## Write

| Method & path | Body | Effect |
|---|---|---|
| `POST /alerts/:id/ack` | `{ note?: string }` | Marks an active alert as acknowledged; stops its escalation |
| `POST /alerts/:id/resolve` | `{ note?: string }` | Resolves an active alert (404 when it is not active) |
| `POST /alert-rules` | `AlertRuleInput` | Creates a rule → `AlertRule` |
| `PUT /alert-rules/:id` | `AlertRuleInput` | Replaces a rule → `AlertRule` |
| `PATCH /alert-rules/:id` | `{ enabled: boolean }` | Enables or disables a rule |
| `DELETE /alert-rules/:id` | | Deletes a rule and lifts its silences |
| `POST /alert-rules/test` | `{ project, condition }` | Evaluates a rule, saved or not, against current data → `RuleTestResult`. Changes nothing |
| `POST /silences` | `SilenceInput` | Mutes an alert or a rule → `Silence` |
| `DELETE /silences/:id` | | Unmutes |
| `POST /maintenance-windows` | `MaintenanceInput` | Schedules a window → `MaintenanceWindow` |
| `PUT /maintenance-windows/:id` | `MaintenanceInput` | Replaces a window |
| `DELETE /maintenance-windows/:id` | | Removes a window |
| `POST /escalation-policies` | `EscalationPolicyInput` | Creates a policy → `EscalationPolicy` |
| `PUT /escalation-policies/:id` | `EscalationPolicyInput` | Replaces a policy |
| `DELETE /escalation-policies/:id` | | Deletes a policy; rules that used it fall back to none |
| `PATCH /settings` | any of `{ channels, routing, retention }` | Replaces the given settings sections. Of a channel only `enabled` is taken; `target` and `configured` are ignored |
| `PUT /settings/channels/:id` | `ChannelConfig` (the fields `CHANNEL_FIELDS` lists for that channel) | Sets up a channel and switches it on. **Write-only**: the body is validated with `validateChannelConfig` (Discord only at discord.com, Telegram by token + chat id, ntfy/SMTP never at a loopback, link-local or metadata address), stored, and never returned — `Channel.target` stays masked. 204; 422 for a field that does not validate; 409 when the collector's `NW_*` variable sets that channel (it wins); 404 for an unknown channel |
| `DELETE /settings/channels/:id` | | Forgets a channel set up in Settings → 204 (409 when set by `NW_*`) |
| `POST /settings/channels/:id/test` | | Sends one test message through that channel → `ChannelTestResult` (404 for an unknown channel) |
| `POST /services/:id/check` | | "Test now": one health check right away, stored with the others → `ServiceCheckResult` (404 when the service is not monitored) |

A write the backend refuses because the input is invalid answers **422** with a one-line reason as
the body; an unknown id answers **404**.

## Alerting

All alerting state comes back in one `GET /alerts` payload (`AlertsData`): active alerts, rules,
history, silences, maintenance windows, escalation policies and the services a window can target.
Every write above is followed by a refetch of it.

- **Rules.** A rule has a structured `condition` — `metric`, `comparator` (`>`, `>=`, `<`, `<=`, `==`,
  `!=`), `threshold` and `forSeconds` — never a free-text expression. Metrics: `heartbeat` (1/0 per
  service), `latency` (ms per service), `cpu`, `memory`, `disk` (% per node, NexusInfra only),
  `queue_depth` (ready messages per queue), `error_rate` (% 5xx per service) and `topups` (per hour),
  the last three FinVault only. The written form (`queue_ready > 25 for 5m`) is produced and parsed
  by `lib/rules.ts`; the backend must accept the same ranges (percentages 0–100, heartbeat 0 or 1,
  `forSeconds` at most 7 days, at least one channel, `runbookUrl` empty or http(s)).
- **Evaluation.** A target fires when its newest samples have breached the condition for at least
  `forSeconds`; fewer seconds is `pending`. An unknown sample (`null`) is `no_data` and breaks a
  breach run — it is never compared as `0`.
- **Silences.** `duration` is `15m`, `1h`, `4h` or `resolved`. A timed silence has an `endsAt` and
  disappears from the payload once it passes; `resolved` (`endsAt: null`) lasts until the alert — or,
  for a rule, every active alert of that rule — resolves, and is refused (422) for a rule with no
  active alert. A reason is required. An alert's `silenceId` names the silence muting it.
- **Maintenance windows** cover a whole project (`serviceId: null`) or one service, once or weekly
  (`recurrence: 'weekly'` repeats every 7 days from `startsAt`). An alert inside an active window
  carries its `maintenanceId`; no notifications or escalation steps are sent for it.
- **Escalation.** A policy is an ordered list of steps, each a channel and `afterMinutes` after the
  alert fired, strictly increasing. The rule's own `channels` are notified at once; policy steps run
  until the alert is acknowledged (`acknowledgedAt`), pause while it is silenced, and are skipped
  inside maintenance.
- **Notes.** Acknowledging and resolving can carry a note; notes appear on the active alert and on
  its history entry (`alertId` links the two while the alert exists).

Notification channel ids are `discord`, `telegram`, `email` and `push`; `routing` has an entry for
every channel under every severity (`critical`, `warning`, `info`).

**Where a channel sends to is never part of the API.** A webhook URL, bot token or ntfy topic is a
secret, and an endpoint that accepted one would let anyone who can reach the API make the backend call
an address of their choosing. Targets are the backend's own configuration; `Channel.target` is a masked
description (`discord.com/api/webhooks/••••a1b2`), and `Channel.configured` says whether there is one.
While there is none, `target` names what to set and the dashboard disables "Send test".

A channel test answers 200 with `{ ok, detail }` whether or not the message arrived — a failed delivery
is a result, not an HTTP error — and `detail` never contains the target. It ignores the channel's
switch and the routing, so a channel can be tried before it is turned on.

Agent tokens are only ever returned as a hint (last four characters); a full token is shown once, at creation.

## Served by the collector

The backend is `collector/` (see [architecture.md](architecture.md)). Every endpoint above is always
served: a part with a configured source is answered from stored data ("live"), every other part from
the dashboard's own sample generators, so the API is complete from the first start. `GET /health`
lists which parts are live.

**No sample data once a source is set.** With any source configured, every endpoint answers from what
the collector measured; a part without a source answers empty or unknown (`series: []`, `–` summaries,
empty lists, 0 counts; the Overview's `topupsToday` / `paymentsMonthEur` are `null` without a bus). SLOs are one availability objective per health target (`NW_SLO_TARGET`, 30 days;
a check that answered is good). `/incidents` lists declared incidents and the collector's own (health
checks, heartbeat sources, rules; never public). `/status` has one component per health target, by name
only. With `NW_DOCKER_SOCKET`, top consumers, the NexusInfra container list and the memory, disk IO and
network figures come from the host's Docker Engine; the host card names the Docker host unless
`NW_HOST_NAME` is set.

**Business data from the bus.** With `NW_RABBITMQ_URL` set, the collector also binds `bank.payment.#`,
`events.#`, `billing.#` and `infra.#` on `finvault.events` and stores each event once (by event id), with
only ids, amounts and times kept — free text is dropped and emails are masked before storing. From those
it answers `/business`, the Overview's top-up and payment tiles, the payments on `/projects/nexusinfra`
and the business part of `/projects/finvault`. Days and hours are UTC. A top-up is NexusInfra's
`payment.request` with a `topup-…` reference; a payment is a top-up FinVault confirmed, counted on the
day it was confirmed; a transfer is any other `payment.confirmed` / `payment.failed`. What the bus does
not carry is reported as unknown, never as sample data: `TopUpRecord.status` and `credits` are `null`
(the bridge publishes no credit event), `accounts` and `revenueByPlan` are empty (they live in the
bridge's database), `FinVaultData.kpis.openInvoices` / `fxConversions` / `transferSuccessPct` (no
transfer yet) and `security` are `null`, `walletSplit`, `queues`, `bus.queues` and
`NexusInfraData.containers` are empty (wallet types, the broker's management API and the node agent's
container list are not reachable read-only). `topUpTimeoutMs` / `lowCreditHours` come from
`NW_TOPUP_TIMEOUT_MS` / `NW_LOW_CREDIT_HOURS` (NexusInfra's defaults: 30 min, 24 h).

SLOs, incidents, `/status` and the alerting writes (rules, silences, maintenance windows,
escalation policies, resolving an alert) have no live source yet: the collector answers them from the
sample generators. What the writes change — rules, silences, maintenance windows, escalation policies,
acknowledgements with their notes, resolutions, declared incidents and their updates — is stored after
every successful write and loaded again at start, so it survives a restart. Nothing is stored before
the first write; from then on the stored incidents and windows keep the times they had at that moment
instead of moving with the clock. Errors keep the statuses in the tables above (404 unknown, 409
already resolved, 400 invalid input), and a refused write stores nothing.

Without a live source, `POST /alerts/:id/ack` keeps the note and the time of acknowledgement, and
answers 404 for an alert that is not active.

**Rule evaluation.** With a live source the collector evaluates every enabled rule on an interval
(`NW_RULES_INTERVAL_MS`), with the semantics of `lib/rules.ts`. Metrics with a source: `latency` per
monitored service, `cpu`, `memory` and `disk` per node. `queue_depth`, `error_rate` and `topups` have
none yet — their rules have no targets and never fire. `heartbeat` rules are not evaluated: the health
checker raises an outage after `NW_HEALTH_FAILURES_FOR_INCIDENT` failed checks, under the stored
"Service down" rule of the project. An alert a rule raised carries that rule's id, its condition as
`rule`, the current measurement as `value` and the recent samples as `trend`; it resolves when the
condition clears, or when the rule is switched off or deleted. `silenceId` and `maintenanceId` are set
on live alerts too (a silence on the rule; a window on the project or the service), `AlertsData.services`
lists the monitored services, and `POST /alert-rules/test` evaluates against the live measurements
(422 for a malformed condition).

**Notifications.** With a live source the collector notifies when an incident opens and again when
it closes, through every channel that the incident's severity is routed to, is switched on and has a
target. Each message is sent once: what was delivered is stored, so a restart does not repeat it; a
channel that fails is retried on the next run, five times at most, and every delivery or failure is a
log line of the `collector` service. The all-clear only goes to channels the alarm reached. Sample
alerts never notify. A notification is held while the alert's rule is silenced or a maintenance window covers it, and sent
when that ends if the alert is still open. Escalation steps do not affect delivery yet.

Rules the live answers follow, beyond the shapes:

- **Series are never padded.** A live series starts at its first measurement in the window and is
  shorter than the full length until enough history exists (`beats` ≤ 48, `checks` ≤ 120,
  `responseTimes` ≤ 96, `days` ≤ 60, metric series ≤ 90). A metric nobody measures has no series at
  all. An empty bucket after the first measurement repeats the previous value.
- **Unknown is `null`** where the contract allows it: a failed check's latency, `FinVaultService.rps`
  and `errorPct` while no request-rate source covers FinVault, and the business fields above.
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

## Business (`GET /business`)

The money flow between the two platforms, as both sides recorded it. The backend reports **facts, not
verdicts**: the dashboard reconciles them itself with the rules in `dashboard/src/lib/reconcile.ts`, so
the rules are tested once and the backend cannot quietly disagree with them.

- `topUpTimeoutMs` and `lowCreditHours` are NexusInfra's own `TOPUP_TIMEOUT_MS` and `LOW_CREDIT_HOURS`,
  read from the Billing Bridge's configuration, so the page judges with the bridge's clock.
- `topUps` — every top-up requested in the last 7 days, newest first. Per top-up: the reference
  NexusInfra issued, the account id, the requested amount, whether the broker took `payment.request`
  (`sent`), the bridge's ledger status and when it turned *Not confirmed*, FinVault's answer as seen on
  the bus (`events.payment.*` or `bank.payment.*`, matched on the reference) and every credit-ledger
  entry carrying the reference. `credits` is a list on purpose: two entries is the anomaly to catch.
  `status` and `credits` are `null` together when the backend cannot see the bridge's ledger (a
  bus-only collector): `[]` would claim "not credited". The dashboard then shows the wallet step as
  *not observed* and a FinVault-confirmed top-up as `confirmed` instead of `credited`.
- `payer` is the payer's email **masked by the backend** (`t***@e***.com`) or null. A full address must
  never be returned; the dashboard masks again on display as a safety net. Everything else is ids.
- `accounts` — each account's standing: balance, available (balance less usage not yet charged),
  `canRun`, `hoursLeft` (null with nothing running — no estimate, not zero and not infinite), running
  servers, and when `billing.credit.low` was published for the current dip.
- `suspended` — servers stopped by `billing.server.suspend`, with when and why.
- `revenueByPlan` — usage charged at each plan's rate, per day for 30 days, and its total.
- `bus` — `finvault.events` throughput per minute (last hour), the dead-letter queue, each publisher's
  outbox (pending + dropped) and each queue's bindings, consumers and ready count. **A broker or service
  that could not be asked is `null`, never `0`** — the DLQ then carries the `error` that said why, as in
  NexusInfra's Control Room DLQ watch (#243).

