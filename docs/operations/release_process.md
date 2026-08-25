# Software Release Operations

This runbook implements the [release and versioning decision](../architecture/release_process.md).
It is an operator/developer procedure, not an end-user feature.

## Current State

CI and deployment are separate planes. Pull requests, merge-queue candidates,
and `main`/`develop` pushes validate source only; the `main` post-merge run is
a lightweight receipt. The manual **Release Deployment** workflow is the only
application image publication path, and `Deploy Handoff` can follow only a
successful explicitly dispatched release run. Analytics Dataflow publication
is also manual and exact-SHA bound.

Issue [#1593](https://github.com/akoita/resonate/issues/1593) remains open until
the release credentials, negative-control tests, Software Release preview, and
first real release have durable evidence. Do not create a `v*` tag manually
while that work is incomplete.

## Roles

- The release maintainer reviews the release PR, evidence, version, and notes.
- The security maintainer reviews release-plane or provenance anomalies.
- The infrastructure maintainer owns live deployment and `resonate-iac`
  reconciliation.
- The protocol maintainer owns contract deployment, pause, upgrade, and
  recovery decisions.
- The protected `software-release` environment reviewer authorizes publication.

One person may hold several roles, but publication must still pass the checked
controls. Tokens, private keys, raw secrets, and recovery material never belong
in release notes, issues, logs, or workflow artifacts.

## Before A Release PR

1. Confirm `main` is the intended source and required CI is healthy.
2. Review changes since the latest `v*` tag across web, backend, desktop,
   workers, analytics, contracts, and deployment handoffs.
3. Confirm partial features and deferred work have durable linked tracking.
4. Identify compatibility changes, database/data migrations, contract changes,
   configuration changes, and security impact.
5. Confirm milestone changelog work is not being treated as a software release.

## Local Preview

Run the checked-in, dependency-free preview against a commit reachable from
local `main` or `origin/main`:

```bash
npm run release:check
node scripts/release-policy.mjs preview --source <full-sha> --output /tmp/resonate-release-plan.json
```

The plan records the exact source, current and proposed version/tag, boundary,
and Conventional Commits considered. It performs no Git write or network call.
Inspect the JSON, run `npm run test:release-policy` plus the release-evidence
tests, and confirm `git status --short` is unchanged.

## CI And Release Dry Run

Run **Release Please → Preview Release Plan** for a full `main` SHA to retain
the read-only version proposal. The preview has no tag, release, image,
deployment, or cloud side effect.

After the release commit is on `main` and its exact CI run succeeds, run
**Release Deployment** with `mode=preview`. This read-only run checks the exact
source and CI run, branch/environment mapping, service selection, and release
configuration, then retains a release plan. It does not authenticate to a
publisher or create images, a deploy manifest, or an IaC handoff.

For the software release evidence dry run, run **Software Release** with
`mode=preview`, the full candidate SHA, the successful `ci_run_id`, and the
successful explicit Release Deployment `image_run_id`. The two run identities
must both point to that candidate SHA. Software Release preview uses read
access, validates the digest-bound manifest and image evidence, renders release
notes and a release-evidence archive, and asserts that neither the proposed tag
nor GitHub Release exists.

The evidence validator fetches exactly
`image-evidence-<service>-<candidate_sha>` for each selected allowlisted service
from the image-release run. Record workflow URLs, source SHA, retained plan
checksums, run IDs, and validation results on #1593. A local fixture test is not
the acceptance dry run because it cannot prove GitHub permissions, artifact
lookup, or repository settings.

## Release Deployment

**Release Deployment** (`.github/workflows/release-deployment.yml`) is
`workflow_dispatch` only. It accepts the following inputs:

| Input | Contract |
| --- | --- |
| `mode` | `preview` or `publish`. |
| `release_kind` | `planned` or `on-demand`; this is release audit metadata, not an automatic schedule. |
| `source_sha` | Required full 40-character source SHA. Moving or ambiguous refs are rejected. |
| `ci_run_id` | Required successful CI run ID for exactly `source_sha`. |
| `environment` | `dev` or `staging`; `dev` maps to `develop`, and `staging` maps to `main`. |
| `services` | Canonical comma-separated selection from `backend`, `frontend`, `demucs`, and `stable-audio`; the default selects all four. |
| `deploy` | Boolean handoff intent. `false` intentionally publishes images without dispatching a deployment. |

The workflow serializes publication and handoff per target environment. It
validates the source SHA, CI run identity, branch mapping, service allowlist,
and environment configuration before any publisher credentials are used.

In `preview` mode, the workflow is read-only and retains a release plan with
the exact SHA, CI run, environment, selected services, and deploy intent. A
preview never creates an image, deploy manifest, or IaC
dispatch.

In `publish` mode, the workflow first invokes reusable `CI` validation
(`workflow_call`) for the exact source. Only after that succeeds does it call
the workflow-call-only
`.github/workflows/publish-deployable-images.yml` publisher. The publisher
creates selected SHA-tagged images, resolves immutable registry digests, and
retains build metadata, SBOM, signature, and attestation evidence. Unchanged
content-addressed images may be reused when their digest-bound evidence is
valid; the build metadata and image evidence record the reuse result.

The deploy manifest is eligible only after the selected image work completes
as one successful aggregate. A failed or partial publication never dispatches
an incomplete manifest. A successful publish may still have `deploy=false`.
When `deploy=true`, the release workflow hands the complete immutable manifest
to `Deploy Handoff`; production remains manual and `resonate-iac`-owned.

`Deploy Handoff` is reusable via `workflow_call` from a successful explicitly
dispatched Release Deployment run, with a separate manual `workflow_dispatch`
path whose `release_run_id` supports retry or rollback from a retained
successful manifest without rebuilding or retagging images. It has no
`workflow_run` trigger and never follows ordinary CI, a merge-queue run, or a
`main`/`develop` push. A preview has no deploy manifest and is therefore skipped
by the handoff.

Analytics is separate from application image publication. **Publish Analytics
Dataflow Flex Template** is `workflow_dispatch` only and requires a full
`source_sha` that equals the dispatch revision on the matching branch:
`develop` for `dev` and `main` for `staging`. It publishes the SHA-tagged image,
evidence, and template only after that exact-source check.

## Protected Controls And Credential Boundaries

Release Deployment and Analytics publication use the target GitHub environment
(`dev` or `staging`) as the publisher boundary. Those environments must hold
the environment-scoped `GCP_WIF_PROVIDER` and
`GCP_ARTIFACT_REGISTRY_SA_EMAIL` secrets, plus the variables required by the
selected workflow: `GCP_PROJECT_ID`, `GCP_REGION`, the frontend `NEXT_PUBLIC_*`
build variables, and the optional Cloud Build controls
`GCP_BILLING_QUOTA_PROJECT`, `GCP_CLOUD_BUILD_SOURCE_STAGING_DIR`, and
`GCP_CLOUD_BUILD_POLLING_INTERVAL_SECONDS`. `CI_FORCE_IMAGE_REBUILD` may be
set as an environment variable when an operator must bypass content-addressed
image reuse. Analytics additionally reads
`ANALYTICS_DATAFLOW_ARTIFACT_REGISTRY_REPOSITORY`,
`ANALYTICS_DATAFLOW_TEMPLATE_BUCKET`,
`ANALYTICS_DATAFLOW_TEMPLATE_PREFIX`, and
`ANALYTICS_DATAFLOW_TEMPLATE_GCS_PATH` when configured. The publisher uses
workload identity; no cloud private key belongs in the repository.

`Deploy Handoff` reads `RESONATE_IAC_DISPATCH_TOKEN` when a complete manifest
requests deployment. It is a handoff credential, not an image-publisher
credential, and is never needed when `deploy=false`. The handoff payload
contains the target environment, selected services, source SHA, release ID,
and immutable image tags/digests.

The publish job reads the `software-release` environment and both configured
rulesets before it can use the publisher credential. The environment must have
at least one required reviewer and `deployment_branch_policy.protected_branches`
must be `true`. The release ruleset must be active, target tags, include
`refs/tags/v*`, and contain `creation`, `deletion`, and `non_fast_forward`
protections. The milestone ruleset has the same controls for
`refs/tags/milestone-*`. Each creation-protected ruleset must also have at least
one `bypass_mode: always` actor for the approved publisher/maintainer path.

`RELEASE_TAG_RULESET_ID` and `MILESTONE_TAG_RULESET_ID` are positive numeric
IDs for those exact rulesets. The workflow validates the IDs before fetching
the control documents and fails closed on missing, inactive, incorrectly
scoped, or incomplete controls. It does not print secret values.

Credential responsibilities stay separate: `RELEASE_PLEASE_TOKEN` is a
least-privilege repository secret used only to update the version/changelog PR;
`SOFTWARE_RELEASE_TOKEN` is available only inside the approved
`software-release` environment and is used only to create the immutable tag and
draft release. The default workflow token remains read-only for validation.

GitHub environment reviewers, required-branch policies, and ruleset bypass
actors are external repository settings. They must be configured and
negatively tested by maintainers; checked-in workflow validation can only fail
closed when the settings are missing or malformed. The `software-release`
environment currently requires a reviewer and protected-branch policy, while
`dev` and `staging` must have the reviewer/protection policy required by the
organization before enabling image publication or analytics mutation.

Retain the workflow URL, control-validation result, rendered release plan,
release-evidence archive, deploy manifest, and `SHA256SUMS` with the release
record. Before enabling publication, negatively test unauthorized tag creation,
tag update/deletion, release publication, and asset replacement; retain the
expected denials and actor context without recording token contents.

## Live Evidence Snapshot

The following evidence is recorded for [#1593](https://github.com/akoita/resonate/issues/1593)
and separates proven repository controls from the remaining credential and
publication gates:

- PR [#1623](https://github.com/akoita/resonate/pull/1623) merged at
  `ef9ed481e40d514ed9d21d7a97b443370b09904c`; the merged
  `release_controls` validator accepted the live GitHub API payloads.
- Release tag ruleset `21354806` is active for `refs/tags/v*`; milestone tag
  ruleset `21354808` is active for `refs/tags/milestone-*`. Both require
  creation, deletion, and non-fast-forward protections and have an
  always-enabled approved User bypass actor. The environment variables point
  to these two rulesets.
- The `software-release` environment requires reviewer `akoita`, uses the
  protected-branch deployment policy, and has `prevent_self_review=false` for
  the solo-maintainer path.
- The [read-only Release Please preview run](https://github.com/akoita/resonate/actions/runs/32797404994)
  produced `release-preview-ef9ed481e40d514ed9d21d7a97b443370b09904c/release-plan.json`
  with SHA-256
  `4c2a05561bf31c5806afa95faebb85d18dce1150e0d9faa2e118cbed21e7b833`.
  The plan records source `ef9ed481e40d514ed9d21d7a97b443370b09904c`, current
  version `0.1.0`, proposed version/tag `0.2.0`/`v0.2.0`, 21 commits, and
  `dryRun: true`.
- The independent IaC release contract is tracked in
  [resonate-iac#213](https://github.com/akoita/resonate-iac/issues/213); this
  branch does not expand into IaC implementation.

## Prepare And Approve A Software Release

1. Let Release Please open or update the release PR from merged Conventional
   Commit metadata.
2. Review the proposed `vMAJOR.MINOR.PATCH` or `vMAJOR.MINOR.PATCH-rc.N`, all
   version files, and changelog. Correct under-versioned breaking changes.
3. Complete every release-notes category. Use an explicit `None` or `Not
   deployed` only when accurate; do not delete categories.
4. Link known limitations and carry-over issues. Do not claim end-to-end feature
   completion for a partial slice.
5. Merge through the normal queue and wait for required CI on the exact release
   commit.
6. Run Release Deployment `mode=preview` with the exact source and successful
   CI run, selecting `planned` or `on-demand`, the target environment, and the
   canonical service set. Retain the resulting plan.
7. If publication is approved, rerun Release Deployment with `mode=publish`.
   Keep `deploy=false` when the release should publish evidence without an IaC
   handoff.
8. Confirm each selected image evidence artifact contains build metadata,
   CycloneDX SBOM, signature verification, SBOM-attestation verification, and
   build-attestation verification bound to the same SHA and digest. Record any
   content-addressed image reuse.
9. Confirm the deploy manifest and any analytics, desktop, contract, or IaC
   evidence. State explicitly which units were not built or deployed.
10. For Software Release, retain both the successful `ci_run_id` and successful
    image-release `image_run_id`; both must identify the candidate SHA.

## Publish The Software Release

Start **Software Release** publication only for the approved release commit,
after the explicit Release Deployment image run succeeds. Supply the full
`candidate_sha`, its successful `ci_run_id`, and its successful
`image_run_id`. The candidate SHA, CI run SHA, and image-release run SHA must
match. The workflow must:

1. verify the commit is reachable from `main` and is the merged release PR
   commit;
2. verify the referenced `ci_run_id` succeeded on `main` for that exact SHA;
3. verify the referenced `image_run_id` is a successful explicitly dispatched
   Release Deployment publish on `main` for that exact SHA;
4. revalidate version consistency, release-note completeness, and all selected
   evidence;
5. fail if the tag or GitHub Release already exists;
6. obtain approval from the protected `software-release` environment;
7. create the immutable `v*` tag at the approved SHA;
8. create the GitHub Release without `--clobber`, marking `-rc.N` as a
   prerelease;
9. attach durable checksums/evidence required by policy and verify the published
   release still points to the expected SHA.

Software Release publication does not itself authorize production deployment.
Record `deploy=false` explicitly when images were published without a handoff,
and record the target environment and immutable manifest when a handoff did
occur. Production remains manual and IaC-owned.

## Close A Milestone

Milestone closure is a separate required changelog procedure:

1. Update the sprint document with its observable outcome.
2. Enumerate all milestone issues. Close completed slices; keep unfinished
   parents open and reassign/link every carry-over with a reason.
3. Link the next milestone or state that it is not yet selected.
4. Generate notes listing shipped PRs, verification, carry-over, and deferred
   owner decisions.
5. Create `milestone-<github-milestone-number>-<slug>` at the closure SHA and a
   changelog-only GitHub Release with no software artifacts.
6. Verify no software or desktop publication workflow ran for the milestone
   tag, then close the GitHub milestone.

Never use `v*` for a sprint report.

## Hotfix

1. Triage severity and identify the currently supported source and
   last-known-good release.
2. Prepare the smallest reviewed fix as a PR; do not bypass `main` or required
   validation.
3. Add regression tests and security review appropriate to the affected
   boundary.
4. Produce a new `PATCH` release through the complete preview, evidence, and
   approval flow.
5. Link the incident and affected versions without publishing sensitive detail.

## Rollback

1. Stop or pause the affected handoff/deployment and preserve evidence before a
   retry.
2. Select a reconciled last-known-good successful Release Deployment run,
   full SHA, immutable digest, and deploy manifest. Use its `release_run_id`
   with Deploy Handoff for a retry or rollback; do not rebuild images.
3. Revalidate signer identity, attestations, declared digest, registry digest,
   and environment before redeployment.
4. Redeploy the retained manifest by digest through `resonate-iac`; never retag
   a mutable image as the previous version. Target-environment concurrency
   prevents two handoffs from racing.
5. For contracts, use the documented pause/timelock/upgrade/replacement path and
   record chain-specific state. Do not imply that source rollback reverses a
   transaction.
6. Verify live revision/state and update the release with an incident notice or
   known limitation. Do not move/delete the original tag or overwrite assets.

Follow [Supply-Chain Incident Response](supply_chain_incident_response.md) for
containment, evidence preservation, credential rotation, and reconciliation.

## Failed Or Suspicious Publication

- If Release Deployment preview validation fails, retain the plan and logs,
  correct the source or inputs, and rerun preview. Preview has no cloud write
  to roll back.
- If reusable CI or any selected image publication fails, the aggregate release
  fails closed and no partial deploy manifest is eligible for Deploy Handoff.
  Fix the source through a PR or rerun the exact release after review.
- If a publish succeeds with `deploy=false`, that manifest remains
  intentionally ineligible for handoff and does not imply that an environment
  changed. A later approved deployment requires a new Release Deployment
  publish with `deploy=true`; content-addressed reuse may avoid rebuilding the
  unchanged images.
- If validation fails before the tag is created, preserve the plan and logs,
  fix the source through a PR, and rerun preview. Do not weaken the validator.
- If a tag exists but release creation fails, stop. Treat the immutable tag as a
  consumed version, investigate, and use a new version unless the runbook has a
  reviewed recovery mechanism that does not mutate the tag.
- If the tag target, actor, workflow event, digest, signer, or attestation is
  unexpected, disable the affected publication/handoff path and follow the
  incident-response playbook.
- If credentials may have been exposed, revoke them before retrying and avoid
  copying their contents into the incident record.

## External Completion Checklist

The live rulesets, protected environment, and Release Please preview are proven
in the evidence snapshot above. The following remain before #1593 can close:

- add `RELEASE_AUTOMATION_ENABLED=true` only after the release-PR path is ready;
- install `RELEASE_PLEASE_TOKEN` as a least-privilege repository secret that
  can update the generated version/changelog PR but cannot publish releases;
- install a separate `SOFTWARE_RELEASE_TOKEN` only in the protected
  `software-release` environment and authorize that identity to create `v*`
  tags and draft releases;
- configure a separate non-bypass identity and negatively test unauthorized tag
  creation, tag update/deletion, release publication, and asset replacement,
  retaining the expected denials;
- generate and review the Release Please PR for the release candidate;
- configure and review the `dev` and `staging` target environments with
  publisher secrets, required variables, and reviewer protections; configure
  `RESONATE_IAC_DISPATCH_TOKEN` separately as an Actions secret available to
  Deploy Handoff;
- run Release Deployment `preview` and, after approval, one real `publish`
  against an approved exact SHA; retain its plan, image evidence, manifest,
  and explicit `deploy` decision;
- run the Software Release `preview` mode with matching `ci_run_id` and
  `image_run_id`, then retain its evidence;
- run one real software release and link its tag, source SHA, CI, artifacts,
  provenance, deployment state, and rollback target on #1593;
- complete desktop signing/notarization before calling those packages
  production-trusted;
- verify live IaC, analytics, and contract deployment boundaries with their
  owners and environment credentials, with the independent IaC release
  contract tracked in [resonate-iac#213](https://github.com/akoita/resonate-iac/issues/213).

Until those items exist, the feature remains `in-progress`.
