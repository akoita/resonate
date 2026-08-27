# Production GCP Target Decision

**Status:** accepted · **Issue:**
[#1613](https://github.com/akoita/resonate/issues/1613) · **Owner decision:**
migrate first, approved by @akoita on 2026-08-25 · **Evidence reviewed:**
2026-08-25

## Decision requested

Choose the infrastructure sequence for Resonate's first controlled production
cohort:

1. launch from the current staging project, `resonate-staging-503400`, and
   migrate later; or
2. bootstrap the intended production project, `resonate-493513`, migrate the
   required data and identity state into it, and launch only after the target
   passes the migration and production-readiness gates.

This decision does not authorize a migration, production deployment, or
go-live. Those actions remain separately gated by
[#915](https://github.com/akoita/resonate/issues/915),
[#1583](https://github.com/akoita/resonate/issues/1583), and the remaining
[#1595](https://github.com/akoita/resonate/issues/1595) blockers.

## Recommendation

**Migrate first to the intended production project.** Do not turn the staging
project into the durable home for real-user custody.

The current project is the faster short-term route, but it is explicitly a
staging project that has already moved twice as free-trial ownership changed.
Launching there would knowingly schedule another project migration after real
users have accounts, content, payments, pledges, and collectibles. The intended
production project is not ready today, but that missing setup is visible,
bounded work: bootstrap its infrastructure, establish its GitHub environment
and WIF trust, carry identity-critical configuration, migrate the data plane,
and prove the target before cutover.

The migration risk is no longer hypothetical. A real project-to-project move
from `resonate-staging-499404` to `resonate-staging-503400` completed on
2026-07-24 with 92-table parity, 265 content objects, unchanged passkey-to-smart
account identity, and source-preserving rollback. That run also exposed three
known gaps—bucket-qualified URI rewriting, runtime allowlist replay, and live
image resolution—which must become explicit hard gates for the production move.
The evidence is recorded in
[`resonate-iac` issue #185](https://github.com/akoita/resonate-iac/issues/185)
and its [migration runbook](https://github.com/akoita/resonate-iac/blob/main/docs/data-migration-runbook.md).

## Current facts

- Application `main` publishes to the `staging` GitHub environment; production
  deployment is manual in `resonate-iac`. The release path retains an immutable,
  digest-bound manifest that can be handed off again without rebuilding.
- Both repositories' `staging` variables identify
  `resonate-staging-503400` in `europe-west1`. The public staging health endpoint
  reported `status: ok` on 2026-08-25.
- A [successful staging service deployment](https://github.com/akoita/resonate-iac/actions/runs/32797555383)
  completed on 2026-08-25. Later receiver runs did not start their deployment
  steps because the repository's GitHub Actions spending budget prevented
  runner use. This budget block affects either option and must be removed before
  relying on the deployment control plane.
- The intended production project is documented as `resonate-493513`, but the
  `resonate-iac` `prod` GitHub environment currently has no variables, no
  repository-visible protection rules, and no usable WIF configuration. Recent
  production workflow attempts failed before deployment.
- Public `resonate.audio` endpoints respond, but current evidence does not prove
  that they are backed by `resonate-493513`, governed by current Terraform
  state, or safe to treat as the production data plane.
- The current operator credentials available during this review could inspect
  the frozen source project `resonate-staging-499404` but not the live staging
  target. Current-project IAM ownership, backups, quotas, budget state, deployed
  digests, and alert delivery therefore require validation by an authorized
  operator.
- Resonate's durable state is Cloud SQL plus GCS content and identity-critical
  secrets/configuration. Redis and the derived analytics plane are recreatable;
  Pub/Sub backlog requires an explicit drain/replay decision. Base Sepolia state
  stays on-chain when chain, AA, and contract invariants are preserved.
- The existing migration preflight fails closed on the chain, AA, contract, and
  encryption-key invariants. The application also has source/target row,
  identity, cursor, and sample-content verification plus guided browser
  reauthentication when the environment identity changes.

## Side-by-side comparison

| Dimension | Launch from current staging project | Migrate first to intended production project |
| --- | --- | --- |
| Cost | Lowest immediate infrastructure change. Defers duplicate-project and transfer cost, but incurs it later after production begins. Actual current spend and budget headroom are unknown. | Temporary dual-running, bootstrap, transfer, and operator costs occur before launch. Ongoing topology should be comparable once the frozen source is retired. Exact cost cannot be estimated until billing access and target sizing are available. |
| Delivery time | Shortest path after GitHub Actions budget, target access, backup, IAM, and production-hardening checks are resolved. No data move is needed now. | Longer path: production GitHub environment/WIF, Terraform state, target bootstrap, image copy, migration, edge/DNS, and verification are all required. The proven data freeze was approximately 15–30 minutes after preparation; total preparation time remains an external estimate. |
| Security and IAM | Existing staging WIF and service accounts have deployed successfully, but live IAM cannot currently be independently inspected. Staging naming, ownership, and environment controls would need promotion-quality review. | Starts incomplete: prod WIF, variables, secrets, protection rules, state access, and operator ownership must be established. This is more work, but produces an explicit production trust boundary rather than promoting staging assumptions. |
| Data and identity | No immediate movement. Every new production record increases the later migration's custody and rollback stakes. | Moves pre-cohort data while the blast radius is smallest. Proven tooling preserves passkey identity and on-chain continuity, but URI rewriting and runtime allowlists remain mandatory manual gates until automated. |
| Deployment | Current exact-SHA publication and staging handoff are exercised. The later migration still needs a production delivery path. | Production delivery must be made functional before launch, including registry images, WIF, immutable manifests, service reconciliation, and authoritative Terraform inputs. This resolves a launch requirement once instead of deferring it. |
| Observability and backups | Terraform defines alerts, budgets, Cloud SQL backups, and PITR, and a staging apply succeeded; live target configuration and alert delivery are not independently verified. | Equivalent controls must be provisioned and proven in the production project. This adds a gate but prevents launch on inherited, unverified staging posture. |
| Operational risk | Lower immediate change risk; higher strategic risk because a later migration affects live custody and may compete with production incidents or growth. | Higher pre-launch execution risk; lower post-launch project-mobility risk. Known migration defects are documented and the source remains available during validation. |
| Rollback | No project cutover now. Image rollback reuses retained manifests, but schema/data writes and on-chain actions are not undone by an image rollback. | Source is frozen, not mutated. A failed target verification blocks cutover; an unhealthy cutover can repoint edge/DNS to the intact source. Source retirement waits for a healthy observation window. |
| Evidence confidence | High for repository design and recent staging health; medium/low for live IAM, backups, spend, quotas, and deployed revisions because target access is unavailable. | High for migration mechanics because one real migration succeeded; medium for production bootstrap effort; low for cost and schedule until production ownership, billing, and configuration are inspected. |

## Why the current-project path is not preferred

Launching from `resonate-staging-503400` is defensible only if production timing
is more important than avoiding a later custody migration, or if the intended
production account cannot be made operable in the launch window. Neither fact
is currently established. The path saves one pre-launch migration but does not
remove that work; it postpones it until the source holds more consequential
state. It also requires converting a staging environment into a production
trust boundary while separately repairing the intended production control
plane later.

## Selected-path completion boundary

If the owner accepts migrate-first, production launch remains blocked until all
of the following are evidenced:

1. Resolve the GitHub Actions spending block so validation and deployment jobs
   can run.
2. Confirm ownership, billing, quotas, and operator access for
   `resonate-493513`; identify what currently serves the public production
   endpoints before replacing or reusing anything.
3. Create authoritative production GitHub environment configuration,
   environment protections, Terraform state, WIF, service accounts, and
   least-privilege IAM. Secret values remain outside the repository.
4. Bootstrap APIs, networking, Artifact Registry, Cloud Run, Cloud SQL, GCS,
   Redis, Pub/Sub, selected analytics resources, edge, monitoring, budgets,
   backups, and PITR through `resonate-iac`.
5. Resolve the exact live source image digests and copy them to the production
   registry. Do not trust potentially stale tfvars image overrides.
6. Pass the migration preflight for chain, AA, contract, and encryption-key
   invariants; review the dry run before authorizing a real migration.
7. Freeze the source, copy Cloud SQL and durable GCS content, rewrite all
   source-bucket-qualified URIs, replay runtime admin/agent allowlists, and make
   an explicit Pub/Sub/analytics-history decision.
8. Pass row parity, identity resolution, indexer cursor, sample content,
   no-source-bucket-reference, playback, payment/configuration, Demucs,
   analytics, health, and edge smoke gates before DNS cutover.
9. Retain the frozen source and last-known-good manifests through an agreed
   observation window. Repoint DNS/edge and unfreeze the source if target
   verification or post-cutover health fails.

Completing these steps still does not authorize the first cohort. The remaining
legal, security, feature, support, and go-decision gates in #1595 and #1583
remain independent.

## Tracked implementation

- [#915](https://github.com/akoita/resonate/issues/915) remains the application
  migration parent and owns the selected-path boundaries across repositories.
- [`resonate-iac#185`](https://github.com/akoita/resonate-iac/issues/185)
  remains the production-target bootstrap, migration execution, cutover, and
  source-retention umbrella.
- [#1663](https://github.com/akoita/resonate/issues/1663) owns the sanitized
  target configuration matrix and cross-system application cutover smoke. Its
  repository-side strict migration verifier and secret-free evidence contract
  are `partial`; the issue remains open until an authorized target run supplies
  the configuration, smoke, live-revision, rollback, and source-retention
  evidence.
- [`resonate-iac#215`](https://github.com/akoita/resonate-iac/issues/215) owns
  the post-import URI, source-reference, allowlist, analytics/Pub/Sub, and
  fail-closed verification gaps found during the first live migration.
- [#1551](https://github.com/akoita/resonate/issues/1551) and
  [#1593](https://github.com/akoita/resonate/issues/1593) retain their existing
  WIF/supply-chain and release-evidence boundaries. This decision does not
  duplicate them.
- [#1595](https://github.com/akoita/resonate/issues/1595) remains the whole-app
  readiness ledger, and [#1583](https://github.com/akoita/resonate/issues/1583)
  remains the explicit production go/no-go gate.

## Assumptions and decision reversals

The recommendation assumes:

- `resonate-493513` is the owner-intended durable production project and can be
  administered before the cohort window;
- the current staging data is the data set that should seed production;
- a bounded maintenance window is acceptable before real-user launch;
- the source project can remain frozen and funded long enough to serve as the
  rollback target;
- chain, AA, contract, and encryption-key invariants can remain unchanged.

Reconsider a current-project launch only if one of these material reversals is
recorded:

- ownership or billing for `resonate-493513` cannot be secured in the launch
  window;
- a required invariant cannot be reproduced safely in the target;
- the source cannot be retained as a rollback target;
- production must launch before the bounded migration work can complete, and
  the owner explicitly accepts a later live-custody migration;
- investigation proves that the public production endpoints already use a
  healthy, Terraform-governed `resonate-493513` data plane, changing the task
  from migration to reconciliation.

## Owner decision record

On 2026-08-25, @akoita accepted the migrate-first recommendation:

- prepare and prove `resonate-493513` as the durable production project;
- migrate before the first controlled cohort;
- preserve `resonate-staging-503400` as the rollback source through the agreed
  observation window;
- keep migration execution, deployment, and go-live behind their existing
  explicit authorization gates.

The current-project launch path is rejected for now. Reconsideration requires
one of the material reversals listed above and a new recorded owner decision.
