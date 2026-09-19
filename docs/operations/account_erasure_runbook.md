---
title: "Account Erasure Runbook"
status: living
owner: "@akoita"
issue: 1797
---

# Account Erasure Runbook

What to do when a person's account erasure is due, has failed, or needs running
by hand. The privacy policy's "When you delete" section depends on this
procedure existing.

**An erasure is irreversible.** It rotates the account id, deletes credentials
and preferences, scrubs what the person wrote, and detaches their artist
profile. There is no undo and no backup restore path that would not also undo
everybody else's data. Read the whole of this page before running anything.

## How a request reaches this point

1. A person requests closure in Settings, behind a signature over a message that
   names the deletion (#1771 slice 3b).
2. An `AccountClosureRequest` is created, `pending`, due **30 days** later.
3. **Signing in cancels it.** This is the only protection a real owner has
   against a request somebody else made with a stolen token, because there is no
   outbound email channel (#1777) and nobody is told.
4. When the window elapses the erasure runs.

## Running the due erasures

### Scheduled (normal)

A scheduled job runs `node dist/scripts/run_due_erasures.js` against the backend
image. **Exit code 0 means every due erasure completed** — including the common
case where none were due. Exit 1 means at least one failed.

It deliberately does not run over an HTTP endpoint. Every route on
`MaintenanceController` requires `AuthGuard("jwt")` + `RolesGuard` +
`@Roles("admin")`, and a scheduled caller cannot mint an application JWT with an
allowlisted admin address, so the script calls the service in-process instead.

**How that job is defined, invoked and configured is deployment configuration
and lives in the infrastructure repository, not here.**

### By hand

An operator holding an admin token can drive the same work over HTTP:

```bash
curl -X POST "<backend-base-url>/admin/erasure/run-due" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 1}'
```

Environment URLs and how to obtain an admin token are in the infrastructure
repository.

Use `limit` when working through a backlog deliberately — one at a time is the
right instinct the first time this is ever run against real data.

## Before the first real run

- [ ] **`ANALYTICS_ACTOR_ID_SALT` is set** (#1796). While unset, actor ids
      derive from `JWT_SECRET`. If that secret has ever been rotated, some
      historical analytics are already unreachable and the erasure will report
      success having missed them.
- [ ] The person is genuinely due — check `dueAt` and that `status` is still
      `pending`, not `cancelled`.
- [ ] Take the usual database snapshot. It will not let you undo one person's
      erasure without undoing everyone else's writes, but it is the only
      artifact that makes a post-mortem possible.

## When a run fails

A failure is durable before it is visible: `runOneDueErasure` writes the message
onto `AccountClosureRequest.failureMessage`. A temporary warehouse failure
leaves the request `pending`, so it remains cancellable on sign-in and the next
scheduled run retries it. Non-retryable failures settle the request as
`failed` for operator review.

```sql
SELECT id, "userId", status, "dueAt", "failedAt", "failureMessage"
FROM "AccountClosureRequest"
WHERE status IN ('pending', 'failed')
  AND "failureMessage" IS NOT NULL
ORDER BY "dueAt";
```

**A partial erasure is not possible in Postgres.** Everything except the
analytics step runs in one transaction, so the account either erased or did not.

**The analytics step is outside that transaction**, because it calls out to
BigQuery. Warehouse mutation runs first under the loader's exclusive lock. If
BigQuery refuses the mutation — including while recently streamed rows remain
buffered — Postgres stays intact, the account stays intact, and the pending
request keeps the event ids required for a later retry.

Re-running against an account that already erased returns `already_erased` and
writes nothing.

## What an erasure does not remove

Say this plainly if a person asks, and keep it consistent with the privacy
policy and the export's `notIncluded` section:

- **On-chain records.** Public, permanent, outside anyone's control. Our copies
  of financial records are retained under legal obligation, but the link from
  that address back to an account is severed — the `Wallet` row,
  `PasskeyIdentity` and `SignupFaucetAttempt` are deleted.
- **IPFS content.** We stop serving our copy; other nodes are not ours.
- **Audit-preserved analytics**, retained so a deletion stays provable.
- **An artist's catalogue.** Releases are withdrawn from streaming (#1793), not
  deleted, because other people bought from them. The profile detaches from the
  person.
- **Governance lineage rows written before #1795** still contain raw wallet
  addresses and want a backfill. New rows are pseudonymized.

## Related

- Feature: [Personal Data Rights](../features/personal_data_rights.md)
- Inventory: [Personal data inventory](../engineering/personal-data-inventory.md)
- Open: [#1797](https://github.com/akoita/resonate/issues/1797) (scheduling),
  [#1798](https://github.com/akoita/resonate/issues/1798) (step-up fallback),
  [#1796](https://github.com/akoita/resonate/issues/1796) (salt),
  [#1789](https://github.com/akoita/resonate/issues/1789) (retention)
