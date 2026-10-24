# Vision Sprint 42: Sell with confidence

**Status:** ✅ Closed 2026-10-24. All six issues closed, and the exit checks pass
on staging at `4ec6e8a3`.
**Milestone:** [44](https://github.com/akoita/resonate/milestone/44).
**Goal:** A consumer purchase is legally complete: consent to immediate
delivery is recorded, confirmed to the buyer and tied to the transaction.
Artists can sell official lossless stems with their source shown. The
platform's admin and indexing paths are fully hardened.

## Outcome

A consumer purchase now completes with a recorded delivery choice. Artists can
sell official lossless stems labelled as such. The admin and indexing paths are
hardened.

| Issue | Result | PR |
| --- | --- | --- |
| #1776 | Checkout records a delivery choice before payment: deliver now, with an acknowledged waiver of the withdrawal right, or wait. Nothing is pre-selected. A durable, append-only `PurchaseConsent` is linked to the payment and confirmed to the buyer in their notices, and by email when they have a confirmed address. Without a waiver the server holds off-chain delivery (downloads, licences, crate export, paid Punchline editions) for 14 days, and the buyer sees the release date and a "Deliver now" action. Mints need a fresh deliver-now consent. Purchases before 2026-10-25 are delivered as before. The refund policy and Terms are updated, and the wording is marked for legal review | #2373 |
| #1976 | Artists upload official WAV/FLAC stems per track. Before a package is accepted it must pass format, sample-rate, duration, silence, summed-level and alignment checks against the mix. Buyers download the lossless file. The public preview is a bounded 128 kbps MP3 transcode, and the blob route never serves the lossless file. "Official" or "Separated (AI)" is shown on listings, the stem page, the buy modal, crate quotes, x402 receipts and MCP quotes, with a source filter. Existing stems are backfilled as separated (`demucs-htdemucs-6s`) | #2376 |
| #2360 | The contract indexer holds a distributed lease with epoch fencing, so two processes cannot both advance the cursor | #2368 |
| #2362 | Every admin and operator route writes one audit event (ids, codes and counts only), and a coverage test fails on an unaudited route. Step-up now also covers credit grants, DMCA resolve, recovery review, retention, erasure, wipe, moderation resolve, indexer reset and reindex, and wallet recovery. The deferred admin request bodies are now DTOs | #2370 |
| #2361 | Wallet fund and budget amounts must be finite, positive (the budget may be 0, meaning paused) and at most 10,000 | #2369 |
| #2182 | An optional, skippable email card on Home, plus dismissible prompts after a pledge, on the Listing Manager, and for unread account or refund notices. Email is never required | #2371 |
| #1121 (scope check) | No remix-challenge product exists, so a cockpit card has nothing to show. The design question is filed as #2367 for the owner, and #1121 left the milestone | — |

**Unplanned:** #2381. The staging release failed while building the backend
image: the TypeScript build ran out of memory at the builder's default heap.
The type check has needed about 2.7 GB since before this sprint (measured at
both ends), so the build stage now runs with a 4 GB heap.

**Staging verification (2026-10-24, `4ec6e8a3`):**

- The purchase-consent routes, the official-stems upload and the newly gated
  admin routes answer 401 without a sign-in. The public delivery wording is
  served with version `2026-10-24.draft-1`.
- Listings carry `source: separated` and `separationModel:
  demucs-htdemucs-6s`, which shows the stem-source migration and its backfill
  ran, and so did the earlier lease and consent migrations. The `source` filter
  answers.
- The indexer status is healthy under the lease.
- The deployed User Guide has the new withdrawal article, the "Official or
  Separated (AI)?" section and the optional email card text.

**Carry-over and follow-ups:**

- **Waiting on the owner:**
  - #1421 pricing sign-off;
  - the #2367 remix-challenge design decision;
  - legal review of the consent wording and its open questions (in
    `docs/legal/refund-policy.md`).
- **Deployment halves (unchanged):** resonate-iac#320–#323.
- **Follow-ups:**
  - #2378: a standing delivery choice for AI DJ session-key purchases (held
    for 14 days today);
  - #2379: tuning the official-stem checks on real packages, partial packages,
    removing a package, and screenshots;
  - #2380: step-up for money-release operator actions, and auditing admin
    branches inside user routes.
- The next sprint is not yet selected.

## Why this theme

- **The last gates before real money.**
  - The EU withdrawal right survives every consumer digital purchase until
    Resonate collects consent to immediate delivery, an acknowledgement, and a
    durable confirmation (#1776). That is also the legal gate for charging
    credits (#1421).
  - The worker cut-over needs a lease on the contract indexer (#2360).
  - The admin surfaces outside #2173 are not yet audited (#2362).
- **A reason for professionals to pay.**
  - Separated stems are available anywhere. Official lossless stems with a
    clear licence aren't (#1976, ADR-TE-7).

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Known issue | [#1776](https://github.com/akoita/resonate/issues/1776) | A consumer purchase completes only with a recorded consent and acknowledgement (confirmed to the buyer, tied to the transaction), or with delivery held until the withdrawal period ends. The refund policy and Terms are updated |
| 2 | P1 | Known issue | [#2360](https://github.com/akoita/resonate/issues/2360) | The contract indexer holds a distributed lease |
| 3 | P1 | Known issue | [#2362](https://github.com/akoita/resonate/issues/2362) | The remaining admin surfaces are audited, the destructive ones step-up gated, and the deferred admin request bodies become DTOs |
| 4 | P2 | Known issue | [#2361](https://github.com/akoita/resonate/issues/2361) | Wallet fund and budget amounts are validated |
| 5 | P1 | Business value | [#1976](https://github.com/akoita/resonate/issues/1976) | Artists upload official lossless stems, delivered lossless, with "Official" or "Separated (AI)" shown wherever a stem is sold |
| 6 | P2 | Usability | [#2182](https://github.com/akoita/resonate/issues/2182) | An optional email step at onboarding, and contextual prompts; email is never required |
| 7 | P2 | New needs | [#1121](https://github.com/akoita/resonate/issues/1121) (scope check) | A written decision on the remix-challenge cockpit card |

Every prerequisite is closed: #1769, #1567, #1608, #2173, #2197, #1965, #2169
and #891.

## Owner decisions (2026-10-24)

1. **ADR-TE-7 is accepted as proposed:** a stem purchase sells a licence, and
   artists can supply official stems. Official and separated stems are priced
   separately by the artist, with no platform floor.
2. **#1776 surfaces:** stem and licence purchases, collectibles and drops, and
   future credit top-ups. x402 agent and MCP purchases (machine to machine) and
   Shows pledges (not digital content) are out of scope. This scoping is
   flagged for legal review.
3. **#1776 without consent:**
   - Off-chain deliveries are held until the 14-day period ends, and the buyer
     is shown when delivery will happen.
   - On-chain mints require consent before minting.
   - The consent wording is marked "for legal review before production".
4. **#2362:** destructive actions are step-up gated (takedowns, credit grants,
   recovery, maintenance resets and reindexing), and every admin action is
   audited.

## Deployment halves

None expected.

## Exit criteria

- The consent flow is enforced at the checkout boundary (tests), with a
  durable record and a buyer confirmation, and the refund policy and Terms
  are updated.
- The contract indexer is leased (a parallel-poller test).
- Every admin surface is audited, and the destructive ones are step-up gated
  (the route-set test is updated).
- Wallet amounts are validated.
- Official stems upload, validate and deliver lossless, with the source shown
  on the stem page, listing, quote and receipt.
- Optional email prompts work end to end.
- The #1121 scope decision is written.
- On staging, the new surfaces are in the deployed code.

## Not in this sprint

- Charging money: buying credits (#1422) waits on the #1421 sign-off and this
  consent flow.
- Fee or price changes.
- Listener Pro, Session DJ (#1971), crate auto-buy (#2027) and the Shows
  go-live (#1583).
- The #1774 regulatory question, which needs a qualified adviser.
- **Not counted:** the owner checks in #2154.

## Revenue line

- #1976: Line 3 (marketplace). No fee or split change; artists keep at least
  85% (ADR-BM-4).
- #1776: changes when a sale completes, not what it costs or who gets paid.
- The rest is vision-neutral security and quality.
