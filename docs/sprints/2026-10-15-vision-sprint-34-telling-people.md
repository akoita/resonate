# Vision Sprint 34: Telling people what happens to them

**Status:** Owner-approved 2026-10-15; in progress. No due date: it closes when
its exit checks pass on staging.
**Milestone:** [36](https://github.com/akoita/resonate/milestone/36).
**Goal:** Before a real cohort, the platform can tell people what affects them
(operator notices, moderation, refunds owed), the operator can enforce, backers
see the refund risk before pledging, and artists see truthful payout numbers.

## Why this theme

Drafting the legal surface showed the platform cannot tell a person anything:
no operator notice, no moderation notice, no reminder of a refund owed, and no
way to suspend an abusive account. [#1777](https://github.com/akoita/resonate/issues/1777)
split those gaps into buildable issues with a build order. They sit on the
[#1595](https://github.com/akoita/resonate/issues/1595) readiness ledger: they
must be solved before real users. Sprint 33 also left payout analytics showing
gross sales where artists read "payout" ([#2144](https://github.com/akoita/resonate/issues/2144)).

## Approved scope and order

| Order | Axis | Issue | Outcome |
| --- | --- | --- | --- |
| 1 | Business value | [#2150](https://github.com/akoita/resonate/issues/2150) | The pledge step discloses, from the campaign's terms, that a refund after a deposit release can be smaller than the pledge |
| 2 | Usability | [#2146](https://github.com/akoita/resonate/issues/2146) | Operator broadcast and targeted notices, in-app and durable, including a notice to a user whose content was moderated |
| 3 | Business value | [#2147](https://github.com/akoita/resonate/issues/2147) | Operator account suspension and closure, enforced server-side, with a notice; refunds stay claimable |
| 4 | Known issue | [#2149](https://github.com/akoita/resonate/issues/2149) | Claimable-but-unclaimed Shows refunds are detected and backers are reminded in-app; scheduling in resonate-iac#282 |
| 5 | Known issue | [#2144](https://github.com/akoita/resonate/issues/2144) (part 1) | Artist payout analytics show the net share, or honestly say gross sales |
| 6 | New needs | [#2148](https://github.com/akoita/resonate/issues/2148) (decision only) | An options memo for an outbound channel (email or equivalent); the owner records the decision |

Dependencies: #2147 and #2149 build on #2146 (a suspension and a refund
reminder must reach the person), so #2146 comes first. #2149's email reminders
wait on #2148 and are not in scope; in-app reminders are. #2144 part 1 builds
on #1894, which is merged and deployed.

## Exit criteria

- On staging, the pledge step shows the refund-reduction disclosure computed
  from the campaign's terms (none for a 0% deposit release).
- An operator broadcast reaches users in-app, including users who sign in
  later; a moderation action notifies the affected user.
- A suspended account is refused on mutating routes, can still claim refunds and
  read its data, and receives a notice; suspension is admin-only and audited.
- An unclaimed refundable pledge produces one in-app reminder per step and none
  once claimed; the operator sees unclaimed totals.
- Artist analytics show a truthful payout figure, with tests.
- The #2148 decision is recorded on the issue.
- Help articles, the terms and the refund policy describe these capabilities as
  built.

## Not in this sprint

Email or any other outbound transport (until #2148 is decided), #2144 part 2
(agent and MCP download rails), contract upgrades, legal or regulatory answers
(#1774, #1776), official stems, auto-buy, and the paused Remix Studio items.
The owner-signed staging checks from Sprints 32 and 33 are tracked in #2154.

## Revenue line

Vision-neutral readiness, plus Line 1 (Shows) backer protection for #2150 and
#2149 (ADR-BM-6). No fee, split or payout change; refunds stay fee-free and
artists keep at least 85% (ADR-BM-4).
