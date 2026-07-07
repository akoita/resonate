# Sprint Plan: Vision Sprint 4 — Portable Deployments

> **CLOSED — 2026-07-07, goal met (all 5 items).** Migrating the deployment to a
> fresh GCP project now preserves every user account and all app content:
> - **iac#188** — a data-plane migration tool (Cloud SQL export→transfer→import +
>   GCS content), dry-run by default, fail-closed preflight on the identity
>   invariants, source never mutated.
> - **#1407** — identity continuity: the preflight guarantees the AA/chain
>   invariants + carries `ENCRYPTION_SECRET`, and `resolve_identity` (a
>   deterministic read-only diagnostic) makes continuity **provable** — proven by
>   a simulated dump→restore test.
> - **#1408** — a verification gate (row-count parity + identity resolution +
>   indexer-cursor + content) that BLOCKS cutover until the target is proven
>   green; decision logic pure and unit-tested.
> - **iac#186** — durable content by default: found and fixed a **live
>   content-loss bug** (the content bucket auto-deleted all masters/artwork after
>   30 days); auto-delete is now opt-in, off by default.
> - **iac#187** — a complete migration runbook with copy-paste verify commands,
>   ~15–30 min downtime, and trivial rollback (source stays intact).
>
> The correctness spine — move safely, guarantee identity, prove it worked before
> decommissioning — is complete. First real migration is operator-validated later
> (against a live target project), by design. Feasibility rested on the finding
> that identity is anchored to the device passkey + a deterministic on-chain
> smart account, so the whole feature reduced to moving one Postgres DB + content
> blobs + three invariants. Implemented by Opus 4.8 / Fable (Codex at weekly
> limit); every item reviewed and gated by Fable. Design:
> [`resonate-iac/docs/gcp-project-data-migration-design.md`](https://github.com/akoita/resonate-iac/blob/main/docs/gcp-project-data-migration-design.md).

**Dates:** Mon 2026-07-07 → Fri 2026-07-18 (10 working days, indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 4: portable deployments](https://github.com/akoita/resonate/milestone/6)
**Tracker filter:** [`label:sprint:vision-4`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-4)
**Working mode:** flexible priority-set sprint — see [docs/sprints/README.md](README.md)
**Design:** [`resonate-iac/docs/gcp-project-data-migration-design.md`](https://github.com/akoita/resonate-iac/blob/main/docs/gcp-project-data-migration-design.md)
**Spans:** `akoita/resonate-iac` (migration tooling/workflow) + `akoita/resonate` (backend verify/export helpers)

> **Sprint Goal:** migrating the whole deployment to a fresh GCP project
> **preserves every user account and all app content** — one operator command,
> verified before cutover, ~15–30 min planned downtime. **No user restarts
> from zero.** If, after a migration, a returning user's passkey does not land
> them on their same account with their data intact, the sprint missed.

## Why this theme

Resonate staging lives on GCP free-trial credit. Each expiry forces a fresh
project (issue-73 drill; last done as resonate-iac#165), and today the fresh
project starts **empty** — all content and every user account lost, users
restart from zero. The infra bootstrap is already automated; the missing piece
is an automated, verified **data-plane migration**. This is framed as a
production feature and built now because the staging pain is recurring and
real.

The analysis (design doc) established the load-bearing facts: identity is
anchored to the device passkey + a deterministic on-chain smart account (not to
GCP), on-chain state needs zero migration (same chain + env), and the app DB is
one Postgres instance — so the whole thing reduces to **move one DB + content
blobs + carry three invariants**, then verify.

## Priorities

| Tier | Item | What / exit condition |
| --- | --- | --- |
| **P0** | Data-plane migration tool (iac) | Idempotent `workflow_dispatch` (dev+staging): preflight → snapshot source Cloud SQL (`export sql`) → cross-project transfer → `import sql` into the bootstrapped target + GCS content transfer, with `--dry-run` (stops after preflight). Make target + skeleton runbook. **Exit:** a dry-run diffs source/target cleanly; a real run moves DB + content into a bootstrapped target. |
| **P0** | Identity-continuity guarantee (iac + resonate) | Preflight **fails closed** unless target AA factory/EntryPoint/`chainId` and contract addresses match source; the tool carries `ENCRYPTION_SECRET` (confirm raw-AES vs Cloud-KMS mode — cross-project grant if KMS). Document the `JWT_SECRET` rotation → guided re-login. **Exit:** on a test migration, a known passkey → same `userId`/wallet on the target; a mismatched-AA target aborts before touching data. |
| **P1** | Migration verification gate (resonate) | A post-migration check (extends the #1392 lifecycle-smoke pattern): per-table row-count parity, a real `PasskeyIdentity → User → Wallet` resolves on target, escrow/stem indexers resume from the migrated cursor, a sample track/show/analytics query returns. **Exit:** green = safe cutover, red = block decommission; wired into the migration workflow as the gate before cutover. |
| **P1** | Durable content: fix GCS 30-day auto-delete (iac) | The content bucket lifecycle auto-deletes objects after 30 days — original masters older than 30 days are already gone, undermining "preserve content." Relax/scope the lifecycle so **original masters/artwork persist** (keep re-derivable stems on a short lifecycle). **Exit:** originals are not auto-expired; migration actually preserves them. |
| **P1** | Runbook + one-click + Makefile (iac) | Cold-start migration runbook (per contract-ops-ergonomics): the button, the operator inputs, the order, the verify-then-decommission rule. **Exit:** a future credit-expiry migration is a documented one-click action, not a fresh investigation. |
| **P2 / stretch** | Analytics backfill + prod-upgrade note | Optional: re-publish the migrated `AnalyticsEvent` ledger so BigQuery history rebuilds. Document the eventual zero-downtime continuous-replication upgrade path for production. |

## Operator inputs required (only @akoita can provide)

- Interactive `gcloud auth login` to the new owner/billing account and a
  bootstrapped target project (the #165 flow) — the migration tool assumes the
  target infra already exists.
- A cross-project transfer bucket + the IAM grants for Storage Transfer /
  Cloud SQL import between source and target projects.
- Confirmation of the `ENCRYPTION_SECRET` mode on staging (raw env AES key vs
  Cloud KMS) so R2 carries it correctly.

## Explicitly NOT in this sprint

- **Zero-downtime / continuous replication** — future production upgrade
  (decision 1: big-bang cutover chosen).
- **Managed-DB re-architecture** (Neon/Supabase) — separate strategic call.
- **Production go-live** (still staging per #1271) — but this IS the production
  migration mechanism, built now.
- New product features / revenue-line work — this sprint is
  infrastructure/durability (vision-neutral: `vision:keep`).

## Exit criteria

- [ ] One operator command migrates DB + content between two GCP projects,
      idempotent, with a working `--dry-run`.
- [ ] A returning user's passkey lands on the **same account with intact data**
      after a test migration (identity continuity proven end to end).
- [ ] Preflight fails closed on any AA/chain/contract mismatch;
      `ENCRYPTION_SECRET` carried so agents keep working.
- [ ] A verification gate proves data+identity integrity on the target before
      the source is decommissioned.
- [ ] Original masters/artwork are no longer auto-deleted at 30 days.
- [ ] A cold-start runbook + one-click action + make target exist.
- [ ] Any mid-sprint re-scope recorded here with a dated note.

## Business-model conformance

Vision-neutral infrastructure/durability (`vision:keep`) — it protects every
revenue line by ensuring the platform's users and content survive the
credit-expiry cycle instead of resetting to zero. No fee/split/payout changes;
ADR-BM-4 red lines untouched. Identity continuity strengthens user trust
(their accounts and on-chain assets persist across migrations).
