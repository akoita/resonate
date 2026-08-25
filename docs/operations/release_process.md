# Software Release Operations

This runbook implements the [release and versioning decision](../architecture/release_process.md).
It is an operator/developer procedure, not an end-user feature.

## Current State

The target process is defined, but issue
[#1593](https://github.com/akoita/resonate/issues/1593) remains open until the
automation, repository settings, dry run, and first real release have evidence.
Do not create a `v*` tag manually while that work is incomplete.

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

## CI Dry Run

First run **Release Please → Preview Release Plan** for a full main SHA to
retain the read-only version proposal. After the generated release PR is merged
and its exact main CI run succeeds, run **Software Release** with `mode=preview`,
that full SHA, and the numeric CI run ID. Preview mode uses only read access; it
downloads and validates the digest-bound deploy/image evidence, renders release
notes and a release-evidence archive, and asserts that neither the proposed tag
nor GitHub Release exists.

The workflow validates the deploy manifest before downloading image evidence. It
fetches exactly `image-evidence-<service>-<candidate_sha>` for each selected
allowlisted service into its service directory; a valid manifest with no
selected services downloads no image artifact and still passes through the
evidence validator.

Record the workflow URL, source SHA, rendered plan checksum, and validation
result on #1593. A local fixture test is not the acceptance dry run because it
cannot prove GitHub permissions, artifact lookup, or repository settings.

## Protected Controls And Credential Boundaries

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

Retain the workflow URL, control-validation result, rendered release plan,
release-evidence archive, deploy manifest, and `SHA256SUMS` with the release
record. Before enabling publication, negatively test unauthorized tag creation,
tag update/deletion, release publication, and asset replacement; retain the
expected denials and actor context without recording token contents.

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
6. Confirm each required image evidence artifact contains build metadata,
   CycloneDX SBOM, signature verification, SBOM-attestation verification, and
   build-attestation verification bound to the same SHA and digest.
7. Confirm the deploy manifest and any analytics, desktop, contract, or IaC
   evidence. State explicitly which units were not built or deployed.
8. Run `preview` mode again against the approved commit and retain the plan.

## Publish

Start the publication mode only for the approved release commit. The workflow
must:

1. verify the commit is reachable from `main` and is the merged release PR
   commit;
2. verify required CI succeeded for that exact SHA;
3. revalidate version consistency, release-note completeness, and all selected
   evidence;
4. fail if the tag or GitHub Release already exists;
5. obtain approval from the protected `software-release` environment;
6. create the immutable `v*` tag at the approved SHA;
7. create the GitHub Release without `--clobber`, marking `-rc.N` as a
   prerelease;
8. attach durable checksums/evidence required by policy and verify the published
   release still points to the expected SHA.

Publication does not itself authorize production deployment. Record deployment
state and the external handoff precisely.

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
2. Select a reconciled last-known-good release, full SHA, immutable digest, and
   deploy manifest.
3. Revalidate signer identity, attestations, declared digest, registry digest,
   and environment before redeployment.
4. Redeploy by digest through `resonate-iac`; never retag a mutable image as the
   previous version.
5. For contracts, use the documented pause/timelock/upgrade/replacement path and
   record chain-specific state. Do not imply that source rollback reverses a
   transaction.
6. Verify live revision/state and update the release with an incident notice or
   known limitation. Do not move/delete the original tag or overwrite assets.

Follow [Supply-Chain Incident Response](supply_chain_incident_response.md) for
containment, evidence preservation, credential rotation, and reconciliation.

## Failed Or Suspicious Publication

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

The following cannot be proven by this documentation PR:

- configure and audit immutable `v*` and `milestone-*` tag rules;
- configure the protected `software-release` environment and reviewer;
- add `RELEASE_AUTOMATION_ENABLED=true` only after the release-PR path is ready;
- install `RELEASE_PLEASE_TOKEN` as a least-privilege repository secret that
  can update the generated version/changelog PR but cannot publish releases;
- install a separate `SOFTWARE_RELEASE_TOKEN` only in the protected
  `software-release` environment and authorize that identity to create `v*`
  tags and draft releases;
- set the environment variables `RELEASE_TAG_RULESET_ID` and
  `MILESTONE_TAG_RULESET_ID` to the active numeric ruleset IDs validated by the
  publication workflow;
- negatively test unauthorized tag creation, tag update/deletion, release
  publication, and asset replacement, retaining the expected denials;
- run the read-only Actions dry run and retain its evidence;
- run one real software release and link its tag, source SHA, CI, artifacts,
  provenance, deployment state, and rollback target on #1593;
- complete desktop signing/notarization before calling those packages
  production-trusted;
- verify live IaC, analytics, and contract deployment boundaries with their
  owners and environment credentials.

Until those items exist, the feature remains `in-progress`.
