---
title: "Analytics Retention Runbook"
status: living
owner: "@akoita"
issue: 1789
---

# Analytics Retention Runbook

How analytics events age out, and what to do before the first real run.

Retention removes or redacts events past their privacy-tier window and
propagates that to the warehouse. It is destructive and, on its first execution
against a ledger that has never been pruned, it is the largest single governance
action this system takes.

## What a run does

For each privacy tier, events older than the window are either **deleted** or —
for the audit-preserved families (commerce, payment, rights, license) —
**redacted in place**, with a lineage row written per event. The same rows are
then removed or rebuilt in the warehouse and the affected daily views are
recomputed from the facts that survive.

The windows come from `ANALYTICS_RETENTION_*` settings and default to 90 days
sensitive, 395 personal, 730 pseudonymous.

## Size it before you run it

```bash
node dist/scripts/run_retention_cleanup.js --dry-run
```

Counts what would expire per tier and changes nothing — no deletions, no
redactions, no lineage. It is a separate read-only path rather than a flag
threaded through the destructive code, precisely so that sizing a run does not
depend on the destructive code honouring a boolean.

**Do this before the first scheduled run.** Against an unpruned ledger the real
run sends one warehouse call per tier containing every expired event id.

## Running it

```bash
node dist/scripts/run_retention_cleanup.js
```

**Exit 0** means the run completed, including the ordinary case where nothing
had expired. **Exit 1** means Postgres was cleared but the warehouse half did
not complete.

That distinction is the point of the job. A run that clears Postgres while the
warehouse refuses leaves the two stores disagreeing, and **the next run cannot
repair it** — retention derives its event ids from the Postgres rows, so once a
source row is gone there is no handle left to erase its warehouse copy. Treat
exit 1 as needing a person, not a retry.

An operator holding an admin token can drive the same work over HTTP at
`POST /admin/retention/cleanup`; the response carries the same status and the
per-tier warehouse outcomes.

How the scheduled job is defined, invoked and configured is deployment
configuration and lives in the infrastructure repository.

## Why it is a script rather than a scheduled HTTP call

Every route on `MaintenanceController` requires `AuthGuard("jwt")` +
`RolesGuard` + `@Roles("admin")`, and a scheduled caller cannot mint an
application JWT carrying an allowlisted admin address. The endpoint was never
reachable from a schedule — that is the mechanical reason retention went
unscheduled, rather than an oversight in wiring. The script calls the service
in-process, so no request crosses an authentication boundary.

## Before the first real run

- [ ] `--dry-run` first, and read the per-tier counts.
- [ ] Take a database snapshot. It will not let you undo one tier's expiry
      without undoing everything else, but it makes a post-mortem possible.
- [ ] Confirm the warehouse settings are right for the environment. A run with
      the warehouse misconfigured clears Postgres and reports exit 1, and the
      stranded rows cannot be reached afterwards.
- [ ] Do not schedule it the same day as anything else that touches analytics.

## Related

- Policy: [Analytics Consent And Retention Policy](../features/analytics_consent_retention_policy.md)
- Erasure, which shares the propagation path:
  [Account Erasure Runbook](account_erasure_runbook.md)
