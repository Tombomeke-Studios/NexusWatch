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
| `GET /host` | | `HostInfo` | Sidebar host card |
| `GET /nav` | | `NavCounts` | Sidebar badge and project counts |
| `GET /overview` | `range` | `OverviewData` | Overview |
| `GET /metrics` | `range` | `MetricsOverview` | Metrics summaries + top consumers |
| `GET /metrics/:id` | `range` | `MetricData` (`id` ∈ cpu, memory, disk, network, queues) | Metrics chart + statistics |
| `GET /logs` | `q`, `range`, `level` (comma list), `project` | `LogsData` | Logs |
| `GET /heartbeats` | | `HeartbeatsData` | Heartbeats |
| `GET /alerts` | | `AlertsData` | Alerts |
| `GET /services/:id` | | `ServiceDetail` (404 when unknown) | Service detail |
| `GET /projects/nexusinfra` | | `NexusInfraData` | Project NexusInfra |
| `GET /projects/finvault` | | `FinVaultData` | Project FinVault |
| `GET /settings` | | `SettingsData` | Settings |

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
| `PATCH /settings` | any of `{ channels, routing, retention }` | Replaces the given settings sections |

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
every channel under every severity (`critical`, `warning`, `info`). A Telegram target is a bot
`sendMessage` URL with the chat id — the bot token is a secret and, like agent tokens, should only be
returned masked once the backend stores real values.

Agent tokens are only ever returned as a hint (last four characters); a full token is shown once, at creation.
