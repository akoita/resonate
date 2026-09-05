---
title: "Release And Versioning Process"
status: in-progress
owner: "@akoita"
---

# Release And Versioning Process

## Status

`in-progress` — the release contract and templates are documented, and the
fail-closed repository validators, protected GitHub controls, and read-only
Release Please preview are proven. Issue [#1593](https://github.com/akoita/resonate/issues/1593)
closes through this documentation boundary; unperformed operational work is
owned by the intentionally unmilestoned [#1667](https://github.com/akoita/resonate/issues/1667).
The feature remains `in-progress` until #1667 closes.

## Who This Is For

- release, security, infrastructure, and protocol operators;
- developers preparing a release PR or compatibility change;
- agents that need to distinguish a sprint report from a deployable release.

This is not an end-user feature, so it does not add an in-app User Guide
article.

## Value

The process gives the whole monorepo one human-facing Semantic Version while
preserving the immutable identities that actually prove what was built and
deployed. It prevents a milestone changelog from being mistaken for a software
release and makes missing artifact, provenance, migration, or rollback evidence
a visible release blocker.

## Current Contract

- Software releases use one platform train: `vMAJOR.MINOR.PATCH`, with
  `-rc.N` prereleases.
- The train covers web, backend, desktop, Demucs, stable-audio, analytics,
  contracts, and infrastructure handoffs.
- Milestone changelogs use `milestone-<number>-<slug>`, contain no software
  artifacts, and never trigger software publication.
- A SemVer identifies a repository snapshot; full source SHA, OCI digest,
  desktop checksum, contract address/transaction/ABI hash, deploy manifest, and
  external IaC revision remain the authoritative build/deployment identities.
- Release Please manifest mode prepares the reviewable version/changelog PR.
  A separate protected workflow validates evidence and publishes the immutable
  tag and GitHub Release.
- Ordinary PR, merge-queue, `main`, and `develop` CI is validation-only. The
  `main` post-merge run is a lightweight receipt; it does not publish images or
  deploy.
- The manual-only Release Deployment workflow accepts preview/publish,
  planned/on-demand, full source SHA, exact successful CI run ID, `dev` or
  `staging`, canonical service selection defaulting to all four services, and a deploy
  boolean. Preview retains a read-only plan. Publish reruns exact-source CI and
  invokes the workflow-call-only image publisher for SHA-tagged,
  digest-bound images and evidence, with safe content-addressed reuse.
- Deploy Handoff is reusable from Release Deployment and the stable release
  finalizer. A strict stable `vMAJOR.MINOR.PATCH` automatically hands its exact
  publish-only staging manifest to `resonate-iac` after desktop assets complete
  and the GitHub Release becomes public. Drafts, prereleases, milestones, and
  generic/manual releases cannot enter that path; a prior `deploy=true`
  handoff is not duplicated. Manual retry/rollback remains available, and
  Analytics Dataflow publication remains manual and exact-SHA bound.
- Software Release requires both `ci_run_id` and `image_run_id`, and all run
  identities must match the candidate SHA. `dev` maps to `develop`, `staging`
  maps to `main`, and production remains manual/IaC-owned.
- Before publication, the protected workflow requires numeric release and
  milestone ruleset IDs, a reviewed `software-release` environment with a
  required reviewer and protected-branch policy, active tag-scoped rules with
  creation/deletion/non-fast-forward protections, and an always-enabled bypass
  actor on each creation-protected ruleset.

## How To Use And Test It

Developers should use the local read-only preview before reviewing a Release
Please PR. Operators then run Release Deployment `mode=preview` for the exact
approved source SHA and successful CI run, review the retained plan and
evidence gaps, and use `mode=publish` only after the release PR merges and
exact-source validation succeeds. Target-environment concurrency, complete
aggregate publication, and immutable manifest checks prevent partial handoffs.

For Software Release, provide the matching successful `ci_run_id` and
`image_run_id`. The workflow validates both identities before protected tag and
draft creation. The tag-triggered desktop workflow then attaches the complete
platform artifacts, publishes a stable release, and starts its exact immutable
staging handoff. Production remains a separate manual IaC decision.

The release-evidence and release-controls unit tests cover malformed evidence,
missing note sections, missing reviewers, incorrect ruleset scope, incomplete
protections, and missing bypass actors. Before live enablement, operators also
retain negative-test denials for unauthorized tag creation/update/deletion,
release publication, and asset replacement alongside the workflow and evidence
artifacts.

Milestone operators follow the separate milestone closure section and never
create a `v*` tag for a sprint report. Hotfix and rollback procedures preserve
existing tags and redeploy previously verified immutable artifacts.

See:

- [architecture decision](../architecture/release_process.md)
- [operator runbook](../operations/release_process.md)
- [release-note template](../../.github/release-notes-template.md)
- [GitHub generated-note categories](../../.github/release.yml)
- [sprint working mode](../sprints/README.md)
- [supply-chain incident response](../operations/supply_chain_incident_response.md)

## Delivered Controls And Read-Only Evidence

Repository-delivered support includes the Release Please manifest/configuration,
the read-only preview path, release-policy/evidence/control validators, the
protected Software Release workflow, release-gated image/evidence contracts,
immutable desktop finalizer, stable-release staging handoff, and the CycloneDX
SBOM, signature, attestation, and release-plane audit mechanisms. The workflows
are designed to retain
rendered plans, control-validation results, deploy manifests, evidence archives,
and `SHA256SUMS`; this page does not claim that a tag, release, deployment, or
production action has occurred.
The live protected-control and Release Please preview evidence is recorded in
the [operator runbook](../operations/release_process.md#live-evidence-snapshot)
and the [preview workflow run](https://github.com/akoita/resonate/actions/runs/32797404994).

## Remaining Operational Work

The following work is unperformed and owned by the intentionally unmilestoned
[#1667](https://github.com/akoita/resonate/issues/1667) before this feature can
become `implemented`:

- the dedicated `RELEASE_PLEASE_TOKEN` and separate protected
  `SOFTWARE_RELEASE_TOKEN`, plus `RELEASE_AUTOMATION_ENABLED=true`;
- target `dev`/`staging` environment credentials, reviewer protections, and a
  retained Release Deployment preview and publish with matching CI/image run
  identities;
- a separate non-bypass identity and retained negative tests for unauthorized
  tag creation/update/deletion, release publication, and asset replacement;
- a generated and reviewed Release Please PR followed by a successful Software
  Release `preview` run;
- one real software release with exact source, artifacts, provenance,
  deployment state, known limitations, and rollback evidence;
- owner verification of desktop signing/notarization and credentialed live IaC,
  analytics, and contract boundaries where applicable. The independent IaC
  release contract is tracked in
  [resonate-iac#213](https://github.com/akoita/resonate-iac/issues/213).

Issue [#1593](https://github.com/akoita/resonate/issues/1593) is the repository
documentation boundary; #1667 is the source of truth for the remaining
operational work. A milestone closing does not close the feature while those
items remain.
