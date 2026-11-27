# NexusWatch

Monitoring dashboard for NexusInfra and FinVault: heartbeats, logs, metrics, alerts and the
business flow between the two platforms, in one place.

> **Status:** concept, not yet approved. The dashboard talks to the `collector` backend, which serves
> real data from every source you configure and built-in sample data for everything else.
> See [TODO.md](TODO.md).

## Run it

Requires Node.js 22.13+ (the collector uses Node's built-in SQLite).

```bash
npm install
npm run dev
```

Open http://localhost:5173. This starts the collector on http://localhost:8080 and the dashboard
in front of it. With no configuration every endpoint answers with sample data; copy `.env.example`
to `.env` and set the `NW_*` variables to watch a real NexusInfra / FinVault stack.
`npm run dev:mocks` runs the dashboard alone on its built-in sample data.

With Docker: `docker compose up --build`, then http://localhost:8088.

**Releases.** Pushing a `v*` tag (`git tag v0.2.0 && git push origin v0.2.0`) runs
[`.github/workflows/release.yml`](.github/workflows/release.yml): build, lint and test, then the images
`ghcr.io/tombomeke-studios/nexuswatch/collector:<version>` and `…/dashboard:<version>` (plus `:latest`),
then a GitHub release with generated notes.

## Scripts (repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Collector + dashboard with hot reload |
| `npm run dev:mocks` | Dashboard alone on sample data |
| `npm run dev:collector` | Collector alone |
| `npm run build` | Typecheck + production build into `dashboard/dist`, collector typecheck |
| `npm test` | Unit, page and contract tests (Vitest, both workspaces) |
| `npm run lint` | ESLint over the whole repo |

## Configuration

### Collector

`.env` in the repo root (copy from [`.env.example`](.env.example)). The variables that point it at a
real stack:

| Variable | Example | Turns on |
|---|---|---|
| `NW_HEALTH_TARGETS` / `NW_HEALTH_TARGETS_FILE` | see `collector/targets.example.json` | Heartbeat checker for every `/health` |
| `NW_CONTROL_ROOM_URL` | `http://localhost:9000` | NexusInfra Control Room `/status` + `/uptime` (nodes, heartbeat sources) |
| `NW_METRICS_TARGETS` | `orchestrator=http://localhost:9200/metrics,…` | Prometheus scrape (requests, 5xx, p95, queues) |
| `NW_METRICS_TOKEN` | NexusInfra's `METRICS_TOKEN` | Bearer token for protected `/metrics` |
| `NW_RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | Heartbeats on `finvault.events` (node CPU / memory / disk), top-ups, payments, billing events |
| `NW_DOCKER_SOCKET` | `/var/run/docker.sock` | Every container on this host: top consumers, NexusInfra containers, memory, disk IO, network |
| `NW_HOST_NAME` / `NW_HOST_ADDRESS` | `home-server`, `192.168.0.117` | The host card (in Docker the collector only sees its own container) |
| `FINVAULT_MESSAGE_KEY` | the key both platforms share | Reading encrypted payloads |
| `NW_DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/…` | Notifications to Discord |
| `NW_TELEGRAM_BOT_TOKEN` + `NW_TELEGRAM_CHAT_ID` | `123456:ABC-DEF`, `-100…` | Notifications to Telegram |
| `NW_NTFY_URL` (+ `NW_NTFY_TOKEN`) | `https://ntfy.sh/my-topic` | Push notifications through ntfy |
| `NW_SMTP_URL` + `NW_EMAIL_FROM` + `NW_EMAIL_TO` | `smtp://user:pass@host:587` | Notifications by email |

**Once any source is set, nothing is sample data:** a part without a source answers empty or unknown.
Without any source, every endpoint serves the built-in sample data (for development).

Also `NW_PORT` (8080), `NW_DB_PATH`, intervals, timeouts and thresholds, all listed in `.env.example`.
`GET http://localhost:8080/health` shows which parts are live and each source's last error.

**Login.** Set `NW_DASHBOARD_PASSWORD` (8+ characters) to require a password for the dashboard and its
API; `/status` and `/health` stay public. Without it, anyone who reaches the port can change settings —
Settings says so.

**Notifications** are set up in Settings → Notifications: "Set up" per channel (Discord webhook,
Telegram bot token + chat id, ntfy server/topic, SMTP), then "Send test". What you enter is stored on the
collector and never shown again, only masked. A `NW_*` variable for a channel wins over Settings. An incident notifies once when it opens and once when it closes.

### Dashboard

`dashboard/.env` (copy from `dashboard/.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCKS` | `true` (`npm run dev` sets `false`) | Serve sample data instead of calling the API |
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
| `/alerts` | Active alerts (acknowledge/resolve with a note, mute, escalation steps), rule editor with live validation and "test against current data", silences, maintenance windows, escalation policies, filterable history |
| `/services/:id` | Service detail: outage banner, response time, checks, dependencies, logs, timeline |
| `/projects/nexusinfra` | Nodes, containers, platform components, payments |
| `/projects/finvault` | Top-up funnel, services, queues, transactions, security |
| `/business` | Money flow FinVault → NexusInfra: top-up reconciliation and anomalies, credit and standing, suspensions, revenue per plan, event bus health |
| `/settings` | Agents, notification channels and routing, retention, storage, theme |
| `/slo` | SLOs and error budgets: attainment, budget left, burn rate 1h/6h/24h, multi-window burn alerts, burn-down |
| `/incidents` | Open and resolved incidents; declare a new one |
| `/incidents/:id` | Lifecycle, update timeline, affected services, post update, resolve, postmortem |
| `/status` | Public status page (no sidebar, shareable): overall banner, 90-day uptime per component, incidents, maintenance |

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
