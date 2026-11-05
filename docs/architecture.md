# Architecture

## As built

```
Browser ── React pages ── api/queries.ts (React Query, polling)
                              │
                         api/endpoints.ts ── VITE_USE_MOCKS=true  → api/mock/data.ts
                                         └── VITE_USE_MOCKS=false → api/client.ts → HTTP /api/* → (backend, not built)
```

- **One seam.** Pages only use the hooks in `queries.ts`. Swapping sample data for a real backend is a
  config switch, not a page change. The response shapes are fixed in `api/types.ts` and described in
  [api.md](api.md).
- **Polling, not push.** Live views refetch every `VITE_REFRESH_MS` (10 s); the log tail every 2 s.
  Server-sent events can replace polling later without changing the pages.
- **No chart library.** Charts are plain SVG built from pure functions in `lib/series.ts`, which keeps
  the bundle small and the look identical to the design.

## Planned (not built)

```
NexusInfra services ──/health, /metrics──┐
Control Room ──/status, /uptime──────────┤
finvault.events exchange ──monitoring.heartbeat.#, events.*──┤──> collector ──> storage ──> /api ──> dashboard
nexuswatch/agent on each node ──heartbeats, metrics, logs────┘
```

- **Collector**: one service that gathers, stores (with per-kind retention: logs / metrics / heartbeats)
  and serves the `/api` contract. Node/TypeScript by default, to share tooling with NexusInfra.
- **Read-only.** NexusWatch observes; it never changes state in NexusInfra or FinVault and never reads
  their databases directly.
- **Event bus rules** when consuming `finvault.events`: read payloads with NexusInfra's `readPayload()`
  (they may be encrypted), bind both `bank.payment.*` and `events.<type>` keys for FinVault events,
  and never rename the exchange or touch the encryption constants.
- **Agent**: the `nexuswatch/agent` container shown in Settings, authenticated with a per-node token.
- **Business view** (`/business`): the collector would read the Billing Bridge's top-up ledger, credit
  ledger, standing and suspensions (hosted edition only), watch `payment.request` and FinVault's
  `payment.confirmed`/`payment.failed` on the exchange (both key spellings), and ask the broker for queue
  depths, consumers and `finvault.events.dlq`. It reports what each side recorded; the dashboard
  reconciles (`lib/reconcile.ts`). Payer emails are masked before they leave the collector.

Open decisions: authentication for the dashboard, storage engine, whether the collector reuses
NexusInfra's Control Room data or measures independently.
