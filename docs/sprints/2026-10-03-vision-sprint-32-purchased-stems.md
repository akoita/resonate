# Vision Sprint 32: Purchased stems ready to remix

**Status:** Owner-approved; queued after Sprint 30 and 31 acceptance. No start
date or capacity estimate is set.
**Milestone:** [34](https://github.com/akoita/resonate/milestone/34).
**Goal:** A buyer can find purchased stems in the library, understand the
license they bought, and open eligible stems in Remix Studio.

Direction: [RFC: Taste Engine §5](../rfc/taste-engine.md) ·
[Crate Digger](../features/crate_digger.md) ·
[milestone plan](../roadmap/2026-10-taste-engine-milestones.md) ·
epic [#1952](https://github.com/akoita/resonate/issues/1952).

## Approved scope and order

| Order | Issue | Outcome |
| --- | --- | --- |
| First | [#2023](https://github.com/akoita/resonate/issues/2023) | Preserve the buyer's passkey smart-account wallet address through wallet refresh |
| Then | [#2042](https://github.com/akoita/resonate/issues/2042) | Give buyers a post-purchase route to owned stems, clear license details, and Remix Studio actions allowed by that license |

The order is a preference, not a hard dependency. The buyer-library work can
proceed independently of wallet preservation. The implementation choice in
#2042 remains open: improve Library › Stems or give buyers a separate home.
The issue suggests improving Library › Stems first, but this sprint does not
settle that design question.

## Existing work and remaining gap

Closed [#1175](https://github.com/akoita/resonate/issues/1175) and
[PR #1185](https://github.com/akoita/resonate/pull/1185) established Library
stem rows with source-track links and an eligibility-backed Remix action.
Closed [#1173](https://github.com/akoita/resonate/issues/1173) added
in-session purchase settling on a stem page, but did not verify the complete
purchase-to-library-to-Studio path across reloads and wallet refresh. Sprint 32
must verify that end-to-end path.

Keep [#2041](https://github.com/akoita/resonate/issues/2041),
[#2030](https://github.com/akoita/resonate/issues/2030),
[#1976](https://github.com/akoita/resonate/issues/1976), and
[#2012](https://github.com/akoita/resonate/issues/2012) deferred. They are not
prerequisites or admitted scope for this sprint.

## Exit criteria

- After a purchase, the handoff opens the owned stem in Library › Stems, and
  the buyer can find purchases from a buyer entry point distinct from seller
  listing management.
- The seller Listing Manager's empty state points buyers to their purchased
  stems.
- Owned stems show the license tier. Remix and commercial holdings expose a
  working Remix Studio action; personal holdings offer an upgrade path without
  implying remix rights.
- After page reload and each wallet refresh route, the buyer can follow the
  purchase → Library → Remix Studio path for the purchased eligible stem.
- While purchase registration is pending, the UI says so honestly. The client
  never grants rights; server-verified ownership and the purchased license
  determine eligibility.
- The in-app User Guide explains where purchased stems live and how license
  eligibility controls the remix action.

## Verification

- Backend coverage checks address preservation through
  `/wallet/aa/enable`, `/wallet/aa/refresh`, and `/wallet/agent/enable`,
  plus server-side purchase and license eligibility.
- Browser and authenticated-route checks follow purchase → Library → Studio
  through reload and wallet refresh, including the registration-pending state
  and buyer authorization boundaries.
- Authorization tests confirm that another user cannot read the buyer's
  purchased stems or gain Remix eligibility from client-supplied state.
- Update the relevant marketplace, library, and Remix Studio feature pages and
  the in-app User Guide.

## Revenue line

Line 3, marketplace take-rate, phase 2 (ADR-BM-6). Purchases remain voluntary
and quoted. Artists receive at least 85% of each transaction; this sprint
changes no fee, split, or payout (ADR-BM-4).
