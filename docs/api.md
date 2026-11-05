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
| `GET /business` | | `BusinessData` | Business (money flow FinVault → NexusInfra) |

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

