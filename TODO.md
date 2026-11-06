# TODO

Progress per branch. `(#—)` = no GitHub issue yet (no remote until the concept is approved — see CLAUDE.md §0).

## Active

### `feature/alert-rules` — branch finished, waiting for a merge go-ahead
- [x] `lib/rules.ts`: parse/format/validate conditions, durations, evaluation (unknown ≠ 0), silences, maintenance windows, escalation progress, history filter — with tests (#—)
- [x] Contract: structured rule conditions, silences, maintenance windows, escalation policies, notes, rule test; mock + `docs/api.md` + mock contract tests (#—)
- [x] Accessible `Dialog` / `ConfirmDialog` primitive (focus trap, Escape, focus returns to the opener) (#—)
- [x] Rule editor: create, edit, duplicate, delete (confirm, Cancel focused), live validation, condition preview, test against current data (#—)
- [x] Mute an alert or rule for 15m/1h/4h/until resolved with a reason; Muted KPI; silences list with countdown and unmute (#—)
- [x] Maintenance windows per project or service, optionally weekly; alerts inside are labelled and suppressed (#—)
- [x] Escalation policies: editable ordered steps, progress shown on each active alert (#—)
- [x] History: project/severity/status filters, acknowledge/resolve notes (#—)
- [x] UI tests for the dialogs and alerting flows; browser-checked in both themes and at 390px (#—)

## Backlog

### Backend (`feature/collector`)
- [ ] Decide the collector stack (Node/TS to match NexusInfra is the default) and add a `collector` workspace (#—)
- [ ] Serve the `/api` contract in docs/api.md from stored data, replacing the mocks endpoint by endpoint (#—)
- [ ] Poll NexusInfra Control Room `/status` + `/uptime` and every service's `/health` (#—)
- [ ] Consume `monitoring.heartbeat.#` from the `finvault.events` exchange via `readPayload()` (#—)
- [ ] Scrape Prometheus `/metrics` from NexusInfra services (#—)
- [ ] Deliver notifications: Discord webhook, Telegram Bot API `sendMessage`, SMTP, ntfy — and the "Send test" button (#—)
- [ ] Evaluate alert rules server-side with the same semantics as `lib/rules.ts` (for-duration, unknown ≠ 0), honouring silences, maintenance windows and escalation policies (#—)
- [ ] Storage with retention per data kind (logs / metrics / heartbeats) (#—)
- [ ] Contract tests: run `api/mock/data.test.ts` invariants against the real API (#—)

### Dashboard
- [ ] Authentication (who may see the dashboard) — decide before any data is real (#—)
- [ ] Wire the "Coming soon" actions: add monitor, test check, rotate agent token, send test notification (#—)
- [ ] Alerting follow-ups: Overview's open-alert KPI is still hard-coded in the mock; Service detail's "Escalation" setting is static text — read both from `/alerts` (#—)
- [ ] Alerting follow-ups: a rule has no per-service/queue scope yet (it covers every target of its project); add label filters like `service="…"` (#—)
- [ ] Alerting follow-ups: the escalation display infers "sent" from elapsed time; once the collector delivers notifications, return the real delivery log per alert (#—)
- [ ] Alerting follow-ups: a maintenance window's "Starts" uses the browser's time zone with no zone label; show it, and handle DST for weekly windows server-side (#—)
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
