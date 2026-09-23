# Vision Sprint 25: Artist management with reliable catalog status

**Status:** in progress.
**Milestone:** [27](https://github.com/akoita/resonate/milestone/27).
**Goal:** An artist or authorized manager can see when an upload finishes and
manage the credited artist profile and catalog through explicit permissions.

## Capacity and order

There is one focused workstream, no due date, and no fixed issue-count or
calendar commitment. Sprint 24 closed all five admitted issues, so there is no
carry-over. This sprint admits two issues: a bounded catalog-status fix first,
then the larger management and transfer model. If the design of #1762 exposes
work that cannot meet its full acceptance criteria in this window, re-plan the
scope explicitly rather than closing a partial parent issue.

| Order | Issue | Prerequisite state | Observable exit |
| --- | --- | --- | --- |
| 1 | [#1836](https://github.com/akoita/resonate/issues/1836) — refresh catalog status | None declared | Release and track processing or failure status updates without reload; a bounded fallback stops once processing ends; search, tab, scroll, and dialogs persist. |
| 2 | [#1762](https://github.com/akoita/resonate/issues/1762) — delegated management and transfer | [#1492](https://github.com/akoita/resonate/issues/1492) is closed/satisfied by [PR #1835](https://github.com/akoita/resonate/pull/1835) | A documented authority model, scoped grants and transfers, migration path, UI/API states, and focused authorization tests meet the issue's full acceptance criteria. |

There is no dependency cycle. #1836 precedes #1762 to clear the smaller
artist-facing defect before the larger authorization work; it is not a product
prerequisite. For #1762, settle the domain model and authorization matrix
before changing persistence or UI. Credited identity, profile editing, release
management, rights, and financial authority remain separate. Neither a name
match nor uploading a release grants profile control.

## Deferred work

| Issue | State | Clearing action |
| --- | --- | --- |
| [#1837](https://github.com/akoita/resonate/issues/1837) — Library removal | Open, no declared prerequisite | Plan its track, album, artist, bulk, owned-item, and failure paths as a separate listener slice. |
| [#1450](https://github.com/akoita/resonate/issues/1450) — engagement marts | #1492 satisfied; #1449 is a beneficial signal input, not a hard dependency | Give warehouse models and serving export a separate data workstream. |
| [#1763](https://github.com/akoita/resonate/issues/1763) — profile enrichment | Profile authority decisions remain open under #1762 | Resolve sources, image rights, confidence, and apply permissions after the management model. |
| [#1663](https://github.com/akoita/resonate/issues/1663), [#1667](https://github.com/akoita/resonate/issues/1667), [#1583](https://github.com/akoita/resonate/issues/1583) — migration, release, production launch | External operator and owner gates | Keep these outside this application sprint until their separate evidence and authorization are ready. |

## Exit and business-model boundary

Both admitted issues must close with focused validation and synchronized
feature and User Guide content. #1836 must show both socket and missed-event
fallback behavior. #1762 must prove authorized, denied, revoked, and transferred
access without changing rights or payout authority by implication.

This is vision-neutral quality and identity infrastructure under ADR-BM-6.
It supports trustworthy artist workflows across revenue lines without changing
fees, splits, licensing, payouts, or the ADR-BM-4 red lines.
