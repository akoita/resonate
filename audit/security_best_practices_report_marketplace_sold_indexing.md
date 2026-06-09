# Security Best Practices Report: Marketplace Sold-Event Indexing Fix

## Executive Summary

This branch fixes a marketplace regression where purchased stems were never
marked sold and never appeared in the buyer's library. Root causes addressed:
listing rows could be stamped with a client-supplied chainId that diverged
from the polling indexer's chain (orphaning Sold events), the indexer status
endpoint was unreachable due to NestJS route shadowing, and missed events
could never be replayed. The scoped review found no new Critical or High
findings introduced by this branch. One pre-existing Medium observation is
documented below with a recommended follow-up.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

**Pre-existing: unauthenticated indexer management endpoints.**
`POST /metadata/indexer/reset`, `POST /metadata/indexer/reindex-tx`, and
`GET /metadata/indexer/status` carry no auth guard. This predates this branch
(the routes and their lack of guards are unchanged in kind); this branch adds
an optional `force` flag to `reindex-tx`. Abuse impact is bounded:

- `reindex-tx` only processes logs from real on-chain transaction receipts
  fetched from the server-configured RPC; an attacker cannot inject synthetic
  events.
- The `contract.stem_sold` handler is now idempotent (purchase-exists
  pre-check), so forced replays cannot double-decrement listings or duplicate
  purchases. `StemPurchase`/`RoyaltyPayment` writes are keyed on
  transaction hash.
- `reset` can force a bounded re-scan (cursor rewind), which is a
  resource-consumption vector, not an integrity one.

Recommendation (follow-up issue): place the indexer management endpoints
behind the existing admin role guard (`AuthGuard` + `RolesGuard`), as done for
other admin surfaces in this controller.

## Low Findings

None.

## Scope Reviewed

- `backend/src/modules/contracts/indexer.service.ts`
- `backend/src/modules/contracts/contracts.service.ts`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/tests/metadata.controller.integration.spec.ts`

## Checks

- Hardcoded secret scan over the branch diff (no hits)
- Trust-boundary review of client-supplied input: `notify-listing` no longer
  trusts the request-body `chainId` for any persisted record — it is reduced
  to a logged sanity check, with the server-side indexer chain used instead
  (net security improvement)
- Replay/idempotency review of event handlers under the new `force` path
- Route-shadowing review of the controller after reordering indexer routes
- Backend type-check (`tsc --noEmit`) and focused Testcontainers integration
  suites (`metadata.controller.integration.spec.ts`,
  `contracts.integration.spec.ts`) — 26/26 passing

No new secret handling, raw SQL, deserialization of untrusted payloads, or
external network destinations are introduced. The only new network call reuse
is `indexTransaction` fetching receipts from already-configured chain RPCs.
