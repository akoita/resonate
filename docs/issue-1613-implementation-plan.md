# Issue #1613 implementation plan: choose the production GCP target

## Outcome

Produce an owner-approved, evidence-backed decision between launching from the
current GCP project and migrating to the intended production project first. The
decision will define the selected path, assumptions, risks, rollback boundary,
and focused follow-up work without performing a migration, production deploy,
or go-live.

This is vision-neutral infrastructure and quality work under ADR-BM-6. It does
not change fees, payouts, licensing, product behavior, or a revenue line.

## Decision boundaries

- Compare only two launch sequences: harden and launch from the current project,
  or complete the minimum viable project migration before launch.
- Treat issue #915 as the migration execution epic and issue #1595 as the
  production-readiness ledger. This issue chooses a direction; it does not
  absorb either issue's implementation scope.
- Keep Terraform, deploy environments, service accounts, Artifact Registry,
  Cloud Build, and production execution owned by `resonate-iac`.
- Do not copy credentials, secret values, account identifiers, or sensitive
  billing data into the repository. Record only sanitized evidence and links.
- Do not interpret this decision as production authorization. Issue #1583 and
  the remaining #1595 gates continue to control go-live.

## Evidence collection

### 1. Establish the current deployment baseline

- Inventory the app repository's GCP dependencies: image publication, deploy
  handoff, runtime configuration, storage, Pub/Sub, analytics/Dataflow, Demucs,
  identity continuity, public origins, and contract-adjacent settings.
- Inventory the corresponding `resonate-iac` environments, Terraform state,
  IAM/WIF bindings, deploy workflows, resource ownership, and current project
  assumptions.
- Separate observed facts from operator-provided facts and unknowns. Reference
  repository paths, workflow runs, sanitized command output, or linked issues
  for every material claim.
- Identify stateful resources and external dependencies whose migration cost or
  reversibility materially differs from stateless recreation.

### 2. Define both viable paths at the same level of detail

For each path, document:

- required work and explicit completion boundary;
- realistic delivery sequence and operator touchpoints;
- one-time and recurring cost implications, using ranges or relative estimates
  where billing data is unavailable;
- IAM, Workload Identity Federation, Secret Manager, and credential-rotation
  impact;
- database, object storage, Pub/Sub, analytics, and generated-artifact handling;
- CI image publication, deploy handoff, environment configuration, DNS/origin,
  and observability changes;
- failure modes, blast radius, rollback trigger, rollback procedure, and the
  point after which rollback becomes materially harder;
- evidence required before the path can satisfy the relevant #1595 gate.

Do not make the migrate-first path equal to the full long-term scope of #915.
Define the minimum migration boundary necessary for a safe first cohort, then
leave later cleanup and optimization explicitly deferred.

## Comparison and recommendation

### 3. Build a side-by-side decision matrix

Compare the paths across the acceptance-criteria dimensions: cost, timeline,
security/IAM, data movement, deployment, observability, operational risk, and
rollback. Add dependency count, unknowns, and evidence confidence so an
apparently shorter path is not favored merely because its work is undocumented.

Use explicit decision principles:

- minimize irreversible work before the first controlled cohort;
- avoid creating a production identity or data home that must immediately move;
- prefer rehearsable deployment and recovery over nominal speed;
- preserve account, passkey, wallet, contract, and content continuity;
- keep the rejected path viable if a named assumption proves false.

### 4. Write a recommendation with a decision checkpoint

- Recommend one path and explain why the alternative is not preferred now.
- List assumptions, material risks, unresolved external facts, and the facts
  that would reverse the recommendation.
- Present the recommendation to the app owner as an explicit approval decision.
- Record the owner's decision and date in the decision document and issue #1613.
  Until that approval is recorded, label the document `proposed`, not `accepted`.

## Durable outputs

### 5. Synchronize planning sources after approval

- Add a focused decision document under `docs/architecture/` with the evidence,
  matrix, recommendation, owner decision, rollback boundary, and links.
- Update `docs/roadmap/2026-07-production-readiness-triage.md` so the
  infrastructure-target row links to and accurately summarizes the decision.
- Update issue #1595 with the decision evidence while leaving unrelated
  production blockers untouched.
- Update issue #915 to reflect whether migration is the selected pre-launch
  path, a post-launch follow-up, or otherwise constrained by the decision.
- Update relevant deployment documentation only where the chosen target changes
  current operator guidance; do not duplicate `resonate-iac` configuration.

### 6. Create only the required follow-up issues

- Reuse existing issues where their completion boundaries already cover the
  selected work.
- Create focused `resonate` and `resonate-iac` issues only for uncovered work,
  with owners, repository boundaries, dependencies, validation evidence, and
  rollback requirements.
- Link every follow-up from #1613 and the decision document. Do not create or
  reassign milestone scope without separate owner approval.

## Validation and completion evidence

- Cross-check every matrix claim against repository evidence or mark it as an
  externally validated assumption.
- Confirm the decision document covers all eight required comparison dimensions
  and clearly separates current facts, estimates, unknowns, and owner choices.
- Run focused documentation link/style checks; no unrelated application build is
  warranted for a documentation-only decision change.
- Review `docs/engineering/change_impact_checklist.md`. Expected impacts are
  deployment/configuration, operational state, permissions/security, and
  documentation; no product UI, API, analytics event, schema, or User Guide
  change is expected.
- Keep #1613 open until the owner decision is recorded, #1595 and the roadmap
  link to it, and all selected-path implementation gaps have focused tracking.

## Risks and safeguards

- **Incomplete inventory:** cross-check both repositories and distinguish
  deployed resources from configuration that merely exists in source.
- **False precision:** use evidence ranges and confidence labels instead of
  inventing exact costs or dates without billing and operator availability.
- **Scope inflation:** compare minimum launch-ready paths; keep execution in
  #915 and follow-up issues.
- **Hidden identity or data coupling:** explicitly trace WIF, service accounts,
  secrets, public origins, environment identity, stateful data, wallets, and
  contract configuration before recommending a path.
- **Decision mistaken for go-live:** repeat the non-authorization boundary in
  the decision, roadmap, issue update, and PR summary.
