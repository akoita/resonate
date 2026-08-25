# Issue #1593 sprint-completion plan

## Outcome

Close Vision Sprint 12 without discarding the operational work still needed for
the first real SemVer software release. Issue #1593 will represent the completed
repository release contract and evidenced live controls. The intentionally
unmilestoned operational follow-up [#1667](https://github.com/akoita/resonate/issues/1667)
owns separate Release Please/software-publisher credentials, explicit
enablement, negative identity tests, the generated Release Please PR, Software
Release preview, and the first authorized real release when an authorized
release window exists.

No step in this branch creates a tag, GitHub Release, credential, deployment,
migration, or production change.

## Evidence already complete

- PR #1610 established the canonical monorepo release process, release notes,
  Release Please configuration, SemVer policy, and operator documentation.
- PR #1623 hardened immutable release evidence and fail-closed validation.
- PR #1624 recorded active `v*` and `milestone-*` tag rulesets, the protected
  `software-release` environment, and a successful read-only Release Please
  preview against source `ef9ed481e40d514ed9d21d7a97b443370b09904c`.
- PR #1661 subsequently separated validation from selected-service image
  publication and deployment, and requires an exact-source release gate.
- The repository keeps deployment identity on immutable source SHAs and image
  digests; SemVer does not replace those identities.

## Sprint boundary

Issue #1593 can close after a reviewable documentation PR does all of the
following; none of these documentation changes claim that an operational action
has occurred:

1. Reframe #1593 around the repository contract and live read-only controls
   already delivered and evidenced.
2. Link the existing, intentionally unmilestoned operational follow-up
   [#1667](https://github.com/akoita/resonate/issues/1667), which owns:
   - a least-privilege `RELEASE_PLEASE_TOKEN`;
   - a separate protected-environment `SOFTWARE_RELEASE_TOKEN`;
   - explicit enablement of `RELEASE_AUTOMATION_ENABLED=true`;
   - unauthorized-actor negative tests for tag and environment controls;
   - generated Release Please PR and Software Release preview evidence;
   - one authorized real software release with source, CI, image, desktop,
     SBOM, provenance, deployment-state, and rollback evidence;
   - applicable desktop signing/notarization and external IaC, analytics, and
     contract release boundaries.
3. Update release feature and operator documentation so it names that follow-up
   as the remaining owner and does not imply a real release has occurred.
4. Keep the release feature marked `in-progress` until the operational
   follow-up closes, even though the sprint issue closes.
5. Make the closing PR use `Closes #1593`; do not auto-close #1667.

## Milestone closure

After the closing PR merges and Vision Sprint 12 has no open issues:

1. Verify every milestone issue is closed or explicitly transferred to an
   unmilestoned follow-up.
2. Close milestone 14.
3. Publish the required changelog-only milestone release using a non-SemVer
   `milestone-*` tag. Its notes must distinguish repository work shipped in the
   sprint from the first real software release tracked in
   [#1667](https://github.com/akoita/resonate/issues/1667) and staging cache-TTL
   validation tracked in [#1666](https://github.com/akoita/resonate/issues/1666).
4. Do not represent the milestone release as a deployable software version and
   do not create a `vMAJOR.MINOR.PATCH` tag.

Milestone closure and its changelog release remain separate, explicitly
approved GitHub writes performed only after the branch PR merges.

## Files and validation

Expected repository changes after plan approval:

- `docs/features/README.md`: link #1667 as the remaining-work owner while
  retaining `in-progress` status.
- `docs/features/release_process.md`: separate delivered controls from
  operational enablement and first-release evidence.
- `docs/operations/release_process.md`: link the operational owner and preserve
  the existing fail-closed credential and release procedures.
- this plan: record #1667 as the final follow-up owner and milestone-release
  evidence.

Focused validation:

- `npm run release:check`
- release-control and release-evidence Python tests
- workflow trigger policy validation when workflow references change
- documentation link/search checks
- `git diff --check`

No full monorepo build is warranted for a documentation-only sprint-boundary
change. CI remains responsible for the repository-wide required gates.

## Change-impact and business-model review

The change affects documentation, roadmap alignment, and release operations.
It does not change product UX, APIs, analytics, permissions, application data,
fees, payouts, licensing, or deployment state. It is vision-neutral
infrastructure/process work under `vision:keep`.
