# TODO

Progress per branch. `(#—)` = no GitHub issue yet (no remote until the concept is approved — see CLAUDE.md §0).

## Active

### `feature/mobile` — ready for review (not merged)
- [x] Shared nav config (`nav.ts`) for the sidebar and the mobile shell (#—)
- [x] Mobile shell below 820px: top bar (logo, title, alert badge) + bottom tab bar with a "More" sheet (#—)
- [x] `Sheet`: focus trap, Escape/backdrop close, inert page, focus return, safe-area insets (#—)
- [x] Every page usable at 390px without horizontal scroll (measured on every route at 390 and 768) (#—)
- [x] `.tbl` rows become stacked cards with `data-label` captions; segmented controls scroll; 44px touch targets (#—)
- [x] Logs: facets in a filter sheet, a tapped line opens its document full-screen (#—)
- [x] PWA: manifest, icons from the logo, apple-touch-icon, `theme-color` per theme, app-shell service worker (#—)
- [x] Theme applied before first paint (no dark flash on reload in light mode) (#—)
- [x] Tests: shell (tabs, More sheet, Escape, active tab, Logs sheets), `nav` helpers, `trapIndex` (#—)

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
- [ ] Alerts tables: add `data-label` captions (left to `feature/alert-rules`, which rewrites that page) (#—)
- [ ] Offline banner when the service worker serves the cached shell and `/api` is unreachable (#—)
- [ ] Web push for alerts on the installed PWA (needs the backend's notification delivery) (#—)
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
