# NexusWatch

Monitoring dashboard for NexusInfra and FinVault: heartbeats, logs, metrics, alerts and the
business flow between the two platforms, in one place.

> **Status:** concept, not yet approved. The dashboard runs entirely on built-in sample data;
> there is no backend yet. See [TODO.md](TODO.md).

## Run it

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Scripts (repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Dashboard dev server with hot reload |
| `npm run build` | Typecheck + production build into `dashboard/dist` |
| `npm test` | Unit and page tests (Vitest) |
| `npm run lint` | ESLint over the whole repo |

## Configuration

`dashboard/.env` (copy from `dashboard/.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | Serve sample data instead of calling the API |
| `VITE_API_BASE` | `/api` | Base URL of the NexusWatch API |
| `VITE_REFRESH_MS` | `10000` | Polling interval for live views |
| `NW_API_TARGET` (shell env) | `http://localhost:8080` | Where the dev server proxies `/api` |

## Pages

| Route | Page |
|---|---|
| `/` | Overview: KPIs, heartbeats, recent events, CPU, requests, business flow |
| `/heartbeats` | Nodes, 60-day monitors, incidents |
| `/logs` | Search, filters, histogram, facets, log lines + document |
| `/metrics` | CPU / memory / disk / network / queues with statistics and top consumers |
| `/alerts` | Active alerts, rules, history |
| `/services/:id` | Service detail: outage banner, response time, checks, dependencies, logs, timeline |
| `/projects/nexusinfra` | Nodes, containers, platform components, payments |
| `/projects/finvault` | Top-up funnel, services, queues, transactions, security |
| `/settings` | Agents, notification channels and routing, retention, storage, theme |

## Phones and tablets

Below 820px the sidebar becomes a top bar (page title, open-alert badge) and a bottom tab bar
(Overview, Heartbeats, Logs, Alerts, More); "More" opens a sheet with the remaining pages.
Tables reflow into stacked cards and Logs moves its facets into a filter sheet.

The dashboard is an installable PWA: open it in a mobile browser and use "Add to Home Screen" /
"Install app". The production build registers a service worker (`dashboard/public/sw.js`) that
caches only the app shell so it opens offline; `/api` is never cached, so data is always live.
Icons live in `dashboard/public/` and are regenerated from `icon.svg` / `icon-maskable.svg` with
`dashboard/scripts/render-icons.sh` (headless Chrome).

Docs: [architecture](docs/architecture.md) · [API contract](docs/api.md) · contributor rules in [CLAUDE.md](CLAUDE.md).
