# Vision Sprint 45: Cheap to run, ready to charge, easy to share

**Status:** ✅ Closed 2026-10-31. All five items have merged PRs. #2436 stays
open for the owner's laptop check.
**Milestone:** Vision Sprint 45: Cheap to run, ready to charge, easy to share.
**Goal:** The web app stays cheap to run while idle, account erasure can never
leave a person being charged by Stripe, fans can share a show campaign or a
collectible at the moment they act, and the remix-parts integration suite stops
flaking on CI.

## Outcome

| Issue | Result | PR |
| --- | --- | --- |
| #2430 | Erasure and closure cancel a live Stripe subscription immediately, idempotent and audited, before the account goes. Suspension pauses collection and reinstatement resumes it. The billing email follows the account email, and the retention job prunes old `StripeEvent` rows | #2473 |
| #2436 | Off-screen and hidden-tab animation loops hold still, reduced motion stops them, and the remaining timers back off while hidden. Measured in headless Chromium | #2472 |
| #1916 | The campaign page and the after-signal and after-pledge states offer a tailored share with refund-honest copy, recorded as `shows.campaign_shared` | #2471 |
| #1917 | Every collect or claim success state and every drop page offers a tailored, no-yield share | #2470 |
| #2461 | The remix-parts happy path keeps the stub drift measurable, so the conform assertion is deterministic | #2475 |

**Carry-over:**

- #2436 stays open: the owner's check on a mid-range laptop is the last
  acceptance step.
- The refund and cancellation wording from #2430 needs legal review.
- Live charging stays off (#2409). Stripe keys are still resonate-iac#325.

## Why this theme

- **Cheap to run.** Since the visual refresh, a foreground Resonate tab costs
  noticeable CPU and RAM while idle (#2436). A music app is left open for hours.
- **Ready to charge.** #2430 is a hard gate before live charging (#2409): an
  erased or closed account must cancel its Stripe subscription first.
- **Easy to share.** Shows reach their threshold through fans recruiting fans
  (#1916), and collectibles need a tailored share at the moment of collecting
  instead of leaking into the listening share (#1917). Both are children of
  #1915.
- **Known issue.** #2461 flakes unrelated PRs in the merge queue.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Business value | [#2430](https://github.com/akoita/resonate/issues/2430) | Erasure and closure cancel any live Stripe subscription first (idempotent, audited, retried); suspension behaviour decided and implemented; billing email synced; `StripeEvent` pruned by the retention job |
| 2 | P0 | Usability | [#2436](https://github.com/akoita/resonate/issues/2436) | Decorative animations pause off-screen, in hidden tabs and under reduced motion; pollers back off while hidden; paint-property animations replaced; guardrail rule in `web/AGENTS.md` |
| 3 | P1 | Business value | [#1916](https://github.com/akoita/resonate/issues/1916) | Campaign page share plus tailored prompts after signal and pledge, with refund-honest copy and `shows.campaign_shared` analytics |
| 4 | P1 | Business value | [#1917](https://github.com/akoita/resonate/issues/1917) | Every collect or claim success state and every drop page offers a tailored, no-yield share |
| 5 | P1 | Known issue | [#2461](https://github.com/akoita/resonate/issues/2461) | The remix-parts happy path asserts the conform outcome reliably |

## Defaults taken (owner may override in review)

1. **#2430 cancellation timing:** cancel **immediately** on erasure or closure,
   with no pro-rata refund of the current period beyond what the refund policy
   already grants. A closed account cannot use the remaining period, so period
   end cancellation would charge nothing more but leave an orphaned live
   subscription. The policy wording is documented in the PR for legal review.
2. **#2430 suspension:** suspension **pauses collection** (Stripe
   `pause_collection`) and resumes on reinstatement, so a suspended person is
   not charged for a service they cannot use.
3. **#2436 measurement:** the cloud environment cannot reproduce a mid-range
   laptop. The PR records headless Chromium measurements (idle main-thread
   time, paints per second) as the baseline and after, and lists the owner's
   laptop check as the remaining acceptance step.

## Deployment halves

- None new. #2430's retention rule runs in the existing retention job; Stripe
  keys remain resonate-iac#325.

## Exit criteria

- Each issue has a merged PR with focused tests green.
- On staging: Home idle with the player paused shows no continuous repaint, and
  the campaign page share works.
- Live charging stays off.

## Not in this sprint

- Live charging and turning the Pro gates on (#2409).
- #2423 (contract pin drift) — stretch only if every P0/P1 lands early.

## Revenue line

- **Line 2** (Artist Pro), Phase 2 correctness gate: #2430.
- **Line 1** (Shows fee), activation: #1916.
- **Line 3** (marketplace take-rate, collectibles): #1917. ADR-BM-4: utility,
  not yield; the artist receives at least 85% of a paid collect.
- **Vision-neutral quality:** #2436, #2461.
