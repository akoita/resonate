# Vision Sprint 25: Artist management with reliable catalog status

**Status:** Implementation complete; release evidence recorded.
**Milestone:** [27](https://github.com/akoita/resonate/milestone/27).
**Goal:** An artist or authorized manager can see when an upload finishes and
manage the credited artist profile and catalog through explicit permissions.

## Capacity and order

There is one focused workstream, no due date, and no fixed issue-count or
calendar commitment. Sprint 24 closed all five admitted issues, so there is no
carry-over. This sprint admits three issues: a bounded catalog-status fix first,
then the larger management and transfer model, followed by the listener-library
removal fix. If the design of #1762 exposes
work that cannot meet its full acceptance criteria in this window, re-plan the
scope explicitly rather than closing a partial parent issue.

| Order | Issue | State | Prerequisite state | Observable exit |
| --- | --- | --- | --- | --- |
| 1 | [#1836](https://github.com/akoita/resonate/issues/1836) — refresh catalog status | Implemented in [PR #1843](https://github.com/akoita/resonate/pull/1843); merged | None declared | Release and track processing or failure status updates without reload; a bounded fallback stops once processing ends; search, tab, scroll, and dialogs persist. |
| 2 | [#1762](https://github.com/akoita/resonate/issues/1762) — delegated management and transfer | Implemented in [PR #1853](https://github.com/akoita/resonate/pull/1853); merged | [#1492](https://github.com/akoita/resonate/issues/1492) is closed/satisfied by [PR #1835](https://github.com/akoita/resonate/pull/1835) | A documented authority model, scoped grants and transfers, migration path, UI/API states, and focused authorization tests meet the issue's full acceptance criteria. |
| 3 | [#1837](https://github.com/akoita/resonate/issues/1837) — library removal | Implemented in [PR #1854](https://github.com/akoita/resonate/pull/1854); merged | None declared | Listeners can remove non-owned tracks, artist and album groups, and selections through visible confirmed actions; errors do not show false success, and owned stems explain why they stay. |

There is no dependency cycle. #1836 precedes #1762 to clear the smaller
artist-facing defect before the larger authorization work; it is not a product
prerequisite. For #1762, settle the domain model and authorization matrix
before changing persistence or UI. Credited identity, profile editing, release
management, rights, and financial authority remain separate. Neither a name
match nor uploading a release grants profile control.

## Deferred work

| Issue | State | Clearing action |
| --- | --- | --- |
| [#1450](https://github.com/akoita/resonate/issues/1450) — engagement marts | #1492 satisfied; #1449 is a beneficial signal input, not a hard dependency | Give warehouse models and serving export a separate data workstream. |
| [#1763](https://github.com/akoita/resonate/issues/1763) — profile enrichment | Profile authority model implemented under #1762 | Resolve sources, image rights, confidence, and apply permissions in its own scope. |
| [#1663](https://github.com/akoita/resonate/issues/1663), [#1667](https://github.com/akoita/resonate/issues/1667), [#1583](https://github.com/akoita/resonate/issues/1583) — migration, release, production launch | External operator and owner gates | Keep these outside this application sprint until their separate evidence and authorization are ready. |

## Exit and business-model boundary

All admitted issues must close with focused validation and synchronized
feature and User Guide content. #1836 must show both socket and missed-event
fallback behavior. #1762 must prove authorized, denied, revoked, and transferred
access without changing rights or payout authority by implication. #1837 must
prove successful and failed removal, group and bulk scope, and owned-item
guidance without deleting source audio or purchase rights.

This is vision-neutral quality and identity infrastructure under ADR-BM-6.
It supports trustworthy artist workflows across revenue lines without changing
fees, splits, licensing, payouts, or the ADR-BM-4 red lines.

## Closeout evidence

All three admitted issues are closed. #1836 shipped in PR #1843, #1762 in PR
#1853, and #1837 in PR #1854. The last application change merged at
`0163c716cd073457aaa193dc1c8191c67a0bfcef`; its exact `main` CI run
[passed](https://github.com/akoita/resonate/actions/runs/35866400424). #1837
also passed its focused local removal, scanner, and help tests, changed-file
lint, TypeScript, and the PR's backend integration and E2E checks.

The [staging release preview](https://github.com/akoita/resonate/actions/runs/35866500739)
validated that exact SHA and CI run. The
[publish and handoff run](https://github.com/akoita/resonate/actions/runs/35866549637)
succeeded and retained a deploy manifest plus image evidence for frontend,
backend, and Demucs. Private infrastructure reconciliation and live deployment
evidence are tracked in resonate-iac#249. A next milestone has not yet been
selected. #1450, #1763, #1663, #1667, and #1583 remain outside Sprint 25 with
their existing owners and gates.
