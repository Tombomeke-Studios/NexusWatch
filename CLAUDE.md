# NexusWatch — CLAUDE.md

Monitoring dashboard for the tombomeke-studio platforms: one place for heartbeats, logs, metrics and
alerts of **NexusInfra** (Docker server management) and **FinVault** (banking platform), plus the
business link between them (FinVault top-ups paying for NexusInfra capacity).
Currently: a React + TypeScript dashboard (Vite) running on built-in sample data behind a typed API layer.
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

**What exists:** every page from the design, routed, wired to React Query hooks, served by sample data
(`VITE_USE_MOCKS=true`). **What does not:** any backend. `dashboard/src/api/endpoints.ts` already
names the HTTP paths the backend must serve; [docs/api.md](docs/api.md) is the contract.

**Relation to the other projects.** NexusWatch is a *read-only observer*. It never changes NexusInfra
or FinVault state and never shares their databases. Planned data sources (not built): NexusInfra's
Control Room `/status` + `/uptime`, every service's `/health` and Prometheus `/metrics`, the
`monitoring.heartbeat.#` routing keys on the `finvault.events` exchange, and FinVault's gateway events.
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
- **Pure logic must be tested**: everything in `lib/`, `api/client.ts`, and the mock contract (`api/mock/data.test.ts`).
- **Pages**: `App.test.tsx` renders every route and checks its `<h1>`. A new route adds a row there.
- **The mock data is a stand-in for the backend** — `data.test.ts` guards its invariants (counts add up,
  a down service has a `null` latency, filters filter). When the real API arrives, the same invariants
  become contract tests against it.
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
| Dev server (http://localhost:5173) | `npm run dev` |
| Production build | `npm run build` |
| Tests | `npm test` |
| Lint | `npm run lint` |
| Use a real backend | set `VITE_USE_MOCKS=false` in `dashboard/.env`; `/api` is proxied to `NW_API_TARGET` (default `http://localhost:8080`) |

## 7. Codebase map — where is what

### Root
| Path | Contents |
|---|---|
| `package.json` | npm workspaces (`dashboard`; room for `collector`/`agent` later) + root scripts |
| `eslint.config.js` | Flat ESLint config (typescript-eslint + react-hooks) for all workspaces |
| `.claude/launch.json` | Dev-server entry for the Claude browser preview |
| `docs/` | `architecture.md` (data flow, planned services) · `api.md` (HTTP contract) |

### dashboard/src
| Path | Contents |
|---|---|
| `main.tsx` · `App.tsx` | Providers (React Query, theme) + the route table (`routeTable`, exported for tests) |
| `routes.ts` | **Every URL in the app.** Build links from here, never from string literals. `logsFor(q, entryId)` deep-links into Logs: unfiltered search on `q`, that line selected |
| `theme.tsx` | `ThemeProvider`/`useTheme` — dark (default) / light / system, stored in localStorage, sets `data-theme` on `<html>`; pure `resolveTheme` |
| `styles/tokens.css` | Design tokens from the artifact, both themes. **The only place colours are defined** |
| `styles/app.css` | Component classes, named as in the design (`.box`, `.kpi`, `.seg`, `.pill`, `.tr`, …) |
| `api/types.ts` | The API contract as the dashboard consumes it. Mock and real backend both produce these shapes |
| `api/client.ts` | `request()` — the one fetch wrapper (JSON, `ApiError` with status, 0 = no answer) + `buildUrl` |
| `api/endpoints.ts` | `api.*` — every backend call; each picks mock or HTTP from `config.useMocks` |
| `api/queries.ts` | React Query hooks (`useOverview`, `useLogs`, …) + mutations. **Pages read data only through these.** Live views poll every `VITE_REFRESH_MS` |
| `api/mock/data.ts` | Sample data ported from the design, seeded so it is stable; timestamps relative to now; in-memory state for toggles/acks |
| `api/mock/reliability.ts` | Sample SLO tallies, the in-memory incident store (create / update / resolve; Heartbeats lists the same incidents) and the public status page. Reads `services` from `data.ts` only inside functions — the two modules import each other |
| `lib/series.ts` | Pure chart maths: `rng`, `walk`, `linePath`, `areaPath`, `stats`, `barHeights` |
| `lib/format.ts` | Display formatting: euros, percent, latency (`timeout` for null), durations, bytes, `formatClock`, `formatWhen` |
| `lib/status.ts` | Status/level/severity/project → colour, pill class and label maps |
| `lib/ranges.ts` | Time-range options + relative axis labels |
| `lib/slo.ts` | SLO maths: attainment, error budget, burn rate, time to exhaustion, burn-down, multi-window burn alerts (`BURN_RULES`), `summarizeSlo` |
| `lib/publicStatus.ts` | Public status roll-up: health → public status, worst of a group, overall banner |
| `lib/config.ts` | Typed Vite env (`useMocks`, `apiBase`, `refreshMs`) |
| `components/layout/` | `AppShell` (background + sidebar + outlet), `Sidebar` (nav, alert badge, host card), `Logo` |
| `components/ui/Card.tsx` | `Card` + `CardHeader` (title, hint, right-side content or "→" link) |
| `components/ui/primitives.tsx` | `Pill`, `StatusDot`, `Swatch`, `Segmented`, `Switch`, `Kpi`, `PageHeader` |
| `components/ui/charts.tsx` | `LineChart`, `Sparkline`, `BarChart`, `StatusStrip`, `Meter`, `StackBar`, `Legend`, `XAxis` — plain SVG/CSS, no chart library |
| `components/ui/QueryState.tsx` | Loading skeleton / error (404 → "Nothing here") / `children(data)` for any query |
| `components/ui/Icon.tsx` | The design's stroke icons by name |
| `components/NodeCard.tsx` | Node with CPU/memory/disk meters (Heartbeats + NexusInfra) |
| `components/SloCard.tsx` | A service's SLO in one small card (Service detail), linking to its burn-down on `/slo?service=…` |
| `components/LogDocument.tsx` | A log line's full structured document as JSON, with a link to its service or to the line in the log stream. Used by Logs (selected line) and Service detail (click a line to unfold it) |
| `pages/` | `Overview`, `Metrics`, `Logs`, `Heartbeats`, `Alerts`, `ServiceDetail` (`/services/:serviceId`), `projects/NexusInfra`, `projects/FinVault`, `Settings`, `Slo` (`/slo`), `Incidents` + `IncidentDetail` (`/incidents/:incidentId`), `StatusPage` (`/status`, outside the shell), `NotFound` |
| `styles/reliability.css` | Classes for the SLO, incident and status pages (forms, lifecycle steps, update timeline, `.sp` status layout). Imported by those pages, not by `main.tsx` |
| `test/setup.ts` | jest-dom + in-memory localStorage (see gotchas) |

## 8. Conventions & gotchas

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
- **`/status` is public.** It sits outside `AppShell`, reads only `useStatusPage()`, and its types (`StatusPageData`)
  must never gain a host, address, port, target, node or internal id — `reliability.test.ts` checks the type and the
  response. Incidents show there only with `public: true`, under `publicTitle`, with public updates only.
- **Every timestamp in the contract is UTC ISO-8601;** formatting to local time happens only in `lib/format.ts`.
- **Disabled buttons mark unbuilt actions** (`title="Coming soon"`). Wire them through a mutation in
  `queries.ts`; never call `fetch` from a page.
- **Node 25 ships its own `localStorage` global** that shadows jsdom's and has no working methods —
  `test/setup.ts` installs an in-memory one. Don't remove it.
- **Intl's short month names differ per ICU build** (`Sep` vs `Sept`), so `formatWhen` uses a fixed list.
- **Nothing absolutely positioned inside a scrolling card unless the card is `position: relative`**
  (`.box` is). A `.sr-only` label that escapes its card makes the whole page scroll sideways on a phone.
- Keep the class names in `app.css` aligned with the design files so a design change maps 1:1.
