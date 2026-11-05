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

Docs: [architecture](docs/architecture.md) · [API contract](docs/api.md) · contributor rules in [CLAUDE.md](CLAUDE.md).
