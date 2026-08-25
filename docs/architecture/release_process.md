# Release And Versioning Process

## Status

Accepted process direction; automation and release evidence are in progress in
[issue #1593](https://github.com/akoita/resonate/issues/1593).

This decision is vision-neutral infrastructure work (`vision:keep`). It does
not introduce a fee, payout, price, or new product behavior.

## Context

Resonate is a mixed monorepo. It contains the web application, backend, desktop
application, Demucs and stable-audio workers, analytics Dataflow code, smart
contracts, and infrastructure handoffs. These surfaces can be built or deployed
independently, but they share source history, product contracts, and operational
compatibility.

Sprint closure already produces a human-readable GitHub Release. That report is
not a software version: it can describe several commits and deferred work
without asserting that a specific artifact was built or deployed. Conversely, a
software release must identify one reviewed source commit and its exact build
and deployment evidence.

## Decision

### One platform release train

Resonate uses one platform version for all first-party source in this
repository. Software release tags use Semantic Versioning:

```text
vMAJOR.MINOR.PATCH
vMAJOR.MINOR.PATCH-rc.N
```

The version describes a compatible snapshot of the whole repository. A release
may build or deploy only the units changed since the previous version, but all
units are interpreted against the tagged source snapshot. Resonate does not use
separate `desktop-v*`, `contracts-v*`, or worker versions.

| Source unit | Release output or evidence | Deployment identity |
| --- | --- | --- |
| Web | frontend OCI image and build metadata | source SHA plus image digest |
| Backend | backend OCI image and database migration notes | source SHA plus image digest and migration state |
| Desktop | Windows, macOS, and Linux packages | source SHA plus asset checksum; signing identity when available |
| Demucs worker | CPU/GPU worker OCI image | source SHA plus image digest |
| Stable-audio worker | GPU worker OCI image | source SHA plus image digest |
| Analytics | Dataflow image and Flex Template | source SHA, image digest, and immutable template reference |
| Smart contracts | source, ABI, verification, and deployment handoffs | chain ID, address, transaction hash, ABI hash, and implementation/proxy identity |
| Infrastructure handoffs | deploy manifest and `resonate-iac` dispatch reference | source SHA, release/deploy ID, immutable image references, and IaC revision |

Package versions remain private metadata; this process does not publish npm
packages. SemVer tags also never replace immutable SHA, digest, contract, or
deployment identities.

### Milestone changelogs are separate

Closing a sprint remains a required changelog event. Milestone tags use a
non-SemVer namespace:

```text
milestone-<github-milestone-number>-<slug>
```

A milestone release lists shipped pull requests, verification, carry-over with
linked open issues, and the next milestone. It has no software artifacts and
must not trigger the software-release workflow. Closing a milestone never
closes an unfinished parent feature or implies a deployment.

### Semantic Versioning

- `MAJOR` changes when a supported public API, agent contract, protocol
  interface, persisted-data contract, desktop compatibility contract, or
  operational contract breaks without a backward-compatible transition.
- `MINOR` adds backward-compatible product or platform capability.
- `PATCH` fixes behavior, documentation needed to operate the release, or
  internal quality without intentionally breaking a supported contract.
- `-rc.N` is a release candidate. It is a GitHub prerelease and does not imply
  production approval. Each changed candidate gets a new increasing `N`; tags
  are never reused.
- While the platform is below `1.0.0`, an intentional breaking change increments
  `MINOR` and must still be called out under API/contract changes and migrations.

The release PR decides the next version from merged Conventional Commit
metadata. Maintainers may correct the proposed version during review when a
change's compatibility impact is not expressed accurately by its commit type.

### Source and approval policy

A software tag points to exactly the approved release commit on `main`. The
commit must be reachable from `main`, have successful required CI for the same
SHA, and contain the reviewed version and changelog changes. Publication is a
separate, protected operation after that evidence exists.

Release Please manifest mode is the selected version-PR and changelog engine.
It fits the existing Conventional Commit history, produces a reviewable release
PR, works without publishing private packages, and can update extra files for a
mixed monorepo. Changesets is not selected because its main advantage is
coordinating independently published packages, while Resonate has one platform
train and several non-package source units.

Release Please does not authorize deployment and must not publish a GitHub
Release before evidence validation. A repository workflow owns final tag and
release creation from the approved commit.

### Release-gated deployment plane

Validation and release mutation are separate. Pull-request, merge-queue,
`main`, and `develop` CI may build or test for validation, but they do not
publish deployable images, write a Dataflow template, create a deploy manifest,
or dispatch `resonate-iac`. The `main` post-merge run is a lightweight receipt;
the reusable `CI` invocation used by a release is the full exact-source gate.

Application publication belongs to the manual-only
`.github/workflows/release-deployment.yml` workflow. Its operator supplies
`mode=preview|publish`, `release_kind=planned|on-demand`, a full `source_sha`,
the successful `ci_run_id` for that SHA, `environment=dev|staging`, a
canonical service selection (all four services by default), and a `deploy` boolean. `dev`
maps to `develop`; `staging` maps to `main`; production remains manual and
`resonate-iac`-owned.

Preview validates the source, CI run, branch mapping, service selection, and
environment without cloud credentials or mutation, then retains a release
plan. Publish reruns reusable CI on the exact source and invokes the
workflow-call-only `publish-deployable-images.yml` workflow. The publisher
creates selected full-SHA-tagged images, resolves registry digests, and
retains provenance evidence. Valid unchanged content-addressed images may be
reused, with the result recorded in build metadata and image evidence.

The target environment is serialized so concurrent releases cannot race. A
partial or failed image publication never dispatches a partial manifest. A
successful publication may intentionally set `deploy=false`. Deploy Handoff is
reusable via `workflow_call` only from a successful explicitly dispatched
Release Deployment run. Its separate manual `workflow_dispatch` path accepts
`release_run_id` for retry or rollback of a retained immutable digest manifest
without rebuilding or retagging images. It has no `workflow_run` trigger and
never follows ordinary CI.

Analytics Dataflow publication is a separate `workflow_dispatch`-only path. It
requires `source_sha` to equal the dispatch revision and the target branch
(`develop` for `dev`, `main` for `staging`).

### Protected release plane

Repository settings must enforce these controls:

- protect `v*` and `milestone-*` from deletion, update, and unauthorized
  creation;
- allow software-tag creation only through the reviewed release automation
  identity;
- require a protected `software-release` environment with a human reviewer for
  publication;
- protect the `dev` and `staging` target environments that hold image and
  Dataflow publisher credentials and any deployment approvals;
- keep default workflow permissions read-only and grant `contents: write` only
  to the final publication job;
- do not permit asset replacement, tag movement, or release recreation;
- retain audit evidence for release-environment, ruleset, actor, and workflow
  changes.

These are external GitHub settings. Checked-in validation can describe and
audit them but cannot prove enforcement by itself.

## Release Evidence Contract

A software release is valid only when its notes identify:

- the full source SHA and approved release PR;
- the successful CI run for that SHA and the successful explicit Release
  Deployment image run for that same SHA;
- every included OCI image by digest, with build metadata, SBOM, signature, and
  attestation verification;
- the deploy manifest and any `resonate-iac` handoff or an explicit statement
  that deployment did not occur;
- desktop assets and checksums, or an explicit statement that desktop artifacts
  were not produced;
- analytics image/template evidence when analytics changed;
- contract ABI/deployment/verification evidence when contracts changed, or an
  explicit statement that no chain deployment occurred;
- migrations, security notes, known limitations, deferred work, and a
  last-known-good rollback reference.

Evidence validation fails closed when a required record is absent, malformed,
bound to a different SHA, or uses a mutable image reference.

Software Release therefore requires both `ci_run_id` and `image_run_id`; the
candidate SHA, referenced CI run, and referenced image run must all identify
the same approved source. A release may state that no deployment occurred when
the image run intentionally used `deploy=false`.

## Hotfix And Rollback Rules

A hotfix is a normal reviewed PR based on the current supported source, followed
by a new patch version and a new immutable tag. An emergency must not move an
existing tag or overwrite release assets.

Rollback means redeploying a previously verified source/artifact identity, not
rewriting release history. Application and worker rollback uses the recorded
last-known-good image digest and deploy manifest. Desktop releases remain
available with an incident notice unless there is a security reason to remove a
download. Contract recovery follows the protocol pause, timelock, upgrade, or
replacement runbook; an irreversible on-chain action cannot be rolled back by a
Git tag.

## Consequences And Remaining Evidence

The shared train favors product compatibility and a simple public version over
independent component cadence. Release notes therefore must say which units
were built and deployed. A version can be published without a production
deployment, but it must say so plainly.

The process remains `in-progress` until all automation and validation land, the
tag/environment controls are configured and negatively tested, one read-only
dry run succeeds, and one real software release records durable evidence. Code
signing/notarization, live infrastructure reconciliation, and contract
deployment evidence remain owner-controlled external boundaries.

See the [operator runbook](../operations/release_process.md) and
[feature page](../features/release_process.md).
