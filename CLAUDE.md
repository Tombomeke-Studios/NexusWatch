# NexusWatch — CLAUDE.md

Monitoring dashboard for the tombomeke-studio platforms: one place for heartbeats, logs, metrics and
alerts of **NexusInfra** (Docker server management) and **FinVault** (banking platform), plus the
business link between them (FinVault top-ups paying for NexusInfra capacity).
Currently: a React + TypeScript dashboard (Vite) behind a typed API layer, and the `collector` backend that
serves that API from real sources where configured and from the dashboard's sample data everywhere else.
This file is **context + rules only** — all tasks and progress live in [TODO.md](TODO.md).

Design source of truth: the **NexusWatch Monitoring** design artifact (claude.ai, nine artboards:
Overview, Metrics, Logs, Heartbeats, Alerts, Service detail, Project NexusInfra, Project FinVault, Settings).
When the design and this repo disagree on look or layout, the design wins; on behaviour, ask.

---

## 0. Where we are — read this first

**Phase 0 — concept not yet approved.** The idea is still waiting for sign-off, so:

| Rule | Why |
|---|---|
| **Local git only. Never `git push`, never create a GitHub repo, never add a remote** unless the user says so in chat, for that moment. | Publishing an unapproved project is not reversible in practice. |
| **No GitHub issues yet.** TODO items carry `(#—)` until the repo exists. | Issues need a repo. |
| Commit normally (small, conventional commits) on the local branches below. | So history is ready to push the day it is approved. |

**The day a remote is approved** (one-off, in this order): create the repo → push `main`, `staging`, `dev`
and open feature branches → set default branch to `dev` → create an issue for every open TODO item and
replace each `(#—)` with its `(#N)` → from then on, sections 2a and 2b apply in full, including pushing.

**What exists:** every page from the design, routed, wired to React Query hooks; the `collector`
workspace serving every path of [docs/api.md](docs/api.md) (health checks, Control Room, Prometheus
scrape, event-bus heartbeats → SQLite; sample data for anything without a source), and notification
delivery for real incidents (Discord, Telegram, ntfy, email), and rule evaluation on live latency and node metrics.
Business data (top-ups, payments, transfers, suspensions) comes from the bus too.
**What does not:** the agent, rule metrics without a source (queue depth, 5xx rate, top-ups), what only the Billing Bridge's database or FinVault's services know (credits, standing, plans, invoices, FX, security).

**Relation to the other projects.** NexusWatch is a *read-only observer*. It never changes NexusInfra
or FinVault state and never shares their databases. Built data sources (collector): NexusInfra's
Control Room `/status` + `/uptime`, every service's `/health` and Prometheus `/metrics`, the
`monitoring.heartbeat.#` routing keys and the business events (`bank.payment.#`, `events.#`, `billing.#`,
`infra.#`) on the `finvault.events` exchange.
Consuming that exchange means following NexusInfra's wire rules (`readPayload()`, never rename the
exchange, never change the encryption constants).

---

## 1. Language policy

**Everything is written in English** so the project is uniform end to end:

- UI copy, labels, toasts, error messages (the design artboards are in Dutch — translate, don't copy)
- Code comments, identifiers, log output
- Documentation (`docs/`, README, this file), commit messages, branch names, test names

Conversation with the user may be in Dutch; artifacts in the repo are English.

## 2. Branch strategy — three tiers (local until approved)

```
feature/<topic>  →  dev  →  staging  →  main
```

| Branch | Purpose | Who merges into it |
|---|---|---|
| `feature/<topic>` | Active development — one logical topic per branch | You, via PR (locally: `git merge --no-ff` after the finish protocol) |
| `dev` | Integration — always green, shared ground truth | Feature branches |
| `staging` | Production preparation — smoke tests, env hardening | `dev`, once a milestone is complete |
| `main` | Production — only ever updated from `staging` | `staging`, after sign-off |

**Rules:**
- A feature branch **never** targets `main` or `staging` directly.
- `staging` only receives merges from `dev`; `main` only from `staging`.
- `main` and `staging` are permanent — never delete them.
- A red `dev` is everyone's problem — fix it before starting new work.
- Merging into `dev`, `staging` or `main` **locally** needs the user's go-ahead in chat (it replaces the PR review that would otherwise happen).
- After a `staging → main` promotion, back-merge `main` into `dev` so `git log --oneline dev..main` stays empty.

## 2a. Tasks and issues

- **TODO.md** is the single source of truth for progress, grouped per branch.
- Until a remote exists (section 0): every actionable item is a TODO line with `(#—)`.
- Once it exists: every actionable item gets a GitHub issue (`gh issue create … --label type:<bug|feature|refactor|test|docs|ci>`), the TODO line carries `(#N)`, a bug gets an issue the moment it is found, and a PR body closes each issue on its **own** `Closes #N` line.

## 2b. The iteration loop (every unit of work)

A "unit" = one function, feature, fix or refactor — the smallest shippable slice.

1. **Pick** the next unticked item from the active branch group in TODO.md.
2. **Read context** first: the codebase map below + the matching doc + the matching design artboard.
3. **Write tests first** where there is logic (pure helpers, mappers, API client, mock contract).
4. **Implement** the slice. Match surrounding style; reuse `components/ui` before writing new markup.
5. **Run** `npm test`, `npm run lint`, `npm run build` — all green.
6. **Check it in a browser** when it changes what a page shows — both themes, and a narrow (≤ 820px) width.
7. **Document it**: affected doc(s); new or moved files also update the codebase map in this file.
8. **Tick TODO.md** (add discovered follow-ups to the backlog).
9. **Commit** — one small commit: code + tests + docs + TODO tick together.
10. **Push** — *only after section 0 is lifted.* Until then, stop at the commit.

**Branch finish protocol:** `npm run build && npm run lint && npm test` all pass → (after approval: push +
PR to `dev`, wait for CI) → move the group to Done in TODO.md.

## 3. Commit rules

- **One logical change per commit.** If the message needs "and", split it.
- Never mix refactoring with behaviour changes; never mix dependency bumps with code.
- Format: `type(scope): imperative summary` — body explains *why* when non-obvious.
  - **Types:** `feat` `fix` `docs` `chore` `refactor` `test` `ci`
  - **Scopes:** `dashboard` `api` `ui` `pages` `mock` `collector` `agent` `infra` `docs`
  - Example: `feat(pages): add service detail with dependency chains`
- Before every commit: tests pass and lint is clean.

## 4. Testing rules

- **Vitest**, colocated `*.test.ts(x)` next to the source (`lib/series.test.ts` pattern).
- **Pure logic must be tested**: everything in `lib/`, `api/client.ts`, and the mock contract (`api/mock/data.test.ts`);
  in the collector every source adapter, the store and the series helpers (fake `fetch` + clock, `:memory:` SQLite).
- **Pages**: `App.test.tsx` renders every route and checks its `<h1>`. A new route adds a row there.
- **The mock data is a stand-in for the backend** — `data.test.ts` guards its invariants (counts add up,
  a down service has a `null` latency, filters filter). `collector/src/contract.test.ts` checks the same
  invariants against the collector's HTTP answers, with no sources and with live (fake) sources.
  A new invariant goes in both.
- **Bug fixes:** write the test that catches the bug first, when feasible.

## 5. Documentation rules — which doc owns what

No database code in documentation (no DDL, migrations, index or column listings) — describe what is
stored and why in prose. The schema's source of truth will be the migrations directory.

| You changed... | Update |
|---|---|
| An API path, query param or response shape | [docs/api.md](docs/api.md) **and** `dashboard/src/api/types.ts` in the same commit |
| Data flow, planned services, integration with NexusInfra/FinVault | [docs/architecture.md](docs/architecture.md) |
| New/moved/renamed files, new commands, new gotchas | **This file** (sections 6–8) |
| Setup / how-to-run | [README.md](README.md) |
| Tasks, progress, follow-ups | [TODO.md](TODO.md) — and only there |

## 6. Commands

| What | Command (repo root) |
|---|---|
| Install | `npm install` |
| Collector + dashboard on the collector (5173 → `/api` → 8080) | `npm run dev` |
| Dashboard alone on sample data | `npm run dev:mocks` |
| Collector alone (http://localhost:8080, reads root `.env`) | `npm run dev:collector` |
| Production build (dashboard bundle + collector typecheck) | `npm run build` |
| Tests (both workspaces) | `npm test` |
| Lint | `npm run lint` |
| Containers (collector + nginx dashboard, http://localhost:8088) | `docker compose up --build` |
| Point the collector at real sources | copy `.env.example` to `.env` (repo root) and set the `NW_*` variables |
| Dashboard against another backend | `/api` is proxied to `NW_API_TARGET` (default `http://localhost:8080`) |

## 7. Codebase map — where is what

### Root
| Path | Contents |
|---|---|
| `package.json` | npm workspaces (`dashboard`, `collector`; room for `agent`) + root scripts |
| `scripts/dev.mjs` | `npm run dev`: starts collector + dashboard, prefixes their output |
| `eslint.config.js` | Flat ESLint config (typescript-eslint + react-hooks) for all workspaces |
| `dashboard/index.html` | Viewport (`viewport-fit=cover`), `theme-color`, manifest + apple-touch-icon links, and a pre-paint script that applies the stored theme |
| `dashboard/public/` | `favicon.svg`, PWA `manifest.webmanifest`, icons (`icon*.svg` sources → `icon-192/512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`), `sw.js` (app-shell service worker, never caches `/api`) |
| `dashboard/scripts/render-icons.sh` | Regenerates the PNG icons from the SVG sources with headless Chrome |
| `.github/workflows/ci.yml` | Every push to dev/staging/main and every PR: build, lint, test, and both images built (not pushed) |
| `.github/workflows/release.yml` | On a `v*` tag: build/lint/test, push `ghcr.io/<owner>/nexuswatch/{collector,dashboard}:<version>` + `latest`, create the GitHub release |
| `.claude/launch.json` | Browser-preview entries: `dashboard` (sample data), `dashboard+collector` |
| `.env.example` | Every collector variable (sources, notification targets, timings, retention prune) |
| `docker-compose.yml` · `.dockerignore` | Collector (SQLite volume) + dashboard (nginx proxying `/api`) |
| `docs/` | `architecture.md` (data flow, planned services) · `api.md` (HTTP contract) |

### dashboard/src
| Path | Contents |
|---|---|
| `main.tsx` · `App.tsx` | Providers (React Query, theme, 401 → re-ask auth) + the route table (`routeTable`, exported for tests). Every page but Overview is a lazy route (own chunk); tests that check the location after navigating must `waitFor` it |
| `pwa.ts` | `registerServiceWorker()` — production builds only |
| `routes.ts` | **Every URL in the app.** Build links from here, never from string literals. `logsFor(q, entryId)` deep-links into Logs: unfiltered search on `q`, that line selected |
| `theme.tsx` | `ThemeProvider`/`useTheme` — dark (default) / light / system, stored in localStorage, sets `data-theme` on `<html>`; pure `resolveTheme` |
| `styles/tokens.css` | Design tokens from the artifact, both themes. **The only place colours are defined** |
| `styles/app.css` | Component classes, named as in the design (`.box`, `.kpi`, `.seg`, `.pill`, `.tr`, …) |
| `api/types.ts` | The API contract as the dashboard consumes it. Mock and real backend both produce these shapes |
| `api/client.ts` | `request()` — the one fetch wrapper (JSON, `ApiError` with status, 0 = no answer) + `buildUrl` |
| `api/endpoints.ts` | `api.*` — every backend call; each picks mock or HTTP from `config.useMocks` |
| `api/queries.ts` | React Query hooks (`useOverview`, `useLogs`, …) + mutations. **Pages read data only through these.** Live views poll every `VITE_REFRESH_MS` |
| `api/mock/data.ts` | Sample data ported from the design, seeded so it is stable; timestamps relative to now; in-memory state for toggles/acks, exported and restored as plain JSON by `alertingState()` / `restoreAlertingState()` |
| `api/mock/reliability.ts` | Sample SLO tallies, the in-memory incident store (create / update / resolve; Heartbeats lists the same incidents; `incidentState()` / `restoreIncidentState()` snapshot it) and the public status page. Reads `services` from `data.ts` only inside functions — the two modules import each other |
| `lib/series.ts` | Pure chart maths: `rng`, `walk`, `linePath`, `areaPath`, `stats`, `barHeights` |
| `lib/format.ts` | Display formatting: euros, percent, latency (`timeout` for null), durations, bytes, `formatClock`, `formatWhen` |
| `lib/status.ts` | Status/level/severity/project → colour, pill class and label maps |
| `lib/ranges.ts` | Time-range options + relative axis labels |
| `lib/slo.ts` | SLO maths: attainment, error budget, burn rate, time to exhaustion, burn-down, multi-window burn alerts (`BURN_RULES`), `summarizeSlo` |
| `lib/publicStatus.ts` | Public status roll-up: health → public status, worst of a group, overall banner |
| `lib/config.ts` | Typed Vite env (`useMocks`, `apiBase`, `refreshMs`) |
| `lib/useMediaQuery.ts` | `useMediaQuery`, `useIsNarrow` and `NARROW_QUERY` (`max-width: 820px`) — the one breakpoint, also used in `app.css` |
| `components/layout/nav.ts` | **Every nav entry** (`NAV`) for both shells, plus pure `tabItems`, `moreItems`, `isNavActive`, `isMoreActive`, `titleFor`. A new page adds one entry here |
| `components/layout/` | `AppShell` (background, sidebar *or* mobile bars, outlet, `theme-color` sync), `Sidebar` + `NavEntry` (desktop), `MobileNav` (`MobileTopBar`, `MobileTabBar` with the More sheet), `HostCard`, `Logo` |
| `components/layout/AuthGate.tsx` · `pages/Login.tsx` | Shows the login screen instead of the shell while `/auth` says a password is required; any 401 re-asks (`main.tsx`) |
| `components/ui/Sheet.tsx` | Modal bottom / full-screen sheet: focus trap (`trapIndex`), Escape + backdrop close, inert page, focus returns to the opener |
| `lib/reconcile.ts` | Pure top-up reconciliation: `reconcile` (pipeline steps, outcome, anomalies with reasons), `reconcileAll`, `summarize` (success rate, median time to credit, open anomalies), `median`. Rules follow NexusInfra's Billing Bridge (#298, #351) |
| `lib/business.ts` | Pure Business helpers: `maskEmail`, `creditState`/`sortByHoursLeft`/`formatHoursLeft` (standing, #365/#379), `describeDlq` (#243 wording) |
| `lib/channels.ts` | Notification channel setup: `CHANNEL_FIELDS` (the form), `validateChannelConfig` (shared by form, mock and collector), `isBlockedHost`, `maskChannelTarget` |
| `lib/monitors.ts` | `validateMonitor` (form, mock and collector; same host rules as channels), `monitorId`, `MONITOR_INTERVALS` |
| `pages/heartbeats/AddMonitor.tsx` | The "+ Add monitor" dialog on Heartbeats |
| `pages/settings/ChannelSetup.tsx` | The write-only "Set up / Change" dialog for a notification channel |
| `lib/rules.ts` | Pure alerting logic: `METRICS`, parse/format/validate rule conditions and durations, `evaluateReading`/`evaluateRule`, rule drafts (editor state), silences, maintenance windows, `escalationProgress`, `filterHistory` |
| `lib/useNow.ts` | `useNow(ms)` — ticking clock for countdowns |
| `components/ui/Card.tsx` | `Card` + `CardHeader` (title, hint, right-side content or "→" link) |
| `components/ui/primitives.tsx` | `Pill`, `StatusDot`, `Swatch`, `Segmented`, `Switch`, `Kpi`, `PageHeader` |
| `components/ui/charts.tsx` | `LineChart`, `Sparkline`, `BarChart`, `StatusStrip`, `Meter`, `StackBar`, `Legend`, `XAxis` — plain SVG/CSS, no chart library |
| `components/ui/QueryState.tsx` | Loading skeleton / error (404 → "Nothing here") / `children(data)` for any query |
| `components/ui/Icon.tsx` | The design's stroke icons by name (plus `close`, `more`, `filter` for the mobile shell) |
| `components/ui/Dialog.tsx` | `Dialog` (portal, focus trap, Escape, focus back to the opener, scroll lock) + `ConfirmDialog` (Cancel focused). Styles in `styles/dialog.css`, which also holds the form-field classes (`.fld`, `.frow`, `.ckl`, `.form-err`) |
| `components/NodeCard.tsx` | Node with CPU/memory/disk meters (Heartbeats + NexusInfra) |
| `components/SloCard.tsx` | A service's SLO in one small card (Service detail), linking to its burn-down on `/slo?service=…` |
| `components/LogDocument.tsx` | A log line's full structured document as JSON, with a link to its service or to the line in the log stream. Used by Logs (selected line) and Service detail (click a line to unfold it) |
| `pages/` | `Overview`, `Metrics`, `Logs`, `Heartbeats`, `Alerts`, `ServiceDetail` (`/services/:serviceId`), `projects/NexusInfra`, `projects/FinVault`, `Business`, `Settings`, `Slo` (`/slo`), `Incidents` + `IncidentDetail` (`/incidents/:incidentId`), `StatusPage` (`/status`, outside the shell), `NotFound` |
| `styles/reliability.css` | Classes for the SLO, incident and status pages (forms, lifecycle steps, update timeline, `.sp` status layout). Imported by those pages, not by `main.tsx` |
| `pages/Business.tsx` · `Business.css` | `/business`: top-up reconciliation (KPIs, anomalies, pipeline), credit and standing, event bus health. Own stylesheet (`biz-*` classes) imported by the page |
| `pages/alerts/` | Alerts page parts: `panels.tsx` (Active, Rules, Silences, Maintenance, Escalation, History tabs), `RuleEditor.tsx`, `dialogs.tsx` (mute, ack/resolve note, maintenance, escalation policy), `shared.tsx` (`Field`, `useChannels`). Page styles in `styles/alerts.css` |
| `test/setup.ts` | jest-dom + in-memory localStorage (see gotchas) |
| `../Dockerfile` · `../nginx/default.conf.template` | Dashboard image built with `VITE_USE_MOCKS=false`; nginx proxies `/api` to `NW_API_UPSTREAM` |

### collector/src
| Path | Contents |
|---|---|
| `index.ts` | Wiring only: config → store → scheduler + bus → HTTP; retention pruning timer |
| `config.ts` | `loadConfig(env)` — every `NW_*` variable, validated; a source is off until its variable is set |
| `contract.ts` · `sample.ts` | Re-export the dashboard's `api/types.ts` and `api/mock/data.ts` (never copied) |
| `routes.ts` | **Every endpoint, one table** (`/health` + docs/api.md); add an endpoint here |
| `server.ts` | Express app: routes under `/api` (behind the login middleware), `/api/auth/*`, `/health` at the root, `HttpError` → status + text |
| `monitors.ts` | Monitors added from the dashboard (SQLite) joining `config.health.targets`; pause set; `addMonitor` / `removeMonitor` / `pauseMonitor`; `ctx.monitors` (wired in `index.ts`) schedules them |
| `auth.ts` | Optional login (`NW_DASHBOARD_PASSWORD`): hashed sessions in SQLite, HttpOnly cookie, 5 wrong tries/min per address, `isPublic` paths |
| `store.ts` | SQLite (`node:sqlite`): logs, checks, samples, heartbeat sources, incidents, key/value, business events (never pruned); `prune`, `usage` |
| `duration.ts` | `parseDuration('14d')`, time ranges |
| `sources/health.ts` | Heartbeat checker: `checkOnce`, `runHealthCheck` (logs + incidents) |
| `sources/controlRoom.ts` | NexusInfra Control Room `/status` + `/uptime` poller |
| `sources/prometheus.ts` | Text-format parser (kept series only) + scraper with counter rates and histogram p95 |
| `sources/bus.ts` · `sources/payload.ts` | `monitoring.heartbeat.#` consumer; `readPayload()` mirror of NexusInfra's |
| `sources/docker.ts` | Docker Engine over its socket (GET only): containers with project (labels), CPU, memory, uptime, restarts; network / disk IO / memory totals; the host's name |
| `views/containers.ts` | Top consumers (CPU, last 5 min), the NexusInfra container list, `hostName` |
| `views/reliability.ts` | Live SLOs (one per health target, `NW_SLO_TARGET`), incidents (declared + the collector's own), `/status` from the monitored services |
| `sources/business.ts` | `BusinessRecorder`: binds `bank.payment.#`, `events.#`, `billing.#`, `infra.#`; stores each event once with kept fields only (`keptFields`), counts bus throughput per minute |
| `views/business.ts` | Top-ups, payments, transfers, suspensions and bus health from stored events: `/business`, the Overview money tiles, NexusInfra payments, the FinVault business part |
| `sources/heartbeat.ts` | Source status by age (Control Room thresholds), transitions → logs/incidents |
| `alerting/readings.ts` | `liveReadings`: stored checks and node samples as `Reading`s at a fixed step (unknown = `null`); `bucketsBack` |
| `alerting/evaluate.ts` | `evaluateRules` / `rulesTask`: opens and closes `rule:<ruleId>:<target>` incidents; `testRuleLive`, `currentReading`, `parseSubject` |
| `notify/channels.ts` | One sender per channel (Discord, Telegram, ntfy, email), `send()` that never throws, `maskTarget`, error scrubbing |
| `notify/targets.ts` | Channel targets set up in Settings (SQLite, write-only), `effectiveTargets` (NW_* wins), `configureChannel` / `removeChannel` |
| `notify/dispatch.ts` | `notifyOnce` / `notifyTask`: firing + resolved per incident, once, with retries, state in the store; `firingChannels` (rule's channels + due escalation steps, stopped by acknowledge); `testChannel` for "Send test" |
| `notify/mailer.ts` | nodemailer transport behind the `Mailer` type |
| `sources/scheduler.ts` · `sources/types.ts` | Per-task intervals, no overlap, last run/error for `/health`; `Fetch`/`Clock` types |
| `views/` | Each response from the store, or sample data when not live: `services`, `nodes`, `logs`, `alerts`, `metrics`, `settings`, `pages` (shell, overview, heartbeats, projects), `series` (pure bucketing), `ctx` (`live` flags), `sampled` (business without a bus, SLOs, incidents, `/status` and the alerting writes — sample generators), `persist` (snapshots the sample modules' alerting and incident state into SQLite after each write; `createCtx` restores it) |
| `contract.test.ts` | The mock invariants over HTTP, sample mode and live mode |
| `../Dockerfile` · `../targets.example.json` | Collector image (repo-root context); example health-target list |

## 8. Conventions & gotchas

- **The collector imports the dashboard's contract and sample data from source.** That is why it uses
  `moduleResolution: Bundler` + `paths` (`@/` → `dashboard/src`) and runs via `node --import tsx`; its own
  imports still carry `.js` extensions. Keep `api/mock/data.ts` free of browser-only APIs and
  `import.meta.env` — the collector executes it in Node.
- **A new endpoint needs a collector route** (`collector/src/routes.ts`) or `npm run dev` answers 404 for it;
  until its source exists, the route returns the dashboard's sample generator. `npm run dev:mocks` skips the collector.
- **The collector reads `NW_PORT`, not `PORT`** — tools (like the browser preview) export `PORT` for the dashboard.
- **`node:sqlite` needs Node ≥ 22.13** (the Docker images use Node 22). No native module to build.
- **Live series are never padded** with zeros: they start at the first measurement in the window, so
  they can be shorter than the sample data's (see docs/api.md).
- **Pages never import from `api/mock`.** They use `api/queries.ts`; only `endpoints.ts` knows mocks exist.
  If a page needs a field, add it to `types.ts`, the mock, and `docs/api.md` — together.
- **Never hard-code a colour in a component.** Use the tokens (`var(--c-nx)` etc.) or `lib/status.ts`.
  `--primary`/`--fv` are for text; `--c-*` are for marks and fills; `--solid` is for fills carrying white text.
- **Project colours are fixed:** NexusInfra = indigo (`--c-nx`), FinVault = emerald (`--c-fv`). Every list,
  legend and swatch that refers to a project uses them.
- **"Unknown" is not "zero".** A check without an answer is `latencyMs: null` and renders `timeout`;
  a missing measurement must never be drawn as 0.
- **A log entry's `id` must be stable** across polls and endpoints — deep links (`/logs?entry=…`) and the
  selected/unfolded line depend on it. The mock derives it from the line's content; the backend must use a stored id.
- **SLO maths runs in the dashboard, from raw check tallies** (`lib/slo.ts`). `unknown` checks are excluded from
  every SLO figure; `slow` counts as good (availability objective). A missing burn window never fires an alert.
  With `Slo.checkIntervalSeconds` the budget counts measured downtime (failed checks × interval) and a burn
  window needs half its expected checks — so a monitor added minutes ago never reads as 30 days of outage.
- **`/status` is public.** It sits outside `AppShell`, reads only `useStatusPage()`, and its types (`StatusPageData`)
  must never gain a host, address, port, target, node or internal id — `reliability.test.ts` checks the type and the
  response. Incidents show there only with `public: true`, under `publicTitle`, with public updates only.
- **A new endpoint is not done until the collector serves it.** Add it to `endpoints.ts` *and* to
  `collector/src/routes.ts` (at least via `views/sampled.ts`), plus the path to the read-endpoint list
  in `collector/src/contract.test.ts` — otherwise the page 404s with `VITE_USE_MOCKS=false`.
- **Mocks signal errors with `ApiError(status)`, never a bare `Error`.** The collector passes the status
  through; a bare `Error` becomes a 500 instead of the 404/409/400 that docs/api.md promises.
- **New mutable state in a mock module must join its snapshot** (`alertingState()` in `data.ts`,
  `incidentState()` in `reliability.ts`) — the collector persists exactly that snapshot, so anything
  left out is lost on restart. A sampled write route must go through `run(ctx, …)` so it is saved.
- **Rules are evaluated by `evaluateRule` from `dashboard/src/lib/rules.ts`, in the collector too.** Never
  re-implement the comparison or the for-duration there; give it readings (`alerting/readings.ts`). A new rule
  metric needs a reading source, or its rules silently have no targets.
- **An incident's subject says who opened it:** `service:<id>` (health checker), `source:<name>` (heartbeat
  tracker), `rule:<ruleId>:<target>` (rule evaluation). `alertTarget()` in `views/alerts.ts` is the one place that reads it.
- **Mock functions that validate against sample data take the real list as an optional argument**
  (`createMaintenance(input, known)`), so the collector can pass the monitored services.
- **A notification target is write-only.** It comes from `NW_*` variables (which win) or from
  `PUT /settings/channels/:id`, validated by `validateChannelConfig` in `lib/channels.ts` — Discord only at
  discord.com, Telegram without any URL, ntfy/SMTP never at a loopback, link-local or metadata address. It is
  never returned: `Channel.target` is masked, `PATCH /settings` keeps nothing of a channel but `enabled`.
  Any other endpoint that takes a URL for the collector to call needs the same host checks. Send every
  channel error through `send()`, which scrubs secrets.
- **`config.health.targets` is the one monitor list and changes at runtime** (monitors added from the dashboard
  are pushed into it). Read it each time; never copy it at start. A monitor's `source` is absent for
  `NW_HEALTH_TARGETS` and `dashboard` for added ones; only those can be removed.
- **A new public endpoint goes in `isPublic` (`auth.ts`)** — everything else needs a session once a password is
  set. `/status` must stay public; never make a write public.
- **Route handlers may be async** (`server.ts` awaits them); a rejected promise reaches the error handler.
- **Every timestamp in the contract is UTC ISO-8601;** formatting to local time happens only in `lib/format.ts`.
- **Disabled buttons mark unbuilt actions** (`title="Coming soon"`). Wire them through a mutation in
  `queries.ts`; never call `fetch` from a page.
- **Node 25 ships its own `localStorage` global** that shadows jsdom's and has no working methods —
  `test/setup.ts` installs an in-memory one. Don't remove it.
- **Any source configured = no sample data anywhere.** `live.logs` is true as soon as one source is set; every
  view then answers from the store, and a part without a source is empty/unknown. Sample data is only for a
  collector with no source at all (development). `contract.test.ts` checks the live API for sample-only names.
  In live mode the seeded silences, maintenance windows, incidents and example runbook links are dropped at
  start (`restoreState`); rules and escalation policies stay as editable defaults.
- **The Docker socket is read with GET only** (`sources/docker.ts`). The Engine API has no read-only mode, so
  never add a POST/DELETE there; the socket is mounted `:ro` and the collector joins its group via `group_add`.
- **The collector image carries all of `dashboard/src`** — it imports more of it over time; a hand-kept file list broke.
- **Not observed is `null`, never `[]` or `0`.** A bus-only collector cannot see the Billing Bridge's ledger:
  `TopUpRecord.status` and `credits` are `null` together, and `reconcile` then skips every credit rule.
  Business fields without a source are `null`/empty in live mode — never filled from sample data.
- **Business events keep a whitelist of fields** (`keptFields` in `sources/business.ts`). Adding a field means
  checking it is not free text or personal data; emails are masked before storing.
- **The backend reports top-up facts; the dashboard reconciles them** (`lib/reconcile.ts`). Never add a
  verdict field (`anomaly`, `ok`) to `TopUpRecord` — the rules would then live in two places. Judge with
  the response's `topUpTimeoutMs` and the query's `dataUpdatedAt`, not a constant or a fresh `Date.now()`.
- **No personal data on the Business page.** Ids only; a payer email arrives masked and goes through
  `maskEmail` again on display.
- **Intl's short month names differ per ICU build** (`Sep` vs `Sept`), so `formatWhen` uses a fixed list.
- **Nothing absolutely positioned inside a scrolling card unless the card is `position: relative`**
  (`.box` is). A `.sr-only` label that escapes its card makes the whole page scroll sideways on a phone.
- Keep the class names in `app.css` aligned with the design files so a design change maps 1:1.
- **Narrow screens (≤ 820px) get a different shell, not just CSS.** `AppShell` mounts *either* the sidebar
  or the mobile top/tab bars (`useIsNarrow`), so there is only one "Main navigation" landmark. jsdom has
  no `matchMedia`, so tests see the desktop shell unless they stub it (see `AppShell.test.tsx`).
- **New pages go in `components/layout/nav.ts`**, not in `Sidebar.tsx`: one entry shows up in the sidebar and
  the mobile "More" sheet. Only set `tab: true` if it replaces one of the four bottom tabs.
- **Tables (`.tbl` / `.tr`) turn into stacked cards on narrow screens** via CSS: the header row hides, the first
  cell becomes the card title, other cells flow into a grid. Put `data-label="Column"` on every cell whose
  value is not self-explanatory (numbers, ids, times) — it renders as the caption. No component needed.
- **Page-level overlays on mobile use `components/ui/Sheet`** (filters, details), never a hand-rolled fixed div.
  It portals to `body`, so `position: fixed` is not trapped by the blurred bars.
- **Safe areas:** the top bar, tab bar, sheets and `.main` padding use `env(safe-area-inset-*)`; anything new that
  is fixed to a screen edge must too.
- **The service worker never caches `/api`** and only runs in production builds. Bump `CACHE` in `sw.js` when the
  shell list changes.
- **Rule conditions are structured** (`metric`, `comparator`, `threshold`, `forSeconds`), never a free-text
  string. Render them with `formatCondition`; the editor's form state is a `RuleDraft` and only
  `validateDraft` turns it into an API body. The mock validates with the same functions and answers 422.
- **Open a dialog by mounting it, close it by unmounting** (`{open && <Dialog …/>}`) — focus return depends
  on it. Form dialogs pass `closeOnBackdrop={false}`. Use `ConfirmDialog` for anything destructive.
- **Don't mark a field touched on blur in a dialog:** StrictMode's dev remount moves focus away and back,
  which fires a blur before the user has typed. Validate on change and on submit.
- **Inside a column form, `.fld` has no flex-basis** — only `.frow > .fld` does; a basis in a column becomes a height.
- Every alerting mutation goes through `useAlertingMutation` in `queries.ts`, which invalidates both
  `alerts` and `nav` (resolving changes the sidebar badge).
