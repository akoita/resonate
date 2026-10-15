# Vision Sprint 33: Every license tier on sale

**Status:** Closed 2026-10-15. All six items are closed and their work is merged
and deployed to staging; the owner-signed listing checks carry over to
[#2154](https://github.com/akoita/resonate/issues/2154).
**Release:** [Milestone 35 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-35-vision-sprint-33-every-license-tier) records the closed
application milestone, not a software version or deployment event.
**Milestone:** [35](https://github.com/akoita/resonate/milestone/35).
**Goal:** An artist offers each stem under Personal, Remix and Commercial in
one flow and manages listings without one signature per stem, so the buyer's
"Upgrade to Remix license" path (Sprint 32, #2042) always has a Remix tier to
buy, and artist payout analytics count real sales.

## Why this theme

The taste engine roadmap
([2026-10 milestones](../roadmap/2026-10-taste-engine-milestones.md)) is
delivered up to Sprint 32; everything left on it is gated (Listener Pro
traffic, Listener Pro billing, or Crate Digger follow-ups). Sprint 32 made
purchased stems usable, but an upgrade only works when the artist listed a
Remix tier, and today one mint flow creates one edition under one tier. This
sprint makes that common and cheap, and fixes three understood defects that
were sitting idle.

## Approved scope and order

| Order | Axis | Issue | Outcome |
| --- | --- | --- | --- |
| 1 | Business value | [#2041](https://github.com/akoita/resonate/issues/2041) | List one stem under several license tiers in a single flow; the marketplace card groups the tiers |
| 2 | Usability | [#2030](https://github.com/akoita/resonate/issues/2030) | Relist all selected stems in one UserOperation (one signature) |
| 3 | Known issue | [#1894](https://github.com/akoita/resonate/issues/1894) | Payout analytics count live settlement facts from the marketplace and x402 rails |
| 4 | Known issue | [#2012](https://github.com/akoita/resonate/issues/2012) | The audio-feature backfill stops re-picking stems that keep failing analysis |
| 5 | Known issue | [#1936](https://github.com/akoita/resonate/issues/1936) | Remix Studio "Describe it" keeps beat and AI-part masks aligned after a structure change |
| 6 | New needs | [#1777](https://github.com/akoita/resonate/issues/1777) | Time-boxed design split: child issues with a build or defer decision each, and a short design note |

Dependencies: none of these declares an open prerequisite. #2030 follows
#2041 only because both change the listing code. #1894's cited #1893 is merged;
#1936's #1901 and #1902 are closed. None needs a contract change or a legal
decision.

## Exit criteria

- On staging, one flow lists a stem under two or more tiers, and the marketplace
  shows them as one grouped card.
- Relisting N selected stems takes one signature, and every listing is indexed.
- A marketplace sale and an x402 settlement each appear once in the artist's
  payout analytics.
- The backfill's `remaining` count reaches zero and separates failed stems from
  untried ones; the Describe-it fix is merged with a regression test.
- #1777's child issues are filed, each with a build or defer decision.
- The User Guide and feature pages describe the new listing flow.

## Outcome (2026-10-15)

| Issue | Status | Where |
| --- | --- | --- |
| #2041 | `implemented` | #2142: one stem listed under several tiers in one batched UserOperation, with missing editions minted in the same batch; grouped marketplace cards with tier chips; per-seller, per-tier listing intents matched by listing id or log order. It also hardened `notify-listing`: sign-in required, the seller must be the caller, on-chain price and amount win, and only a stem's own artist links it |
| #2030 | `implemented` | #2143: relisting selected stems takes one confirmation per group of up to 10, keeps each stem's tier, and names a failing stem before signing |
| #1894 | `implemented` | #2145: one live `commerce.settled` fact per marketplace or x402 settlement, idempotent by settlement key. Follow-ups in #2144: payout is gross, not net; agent and MCP download rails aren't counted yet |
| #2012 | `implemented` | #2152: the audio-feature backfill holds back stems that keep failing, counts them as `failed`, ignores worker outages and stops a run at the first one |
| #1936 | `implemented` | #2151: Describe it keeps beat and AI-part masks aligned after a structure change; Undo restores them exactly |
| #1777 | split | Five child issues with build or defer decisions: #2146 notices, #2147 suspension, #2148 outbound channel (owner decision), #2149 unclaimed refunds, #2150 refund disclosure |

Exit criteria: the payout facts, backfill and Describe-it fixes are merged with
tests and deployed; the #1777 children are filed. Multi-tier listing and
one-signature relist are deployed and tested; the owner-signed checks on staging
carry over to #2154.

## Not in this sprint

Contract upgrades (#1580, #1759), legal or regulatory answers (#1774, #1776),
official lossless stems (#1976, waiting on ADR-TE-7), Crate Digger auto-buy
(#2027), Listener Pro, and the paused Remix Studio items.

## Revenue line

Line 3, marketplace take-rate, phase 2 (ADR-BM-6). Purchases stay voluntary and
quoted; artists receive at least 85% of each transaction (ADR-BM-4). No fee,
split or payout change.
