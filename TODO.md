# TODO

Progress per branch. `(#—)` = no GitHub issue yet (no remote until the concept is approved — see CLAUDE.md §0).

## Active

### `feature/status-slo` — local, not merged
- [x] SLO maths in `lib/slo.ts`: budget, burn rate, time to exhaustion, burn-down, multi-window burn alerts; unknown checks excluded (#—)
- [x] `/slo` page: per-service target, attainment, budget left, burn 1h/6h/24h, burn alerts, burn-down chart (#—)
- [x] SLO card on Service detail (#—)
- [x] Incidents: `/incidents` + `/incidents/:id` with lifecycle, update timeline, affected services, duration, postmortem (#—)
- [x] Mock mutations: declare incident, post update, resolve (with postmortem) (#—)
- [x] Heartbeats' incident list links to the incident pages (same store) (#—)
- [x] Public `/status` page outside the shell: banner, component groups with 90-day bars, active + recent incidents, maintenance (#—)
- [x] `StatusPageData` public-safe types + test that no host/port/IP/id leaks (#—)
- [x] Contract (types, endpoints, hooks, mocks, docs/api.md), route tests, mock contract tests (#—)

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

### Reliability (follow-ups from `feature/status-slo`)
- [ ] Backend: compute SLO tallies per day and per burn window from stored checks; `unknown` for gaps (#—)
- [ ] Backend: deliver SLO burn alerts through the notification routing (page = critical, ticket = warning) (#—)
- [ ] Define SLOs in Settings (target, window, objective) instead of one per service — "+ New SLO" is "Coming soon" (#—)
- [ ] Latency SLOs (e.g. p95 < 300 ms) next to availability (#—)
- [ ] Incidents: edit postmortem and tick action items after resolving; link alerts to the incident they opened (#—)
- [ ] Maintenance windows: create/edit in the dashboard, and mute alerts during them (#—)
- [ ] Serve `/status` from a separate, unauthenticated origin once authentication lands; cache it (#—)
- [ ] Service detail at 390 px: the 120-check strip (3 px gap) is ~600 px wide and scrolls the page sideways — existed before this branch (#—)

### Dashboard
- [ ] Authentication (who may see the dashboard) — decide before any data is real (#—)
- [ ] Wire the "Coming soon" actions: add monitor, new rule, mute, test check, rotate agent token, send test notification (#—)
- [ ] Time range actually changes query windows once the API supports it (#—)
- [ ] Narrow-screen pass: collapsible sidebar below 820px (#—)
- [ ] Accessibility pass with axe in both themes (#—)
- [ ] Overview "Recent events": make events clickable the same way as service logs (#—)
- [ ] Code-split pages (bundle is 444 kB before gzip) (#—)

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
