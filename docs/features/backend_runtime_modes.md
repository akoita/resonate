---
title: "Backend runtime modes"
status: implemented
owner: "@akoita"
---

# Backend runtime modes

**Status:** implemented (application half). Running the worker as its own
service and letting the API scale to zero is deployment work, tracked in
`resonate-iac#322`.
**Audience:** backend developers, operators
**Issue:** [#1608](https://github.com/akoita/resonate/issues/1608)
**Revenue line:** vision-neutral infrastructure/quality (it removes an always-on
cost; it changes no fee, payout or price).

## What it is

One backend image, one codebase, one entrypoint (`dist/main.js`).
`BACKEND_RUNTIME_MODE` picks the role of the process:

| Value | HTTP API | Background loops | Use |
| --- | --- | --- | --- |
| `combined` (default, also used for a missing or unrecognised value) | yes | yes | Local development and every deployment before the split. Identical to the behaviour before the flag existed. |
| `api` | yes | **none** | Request-serving instances that may scale to zero. |
| `worker` | `/health` only (every other path answers `404`) | yes | The always-on process that follows the chain and runs the sweeps. |

An unrecognised value falls back to `combined` and logs one warning
(`[RuntimeMode] Unknown BACKEND_RUNTIME_MODE ...`); a typo must not take the API
down. The variable is read in one place, `backend/src/config/runtime_mode.ts`.

## Why the worker boots the whole app

`EventBus` is an in-process RxJS subject. The contract indexer publishes
`contract.*` events and `ContractsService` persists them; the escrow indexer
publishes `shows.*` events; stem results publish `stems.*`/`catalog.*` events
that the realtime gateway, analytics bridge, notification and embedding
subscribers consume. Those subscribers must live in the same process as the
publisher, so the worker boots the same `AppModule` (no second module graph to
keep in step). Event handlers register in **every** mode; only the loops that
produce work are gated. Socket.IO broadcasts from the worker reach clients
connected to API instances through the Redis adapter that `main.ts` installs in
every mode. The worker answers `/health` only; a middleware returns `404` for
everything else before any route, guard or controller runs. The worker must not
be routed to by clients (websocket upgrades do not pass through that middleware),
which is a deployment concern.

## Loop inventory and classification

Every row is gated through `shouldRunBackgroundLoop(id)` (or, for BullMQ
processors, `backgroundLoopProviders(id, [...])`) so the decision lives in one
place. "Gate" is the id in `BACKGROUND_LOOPS`.

| Loop (source) | Gate | Class | Runs in `api`? | Why |
| --- | --- | --- | --- | --- |
| Contract indexer poll (`contracts/indexer.service.ts`, behind `ENABLE_CONTRACT_INDEXER`) | `contractIndexer` | a: indexer | no | Follows the chain continuously; its cursor must advance whether or not anyone is calling the API. |
| Shows escrow indexer poll (`shows/shows-escrow-indexer.service.ts`, behind `ENABLE_SHOWS_ESCROW_INDEXER`) | `showsEscrowIndexer` | a: indexer | no | Same. Its database-clock lease and fencing epoch (#1567) are unchanged and still prevent double indexing if two processes briefly overlap. |
| Startup listing, lifecycle and orphan-listing reconcilers and the pending sale-split retry (`contracts/contracts.service.ts`, #2172) | `contractsStartupReconcile` | a: reconciler | no | Repairs persisted state from chain truth. The event-driven split finalisation on a `Sold` event is not gated: it follows the indexer. |
| Stem processing watchdog (`ingestion/stem-watchdog.service.ts`) | `stemWatchdog` | a: reconciler | no | Detects stuck processing with no request in flight. |
| x402 `refund_due` watchdog (`punchline/x402-refund-watchdog.service.ts`) | `x402RefundWatchdog` | a: reconciler | no | Alerts on stale refunds with no request in flight. |
| ERC-8004 reputation scheduler (`agents/agent_reputation_scheduler.service.ts`) | `agentReputationScheduler` | a: reconciler | no | Periodic attestation sweep. |
| Local discovery popularity refresh timer (`catalog/discovery-popularity.service.ts`) | `discoveryPopularityRefresh` | a: refresher | no | Recomputes a read model on a timer. |
| Pub/Sub stem-results subscription (`ingestion/stem-result.subscriber.ts`) | `stemResultSubscriber` | a: consumer | no | A pull subscription needs a process that is always running; on a scale-to-zero API, results would sit unacknowledged until the next request woke it. Progress still reaches live sockets through the Redis Socket.IO adapter. |
| BullMQ processors: `stems`, `generation` and remix generation (`ingestion/stems.processor.ts`, `generation/generation.processor.ts`, `remix/remix-generation.processor.ts`) | `stemsQueueProcessor`, `generationQueueProcessor`, `remixGenerationQueueProcessor` | a: consumer | no (not even registered) | Queue consumers must run without a request. The queues stay registered in every mode, so `api` still enqueues. |
| Boot-time self-healing in `main.ts` (indexer cursor fast-forward, relative-URI normalisation) | `startupSelfHealing` | a: reconciler | no | Writes to the indexer cursor and scans tables; skipping it also shortens API cold starts. |
| `EventBus` subscribers (catalog, contracts event handlers, notifications, notices, analytics bridge, realtime gateway, track embedding and descriptors, crate watch) | none | b: in-process reaction | yes | Not loops: they react to events published in the same process (request paths, or the worker's own indexer and consumers). They must exist wherever a publisher does. |
| `StemPubSubPublisher` topic setup, `RemixWorkerPrewarmService`, the Lyria realtime session service, MCP service, remix render worker threads | none | b: request-coupled | yes | Started by, or bound to, a request or a live socket session; no free-running loop. |
| `IndexerService` / `ShowsEscrowIndexerService` as providers | none | b: request-coupled | yes (constructed, not started) | Request paths use them on demand (for example a crate transaction lookup, a Shows reconcile); only their poll loops are gated. |

Nothing in this codebase runs on `@Cron`; the maintenance and erasure routes are
called by an external scheduler.

## Cut-over (application terms)

The deployment steps are in `resonate-iac#322`. What the application requires:

1. The worker uses the same image and the same configuration as the API (database,
   Redis, RPC, contract addresses, `ENABLE_*` flags, storage and Pub/Sub settings),
   plus `BACKEND_RUNTIME_MODE=worker`. It must be reachable by the platform's
   health probe on `/health` and must keep at least one instance running.
2. Start the worker **before** switching the API to `api`. Until the API restarts
   in `api` mode it is still running the loops itself.
3. While both run, the Shows escrow indexer's lease keeps one owner per
   chain/address target, so no event is applied twice. The contract indexer has no
   lease; its per-log idempotency (`ContractEvent` is unique on transaction hash and
   log index) makes an overlap redundant work, not wrong data.
4. Then restart the API with `BACKEND_RUNTIME_MODE=api`. Nothing that needs a
   background loop should be expected from it.
5. Rollback is setting the variable back to `combined` (or removing it).

Each migration run (`prisma migrate deploy` in the image's default command) is
safe to run from both services at once; Prisma serialises migrations with an
advisory lock.

## Tests

- `backend/src/tests/runtime_mode.spec.ts`: mode resolution (default, valid,
  case, invalid -> `combined` with one warning), the gate, provider gating and the
  worker health-only middleware.
- `backend/src/tests/runtime_mode_loops.spec.ts`: each real `onModuleInit` starts
  nothing in `api` and starts its work in `worker`, `combined` and unset; the three
  queue processors are providers only where loops run.
- `backend/src/tests/runtime_mode.integration.spec.ts`: the real `AppModule`
  booted in each mode (no indexer interval and no processor in `api`; both in
  `worker`, which answers `404` outside `/health`; today's behaviour in
  `combined`).
