# Vision Sprint 12 — Production Controls And Trust

> **Status:** Closed 2026-08-26 — all seven milestone issues reached their
> finite sprint outcomes. Maintenance-window-dependent release and cache
> evidence remain explicitly tracked outside the milestone.

- **Milestone:** [14 — Vision Sprint 12](https://github.com/akoita/resonate/milestone/14)
- **Revenue line / phase:** vision-neutral platform quality supporting every
  Business Model v2 revenue line. No fee, payout, licensing, custody, or
  production-go decision changed in this sprint.
- **Window:** no fixed dates were assigned; the milestone closed when its
  production-control and trust outcomes became observable.

## Sprint Goal

Make release, repository, verification, artwork-cache, player, and production
target decisions trustworthy enough to support later production work without
claiming that production or a SemVer software release occurred.

## Outcome

All seven assigned issues are closed. The sprint established a release-gated
deployment plane, enabled the repository security baseline, corrected
verification claims, versioned mutable artwork URLs, chose migrate-first for
the production GCP target, completed the planned player-control improvements,
and converted the release process from an open-ended sprint blocker into a
finite repository contract with explicit operational follow-up.

| Issue | Observable outcome |
| --- | --- |
| [#477](https://github.com/akoita/resonate/issues/477) | Verification badges and product copy now distinguish automated, process-backed, and externally verified claims instead of overstating trust. |
| [#1539](https://github.com/akoita/resonate/issues/1539) | GitHub's recommended repository security baseline was evaluated and enabled with durable evidence for the supported controls. |
| [#1593](https://github.com/akoita/resonate/issues/1593) | The monorepo release contract, fail-closed evidence controls, protected tag/environment settings, and read-only Release Please preview are documented and evidenced. Credentialed enablement and the first real SemVer release remain with [#1667](https://github.com/akoita/resonate/issues/1667). |
| [#1604](https://github.com/akoita/resonate/issues/1604) | Mutable Release and Shows artwork now carries a revisioned URL/cache key while legacy reads remain available. Staging replacement, measurement, and bounded TTL selection remain with [#1666](https://github.com/akoita/resonate/issues/1666). |
| [#1613](https://github.com/akoita/resonate/issues/1613) | The production GCP target decision selected migrate-first with explicit readiness gates instead of silently treating the current staging project as production. |
| [#1614](https://github.com/akoita/resonate/issues/1614) | Player queue ordering, fair shuffle, persisted state, mute restoration, immersive mode, and library queue actions reached the intended user-facing outcome. |
| [#1658](https://github.com/akoita/resonate/issues/1658) | Ordinary CI remains validation-only; selected image publication and deployment handoff now require an explicitly dispatched, exact-source release gate and immutable manifest evidence. |

## Shipped Pull Requests

- Verification language: [#1628](https://github.com/akoita/resonate/pull/1628)
- Repository security baseline: [#1627](https://github.com/akoita/resonate/pull/1627)
- Release evidence and live controls: [#1623](https://github.com/akoita/resonate/pull/1623), [#1624](https://github.com/akoita/resonate/pull/1624), [#1668](https://github.com/akoita/resonate/pull/1668)
- Versioned mutable artwork and release-environment repair: [#1662](https://github.com/akoita/resonate/pull/1662), [#1665](https://github.com/akoita/resonate/pull/1665)
- Production GCP target decision: [#1664](https://github.com/akoita/resonate/pull/1664)
- Player queue/control and immersive-player delivery: [#1616](https://github.com/akoita/resonate/pull/1616), [#1617](https://github.com/akoita/resonate/pull/1617), [#1618](https://github.com/akoita/resonate/pull/1618), [#1619](https://github.com/akoita/resonate/pull/1619), [#1620](https://github.com/akoita/resonate/pull/1620), [#1621](https://github.com/akoita/resonate/pull/1621)
- Release-gated image publication and deployment: [#1661](https://github.com/akoita/resonate/pull/1661)

## Verification

Every shipped implementation or documentation PR passed its selected focused
tests and required repository checks before merge. Higher-risk release-plane
changes additionally passed supply-chain/security checks, release policy and
evidence tests, backend unit/integration checks, E2E, smart-contract, desktop
packaging, and build gates when selected by CI.

The closure PR updates documentation only. Its required CI result and merge SHA
become the closure source for the changelog-only milestone tag.

## Operational Follow-Up

These items remain open without keeping Vision Sprint 12 open:

- [#1666](https://github.com/akoita/resonate/issues/1666) — deploy the
  revisioned artwork contract to staging, use approved disposable fixtures,
  retain five-pair cache evidence, select a bounded nonzero TTL, and link the
  authoritative `resonate-iac` change and rollback.
- [#1667](https://github.com/akoita/resonate/issues/1667) — provision separate
  least-privilege release identities, retain non-bypass negative tests, enable
  Release Please explicitly, run the protected previews, and publish the first
  separately authorized evidence-linked SemVer software release.

Both follow-ups are intentionally unmilestoned until their maintenance or
release windows are agreed.

## Explicitly Not Shipped

- no SemVer `v*` software release or deployable release artifact;
- no production deployment, migration execution, DNS cutover, or production-go
  authorization;
- no claim that the evergreen production-readiness ledger
  [#1595](https://github.com/akoita/resonate/issues/1595) is complete;
- no completion claim for migrate-first execution
  [#915](https://github.com/akoita/resonate/issues/915) or its IaC work;
- no nonzero image-optimizer TTL until #1666 retains staging evidence;
- no release credential provisioning or automatic release enablement until
  #1667 is separately authorized.

## Milestone Closure

The milestone changelog uses the non-software tag
`milestone-14-vision-sprint-12`. It contains no deployable software artifacts
and must not trigger a `v*` software or desktop publication path. The GitHub
milestone closes only after that changelog release points to this closure
record's merged source and its workflow effects are checked.

The next sprint has not yet been selected. Its theme and scope must use the
four-axis milestone-planning process; no open issue is silently carried over.
