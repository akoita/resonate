# Issue 1658 Implementation Plan: Release-Gated Deployments

## Outcome

Ordinary pull-request, merge-queue, and `main`/`develop` push events will remain
validation-only. They will not build or publish deployable images, write a
Dataflow template, dispatch `resonate-iac`, or otherwise mutate a cloud
environment.

One explicit release-deployment workflow will own application image
publication and the optional non-production deployment handoff. Planned
sprint releases and authorized on-demand releases will use the same workflow
and evidence contract.

This is vision-neutral infrastructure and quality work. It does not change
product behavior, fees, payouts, licensing, or other Business Model v2 rules.

## Pre-Change State

- `.github/workflows/ci.yml` treats pushes to `main` and `develop` as image
  publication events. Its final jobs publish backend, frontend, Demucs, and
  stable-audio images and upload a deploy manifest.
- `.github/workflows/deploy-handoff.yml` automatically follows successful CI
  runs on `main` and `develop` and can dispatch that manifest to
  `resonate-iac`.
- `.github/workflows/publish-analytics-dataflow-flex-template.yml` publishes a
  container and mutates a GCS template path on a matching push to `main`.
- `.github/workflows/software-release.yml` currently downloads image and deploy
  evidence from a push-triggered CI run, so its evidence source must move with
  image publication.
- Mergify queue candidates already run the broad validation safety net. The
  lightweight post-merge `main` run exists primarily for the publication path
  that this issue removes.

## Design Decisions

### Separate validation from release mutation

Keep `CI` responsible for code validation only. Remove its publish-plan,
image-publish, deploy-manifest, and cloud-auth jobs. Preserve path-aware PR
checks and the full merge-queue candidate checks. Keep the post-merge push as a
small receipt/diagnostic run rather than repeating the complete queue build.

### Add one explicit release-deployment workflow

Add `.github/workflows/release-deployment.yml` with `workflow_dispatch` only.
Its inputs will be:

- `mode`: `preview` or `publish`;
- `release_kind`: `planned` or `on-demand` (audit metadata only);
- `source_sha`: a required full 40-character commit SHA;
- `ci_run_id`: the successful `CI` run for that exact SHA;
- `environment`: `dev` or `staging`;
- `services`: an allowlisted comma-separated selection, defaulting to all
  deployable application services;
- `deploy`: whether a successful publish should dispatch the manifest to
  `resonate-iac`.

The workflow will reject moving or ambiguous refs. It will verify the CI run,
source reachability, branch/environment mapping, service allowlist, release
identity, and required environment configuration before cloud authentication.
Image tags remain the immutable full source SHA; deploy manifests retain image
digests and a run-scoped release ID.

`preview` will render and upload the validated plan without cloud credentials
or mutation. `publish` will build the selected images, reusing existing
content-addressed worker/backend images where safe, create the digest-bound
manifest, publish evidence, and optionally invoke the deployment handoff.

All services are selected by default because multiple merges can accumulate
between releases. An operator may intentionally narrow an on-demand release,
but the selected list is validated and recorded. Content-addressed reuse keeps
unchanged images from being rebuilt.

### Make deployment handoff release-scoped and retryable

Remove the `workflow_run` trigger from `.github/workflows/deploy-handoff.yml`.
Support `workflow_call` from the explicit release workflow plus
`workflow_dispatch` for an operator retry or rollback using a prior successful
release run ID. The release workflow calls the handoff only after a requested
publish completes successfully. The handoff will accept only a valid release-deployment
manifest, revalidate its source, target, selected services, and immutable image
digests, then dispatch `resonate-iac`.

Production remains manual and IaC-owned. This issue preserves the current
`develop` to `dev` and `main` to `staging` application handoff boundary.

### Gate analytics publication too

Remove the `push` trigger from the Analytics Dataflow Flex Template workflow.
Require a full source SHA for manual publication, check out and submit that
exact revision, default the image tag to the SHA, and record the source in its
handoff evidence. Publishing a stable GCS template path remains an explicit
operator action.

### Repoint software-release evidence

Update `.github/workflows/software-release.yml` to consume the deploy manifest
and selected image evidence from a successful explicit release-deployment run,
not from ordinary CI. It will still validate the separate successful CI run
for the approved Release Please commit and will require all three identities
(candidate SHA, CI SHA, and image-release SHA) to match.

## File-Level Work

1. `.github/workflows/ci.yml`
   - Remove image publication and deploy-manifest jobs.
   - Rename stale `main_deploy_only` terminology to a post-merge validation
     receipt and keep PR/queue validation behavior intact.
   - Remove cloud-write permissions, environment selection, and secrets that
     become release-only.

2. `.github/workflows/release-deployment.yml`
   - Add the manual preview/publish workflow, fail-closed input validation,
     exact-SHA checkout, reusable CI gate, reusable image publisher,
     concurrency, and optional handoff.
   - Use target GitHub environments for authorization and keep `id-token: write`
     limited to image publication jobs.

3. `.github/workflows/publish-deployable-images.yml`
   - Add the workflow-call-only four-service image publisher, immutable
     evidence, and digest-bound deploy manifest.

4. `.github/workflows/deploy-handoff.yml`
   - Replace automatic CI completion with reusable/manual release-run inputs.
   - Preserve digest validation and make retry/rollback reuse an existing
     manifest without rebuilding or retagging images.

5. `.github/workflows/publish-analytics-dataflow-flex-template.yml`
   - Make publication manual-only and exact-SHA-bound.

6. `.github/workflows/software-release.yml`
   - Add the explicit image-release run identity and consume its artifacts.
   - Preserve the protected tag/publication environment and immutable release
     evidence contract.

7. `.github/scripts/` and `.github/scripts/tests/`
   - Extract deterministic validation for release inputs and referenced Actions
     runs rather than maintaining large untested inline shell fragments.
   - Add tests for malformed/moving refs, SHA/run mismatches, invalid services,
     invalid environment mapping, preview no-op behavior, and manifest/run
     identity mismatches.

8. `.github/workflows/security.yml`
   - Update privileged-workflow event allowlists so release mutation accepts
     only explicit/reusable release events and analytics accepts only manual
     dispatch.
   - Fail if a push or generic CI completion again reaches a cloud-mutating
     workflow.

9. Documentation
   - Update `docs/operations/merge_queue_ci.md` to describe validation-only
     merges.
   - Update `docs/operations/release_process.md`,
     `docs/architecture/release_process.md`, and
     `docs/features/release_process.md` with planned/on-demand release,
     authorization, preview, publish, retry, failure, and rollback procedures.
   - Update `docs/smart-contracts/deployment.md` and
     `docs/architecture/deployment_architecture.md` to remove the automatic
     main/develop handoff description.
   - Update `docs/deployment/environment.md` for any release-only variables or
     environment protections that change.

## Validation

Local focused validation will include:

- unit tests for release input/run/manifest validation;
- existing image-evidence, deploy-intent, release-evidence, release-control,
  and Cloud Build submit tests;
- static workflow policy checks proving `push` and generic `workflow_run`
  cannot reach image publication, template publication, or deployment;
- `actionlint` for all changed workflows;
- YAML parsing, pinned-action, permissions, and `git diff --check` gates;
- a fixture-backed preview proving an ordinary merge produces no publish plan
  while an explicit release renders the intended exact-SHA plan.

No cloud publish, deployment, tag, or release will be performed during local
validation. A live `preview` run is the safe acceptance proof after the
workflow is available on GitHub. A credentialed `publish`/deploy run remains an
operator-approved external action and will be reported separately rather than
silently triggered while preparing the PR.

## Failure And Rollback Contract

- A failure before image publication leaves no deploy manifest eligible for
  handoff.
- Partial image publication fails the aggregate job and cannot dispatch.
- A failed deploy can retry the same manifest and digests without rebuilding.
- Rollback selects a previously reconciled release run and immutable digest
  manifest; it never moves a tag or retags an image.
- Concurrency is serialized per target environment so a newer release cannot
  race an older deployment.
- All external GitHub environment/ruleset controls that cannot be proven from
  the repository will be listed as required operator configuration and durable
  follow-up evidence.

## Scope Boundaries

- No application runtime or product behavior changes.
- No Terraform or cloud topology redesign; `resonate-iac` remains the deployment
  owner.
- No automatic sprint-end schedule. A planned release is still explicitly
  initiated.
- No production automation beyond the current manually controlled IaC boundary.
