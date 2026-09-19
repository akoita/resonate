---
title: "Governance Validation Harness"
status: living
owner: "@akoita"
issue: 1789
---

# Governance Validation Harness

How to prove, in a non-production environment, that analytics retention and
account erasure actually do what the policy says — and to see a job execution go
red when they do not.

> **This harness writes fake data.** Fake analytics events, two fake accounts, a
> fake wallet address and a fake private key. **It must never run against
> production.** It refuses to, in three independent ways (below), but the first
> line of defence is that the job which sets its opt-in variable only exists in
> non-production.

## Why it exists

Retention and erasure are both scheduled, both report success, and until now
neither had ever been observed doing anything.

The retention dry run in staging returned `0 expired` in every tier. That proves
the plumbing — the job starts, the database answers, the policy is read — and
proves nothing about whether an expiry is correct. It cannot: the windows are
90, 395 and 730 days, and no data in staging is older than the shortest of them.
Waiting is not an option, and neither is a green job that has never done any
work.

So the harness **backdates `occurredAt`**. A fixture written today with an
`occurredAt` 760 days in the past is expired under the 730-day pseudonymous
window right now. All three windows become observable in a single job execution.

The most important fixtures are the **control rows**: one inside each window
that must still be there afterwards. Every "the expired row is gone" expectation
would also be satisfied by a run that deleted the entire table. Only the control
rows can tell a retention policy from a truncate.

## The three refusals

| Refusal | What triggers it |
| --- | --- |
| Not opted in | `GOVERNANCE_VALIDATION_ENABLED` is anything other than exactly `true` |
| Unlabelled environment | none of `RESONATE_ENVIRONMENT_ID`, `DEPLOY_ENV`, `APP_ENV` is set |
| Looks like production | any of those labels, or `DATABASE_URL`, contains `prod` / `production` / `prd` / `live` as a word |

All three exit `1` before any connection is opened.

**`NODE_ENV` is deliberately not consulted.** `backend/Dockerfile` contains
`ENV NODE_ENV=production`, so every deployed environment — staging included —
reports `production` there. Using it as the production signal would make the
harness refuse to run in the only place it is meant to run, and treating its
absence as safety would be worse. `RESONATE_ENVIRONMENT_ID` is the variable this
system actually uses to name a deployment; `GET /health` returns it.

The `DATABASE_URL` scan strips credentials first, so a password containing
`prod` neither blocks a staging run nor gets quoted into an error message.

## Every row is prefixed, and cleanup only deletes prefixed rows

Everything the harness writes is named `govval_<runId>_…`:

- `govval_<runId>_ret_…` — the retention fixtures
- `govval_<runId>_era_…` — the erasure fixtures

Cleanup filters on `startsWith(prefix)` and on a user-id list derived from rows
that already matched that prefix. There is no path in it that can reach a row
the harness did not create. The wallet addresses, private keys, transaction
hashes and listing ids are derived by hash from the prefix, so a second run with
a different `--run-id` cannot collide with the first on any unique column.

`--run-id` defaults to `default`, and may also be set with
`GOVERNANCE_VALIDATION_RUN_ID`. It is deliberately *not* derived from the clock:
seed and verify are separate executions, and the verify phase has to be able to
find the rows the seed wrote.

## Running it

```bash
export GOVERNANCE_VALIDATION_ENABLED=true   # non-production only
node dist/scripts/governance_validation.js <phase> [--run-id <id>]
```

The phases are independent executions, because each verify phase has to observe
what a *real* scheduled job did in between:

| Phase | What it does |
| --- | --- |
| `seed-retention` | Writes 21 backdated analytics events across the three tiers |
| `verify-retention` | Checks what the retention run did against what the policy promises |
| `seed-erasure` | Writes a throwaway account due for erasure, plus a control account |
| `verify-erasure` | Checks the erasure, including that the control account is untouched |
| `cleanup` | Removes everything by prefix, in foreign-key-safe order |

### Retention

```bash
node dist/scripts/governance_validation.js seed-retention --run-id sprint23
node dist/scripts/run_retention_cleanup.js --dry-run     # the counts should now be non-zero
node dist/scripts/run_retention_cleanup.js
node dist/scripts/governance_validation.js verify-retention --run-id sprint23
```

The dry run between seed and run is worth doing: `seed-retention` reports what it
wrote per tier, and those numbers should appear in the dry run's `expired`
counts. A dry run still reporting `0 expired` after a seed means the two are not
looking at the same database.

Per tier, the seed writes one ordinary expired event (must be **deleted**), four
expired events from the audit-preserved families — commerce, payment, rights and
license — (must be **redacted in place**, not deleted), and two control rows
inside the window (must be **untouched**).

`verify-retention` then asserts, per fixture: the expired non-audit rows are
gone; the expired audit rows are still present with their actor, subject,
session and trace ids replaced by `[redacted]` and their person-shaped payload
keys emptied *while the non-personal payload survives*; the control rows are
present, unredacted, and have no lineage claiming otherwise; and a lineage row
exists with `retention_deleted` or `retention_redacted` as appropriate. It also
reports the warehouse outcome for the run and fails unless every observed
warehouse half completed with `status: "ok"`. A disabled target reports
`skipped`, which is a failed validation here: a green governance check must
prove the warehouse was actually reached.

### Erasure

```bash
node dist/scripts/governance_validation.js seed-erasure --run-id sprint23
node dist/scripts/run_due_erasures.js
node dist/scripts/governance_validation.js verify-erasure --run-id sprint23
```

`seed-erasure` writes two accounts whose `User.id` *is* their lowercased wallet
address, exactly as `auth.service.ts` writes it for a wallet account — which is
what makes "the address appears nowhere it should not" a searchable assertion
rather than a hopeful one. Each gets a wallet, a playlist, a library track, a
community message, a `SessionKey` holding a fabricated private key, an artist
with a published release, retained financial and audit rows, and analytics keyed
both by the pseudonymous actor id and by the raw user id. The control account
buys a stem from the subject's listing. Only the subject gets a closure request,
backdated past its 30-day window so the scheduled job finds it due.

`verify-erasure` rediscovers the rotated `User.id` through a retained audit row —
the pre-rotation id is the wallet address and must no longer be findable — and
then checks that the address is absent from the user id and email, wallets,
analytics in all keyings, and every dangling column the cascade cannot reach;
that the seeded private key is gone; that financial rows are retained but
relinked to the rotated id; that the artist is detached and the release
`withdrawn` rather than deleted; and that **the control account is entirely
untouched**. It also checks that warehouse erasure summaries exist for the
fixture, that every one completed successfully, and that neither per-event nor
batch lineage copied the wallet address it exists to prove was removed.

### Cleanup

```bash
node dist/scripts/governance_validation.js cleanup --run-id sprint23
```

Safe to re-run on an already-clean prefix. It reports what it removed per model
and anything it could not.

**One thing it deliberately leaves behind:** `AnalyticsGovernanceLog` rows with
action `warehouse_erasure`. Those are per-run batch summaries that carry no
`eventId`, and the same record also describes the real rows the run touched, so
removing them would delete part of a genuine audit trail. Everything else,
including the per-event lineage the harness's own fixtures produced, is removed
by prefix.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The phase completed; for a verify phase, every expectation held |
| `1` | Refused to run, crashed, an expectation failed, or cleanup could not remove something |

A failing verify phase logs `governance.validation.expectation_failed` with each
broken expectation's id, the one-line reason it matters, and the expected and
actual values. A verify phase that checked *nothing* also exits `1` — a run whose
queries all returned nothing must not report a green execution.

## Scheduling it

Run it as a Cloud Run Job on the backend image, like
`run_retention_cleanup` and `run_due_erasures`. It constructs its own services
rather than booting Nest, so its environment is a database URL, the analytics
settings, the environment label, and `GOVERNANCE_VALIDATION_ENABLED=true`. The
job definition belongs in `resonate-iac`, and **must not exist in the production
project**.

The phase names above are the contract with that job definition: changing one is
a change to a deployed job argument.

## Related

- [Analytics Retention Runbook](analytics_retention_runbook.md)
- [Account Erasure Runbook](account_erasure_runbook.md)
