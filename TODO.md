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

### `feature/collector` (local branch `claude/collector-fc695d`)
- [x] `collector` workspace: Node/TS ESM, Express, `node:sqlite`; imports the dashboard's types + sample data from source (#—)
- [x] Serve every endpoint of docs/api.md (+ the collector's own `/health`), sample data where no source is configured (#—)
- [x] Heartbeat checker for configured `/health` targets: interval, timeout, slow threshold, `null` latency on failure, incidents (#—)
- [x] Poll NexusInfra Control Room `/status` + `/uptime` (nodes, heartbeat sources, dead letters) (#—)
- [x] Scrape Prometheus `/metrics`: request rate, 5xx rate, p95, dead letters, outbox, containers (#—)
- [x] Consume `monitoring.heartbeat.#` from `finvault.events` via a `readPayload()` mirror, wire-compat test with a NexusInfra ciphertext (#—)
- [x] Storage with retention per kind (logs / metrics / heartbeats) from the Settings options; stable stored log ids (#—)
- [x] Contract tests: the `data.test.ts` invariants over HTTP, sample and live mode (#—)
- [x] `collector/Dockerfile`, dashboard Dockerfile + nginx, `docker-compose.yml`, `.env.example`, `npm run dev` starts both (#—)
- [x] `FinVaultService.rps` nullable (unmeasured is not 0) (#—)
- [x] Docs: architecture, api (`/health`, live rules), CLAUDE.md, README (#—)

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

### Backend (collector follow-ups)
- [ ] Deliver notifications: Discord webhook, Telegram Bot API `sendMessage`, SMTP, ntfy — and the "Send test" button (#—)
- [ ] Evaluate alert rules (today every open incident is an active alert; rules are the sample set + stored toggles) (#—)
- [ ] Consume FinVault gateway events (`bank.payment.*`, `events.<type>`): top-ups, payments, transactions, FinVault rps/error % (#—)
- [ ] Make unmeasured numbers nullable in the contract: `Monitor.avgLatencyMs`, service-detail avg/p95 latency, `restarts24h`, `NodeSummary.containers` (#—)
- [ ] Dependency chains on Service detail (collector returns `[]` — needs topology config) (#—)
- [ ] Alerts for heartbeat sources link to `/services/<source>`, which 404s for nodes — link nodes to Heartbeats instead (#—)
- [ ] Charts: align a live series that is shorter than the window to the right of the time axis (#—)
- [ ] Heartbeats card says "every 30 s" — show the configured interval from the API (#—)
- [ ] Host card shows sample "nodes connected" when no node source is configured — say "no node source" instead (#—)
- [ ] Build and run the Docker images end to end (compose validated, images not built yet: Docker daemon was off) (#—)
- [ ] Migrations directory once the schema needs a second version (schema is created on start today) (#—)
- [ ] Move the contract (types + sample data) into its own workspace so the collector can use NodeNext resolution (#—)

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
- [ ] Alerts tables: add `data-label` captions (left to `feature/alert-rules`, which rewrites that page) (#—)
- [ ] Offline banner when the service worker serves the cached shell and `/api` is unreachable (#—)
- [ ] Web push for alerts on the installed PWA (needs the backend's notification delivery) (#—)
- [ ] Accessibility pass with axe in both themes (#—)
- [ ] Overview "Recent events": make events clickable the same way as service logs (#—)
- [ ] Code-split pages (bundle is 444 kB before gzip) (#—)

### Agent (`feature/agent`)
- [ ] `nexuswatch/agent` container from the Settings design: heartbeats, metrics, logs to the server (#—)

### Infra
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
