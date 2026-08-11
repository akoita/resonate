---
title: "Release And Versioning Process"
status: in-progress
owner: "@akoita"
---

# Release And Versioning Process

## Status

`in-progress` — the release contract and templates are documented, but issue
[#1593](https://github.com/akoita/resonate/issues/1593) remains open until the
automation, protected GitHub settings, one CI dry run, and one real software
release have durable evidence.

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

## How To Use And Test It

Developers should use the local read-only preview before reviewing a Release
Please PR. Operators then run the CI `preview` mode for the exact approved
source SHA, review the rendered release plan and evidence gaps, and use the
protected publication mode only after the release PR merges and CI succeeds.

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

## Evidence And Remaining Work

Current supporting evidence includes the Release Please manifest/configuration,
read-only preview, release-policy and evidence validators, protected publication
workflow, immutable desktop finalizer, SHA-tagged OCI builds, digest-bound deploy
manifests, CycloneDX SBOMs, signatures, attestations, and release-plane audit
artifacts. The following external evidence remains required before this feature
can become `implemented`:

- protected tag rules and `software-release` environment approval;
- the dedicated Release Please PR identity/secret, separate protected software
  publisher identity/secret, tag-ruleset ID, and explicit enable flag;
- one successful read-only dry run with its workflow/artifact links;
- one real software release with exact source, artifacts, provenance,
  deployment state, known limitations, and rollback evidence;
- owner verification of desktop signing/notarization and external IaC/contract
  boundaries where applicable.

The source of truth for tracked completion is
[#1593](https://github.com/akoita/resonate/issues/1593). A milestone closing
does not close that issue while these items remain.
