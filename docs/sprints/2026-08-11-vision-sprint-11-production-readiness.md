# Vision Sprint 11 — Production Readiness, Not Production

> **Status:** Closed 2026-08-11 — the scoped implementation goal was met.
> Production go-live remains blocked by the broader readiness ledger
> [#1595](https://github.com/akoita/resonate/issues/1595).

- **Milestone:** [13 — Vision Sprint 11](https://github.com/akoita/resonate/milestone/13)
- **Revenue line / phase:** vision-neutral launch-quality work supporting the
  future activation of revenue line 1 (Shows campaign fees). No fee, split,
  price, custody, or production-go decision changed in this sprint.
- **Window:** no fixed dates were assigned; closed when the selected slices
  reached observable completion.

## Sprint Goal

Make the surfaces a first real user would touch—Home, Drops, checkout, and
escrow operations—more correct, fast, observable, and releasable, while
keeping production explicitly out of scope.

## Outcome

The sprint landed the intended outcome for all nine focused
implementation/spike slices assigned to the milestone. Eight issues are fully
complete; #1593's repository foundation landed while its external acceptance
evidence carries forward:

| Issue | Observable outcome |
| --- | --- |
| [#1491](https://github.com/akoita/resonate/issues/1491) | Home performance was measured against an explicit budget; the Drops-card flash/jank and heavy first-paint behavior were corrected, with bounded hardening follow-ups kept separate. |
| [#1510](https://github.com/akoita/resonate/issues/1510) | `/drops` became the dedicated collection gallery, distinct from the licensing Marketplace. |
| [#1534](https://github.com/akoita/resonate/issues/1534) | Operators can acknowledge known-foreign escrow campaigns without hiding new reconciliation mismatches. |
| [#1542](https://github.com/akoita/resonate/issues/1542) | The Lyria 3.5/source-grounded mixing question was timeboxed and recorded as strategy evidence rather than allowed to become open-ended implementation. |
| [#1566](https://github.com/akoita/resonate/issues/1566) | The Home Drops collectible card no longer clips or overflows on mobile. |
| [#1567](https://github.com/akoita/resonate/issues/1567) | The Shows escrow indexer uses a distributed lease so horizontally scaled API instances do not duplicate indexing work. |
| [#1581](https://github.com/akoita/resonate/issues/1581) | x402 checkout shows the server-authored platform fee as included in the unchanged total. |
| [#1593](https://github.com/akoita/resonate/issues/1593) | PR [#1610](https://github.com/akoita/resonate/pull/1610) established the monorepo SemVer/changelog and evidence-validated release automation foundation. The issue remains open for external controls and live release evidence. |
| [#1597](https://github.com/akoita/resonate/issues/1597) | The hosted-wallet/recovery evaluation produced a bounded migration decision rather than beginning an unplanned wallet migration. |

Relevant validation is retained on each issue/PR. The final release-process PR
passed the full application CI, security baseline, backend integration, E2E,
contract, desktop packaging, and build checks before merge.

## Carry-over

- [#1593](https://github.com/akoita/resonate/issues/1593) — code and docs landed,
  but protected GitHub controls, one retained dry run, and one real software
  release with evidence are still required. It was removed from Sprint 11 and
  reopened rather than silently claiming completion.
- [#1595](https://github.com/akoita/resonate/issues/1595) — the whole-app
  production-readiness ledger is an evergreen epic, not one sprint-sized
  implementation. It remains the denominator for the later go/no-go decision.
- Bounded Home hardening follow-ups
  [#1604](https://github.com/akoita/resonate/issues/1604) and
  [#1605](https://github.com/akoita/resonate/issues/1605) remain independent
  candidates rather than hidden leftovers from #1491.

## Explicitly Not Shipped

- no production go-live or owner GO decision;
- no production Shows contract deployment or controlled cohort launch;
- no claim that the full #1595 legal, privacy, security, gating, support, or
  infrastructure ledger is complete;
- no enablement of unsigned desktop artifacts or gated AI/community surfaces;
- no real SemVer software release before the protected controls and dry run are
  configured and retained.

## Milestone Closure

The milestone changelog uses the non-software tag
`milestone-13-vision-sprint-11`. It must not contain deployable software
artifacts or trigger the `v*` software-release path. The next sprint is selected
separately through the four-axis milestone-planning process; no issue is
silently reassigned by this closure record.
