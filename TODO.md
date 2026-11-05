# TODO

Progress per branch. `(#—)` = no GitHub issue yet (no remote until the concept is approved — see CLAUDE.md §0).

## Active

### `feature/business-insights`
- [x] Pure top-up reconciliation rules with tests: confirmed not credited, credited twice, amount mismatch, stuck past `TOPUP_TIMEOUT_MS`, late confirmation (#298), credit without confirmation (#—)
- [x] Business contract (`GET /business`): top-ups as both sides recorded them, standing, suspensions, revenue per plan, bus health — types, mock, docs/api.md (#—)
- [x] Seeded sample data with every anomaly, plus mock contract tests (masked payers, null = unknown) (#—)
- [x] Business page: reconciliation KPIs, anomalies, pipeline with filter; credit and standing; event bus (throughput, DLQ, outbox, consumers) (#—)
- [x] Nav entry under Projects; links to and from the FinVault and NexusInfra pages (#—)

## Backlog

### Backend (`feature/collector`)
- [ ] Decide the collector stack (Node/TS to match NexusInfra is the default) and add a `collector` workspace (#—)
- [ ] Serve the `/api` contract in docs/api.md from stored data, replacing the mocks endpoint by endpoint (#—)
- [ ] Poll NexusInfra Control Room `/status` + `/uptime` and every service's `/health` (#—)
- [ ] Consume `monitoring.heartbeat.#` from the `finvault.events` exchange via `readPayload()` (#—)
- [ ] Scrape Prometheus `/metrics` from NexusInfra services (#—)
- [ ] Deliver notifications: Discord webhook, Telegram Bot API `sendMessage`, SMTP, ntfy — and the "Send test" button (#—)
- [ ] Storage with retention per data kind (logs / metrics / heartbeats) (#—)
- [ ] Contract tests: run `api/mock/data.test.ts` invariants against the real API (#—)

### Dashboard
- [ ] Authentication (who may see the dashboard) — decide before any data is real (#—)
- [ ] Wire the "Coming soon" actions: add monitor, new rule, mute, test check, rotate agent token, send test notification (#—)
- [ ] Time range actually changes query windows once the API supports it (#—)
- [ ] Narrow-screen pass: collapsible sidebar below 820px (#—)
- [ ] Accessibility pass with axe in both themes (#—)
- [ ] Overview "Recent events": make events clickable the same way as service logs (#—)
- [ ] Code-split pages (bundle is 444 kB before gzip) (#—)
- [ ] Business: click a top-up to see its events on the bus and the bridge's log lines (`routes.logsFor(reference)`) once the collector indexes references (#—)
- [ ] Business: raise reconciliation anomalies as alerts (rules on `confirmed-not-credited`, `credited-twice`, DLQ depth > 0) (#—)
- [ ] Business: time range for the top-up window (7 days is fixed in the contract today) (#—)
- [ ] Business: the collector must read the Billing Bridge only in the hosted edition and say so when it is community (#—)

### Agent (`feature/agent`)
- [ ] `nexuswatch/agent` container from the Settings design: heartbeats, metrics, logs to the server (#—)

### Infra
- [ ] Dockerfile + nginx for the dashboard (#—)
- [ ] CI workflow (build, lint, test) — once a remote exists (#—)

## Done
### `feature/telegram-channel` — merged into `dev`
- [x] Telegram as a notification channel: settings list, routing column, API contract (#—)

### `feature/dashboard-foundation` — merged into `dev`
- [x] Workspace, Vite + React + TypeScript, ESLint, Vitest (#—)
- [x] Design tokens and component classes from the NexusWatch design, dark + light theme (#—)
- [x] Typed API layer: contract types, fetch client, mock/HTTP switch, React Query hooks (#—)
- [x] Sample data ported from the design (#—)
- [x] App shell: sidebar, alert badge, host card, routing for all nine pages (#—)
- [x] Pages: Overview, Metrics, Logs, Heartbeats, Alerts, Service detail, NexusInfra, FinVault, Settings (#—)
- [x] Tests: chart maths, formatting, client, mock contract, every route renders (#—)
- [x] CLAUDE.md, README, docs/architecture.md, docs/api.md (#—)
- [x] Service detail: click a log line to unfold its full document (#—)
- [x] Logs: deep link `/logs?q=…&entry=…` opens that search with the line selected (#—)
- [x] Mock: healthy services no longer log failed health checks; stable log ids (#—)
