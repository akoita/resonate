# Sprint Plan: Vision Sprint 2 — First Real Money

**Dates:** Mon 2026-07-06 → Fri 2026-07-17 (10 working days, indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 2: first real money](https://github.com/akoita/resonate/milestone/4)
**Tracker filter:** [`label:sprint:vision-2`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-2)
**Working mode:** flexible priority-set sprint — see [docs/sprints/README.md](README.md)

> **Sprint Goal:** Resonate becomes able to collect real platform revenue:
> **Shows runs in production with the 6% fee armed and at least one real
> campaign open for pledges**, and **the marketplace enforces the accepted
> 10% / 15% take-rate end to end**.

If that sentence isn't true at demo, the sprint missed.

## Why this theme

Business Model v2 Phase 0 is complete (all six ADRs accepted, epic #1332) and
both revenue rails are code-complete but **collecting nothing**: Shows is
staged behind the go-live gate, and the marketplace still charges the 0.5%
placeholder instead of the accepted 10%/15% (ADR-BM-2). Everything else on the
roadmap improves a product that has never collected a euro. Per ADR-BM-6, lines
1 and 3 are the next activations.

## Priorities

| Tier | Item | What / exit condition |
| --- | --- | --- |
| **P0** | [#1271](https://github.com/akoita/resonate/issues/1271) Shows production go-live | Execute the gated go-live ops: deploy production `ShowCampaignEscrow` **with the 6% fee config**, promote the address (resonate-iac / Cloud Run / Secret Manager / `web` ABI), indexer + reconciliation alerting on in prod, seeded `CAMPAIGNS[]` fallback removed from prod builds, controlled real-user cohort. Exit: a real campaign is open for pledges in production. |
| **P0** | [#1333](https://github.com/akoita/resonate/issues/1333) Marketplace take-rate | `StemMarketplaceV2` enforces 10% (15% x402 micro) — fee cap + default change with the full custody test ladder, x402 config alignment, honest fee display in buy modals, deployment handoffs. Exit: testnet-verified at the decided rates; prod-ready. |
| **P1** | First-campaign content | 1–3 real campaigns prepared with the wedge artists (BD by @akoita; engineering supports with campaign creation/authority flows already shipped). |
| **P1** | Revenue observability | The fee/settlement analytics shipped in #1330 surface in the artist/operator views so the first collected fee is visible and auditable (north-star metric groundwork, ties to #281). |
| **P2 / stretch** | [#1334](https://github.com/akoita/resonate/issues/1334) credits kickoff | Only if the Stability registration lands mid-sprint and P0s are done. |

## Operator inputs required (only @akoita can provide)

- **Production fee-recipient wallet** (`SHOW_CAMPAIGN_FEE_RECIPIENT`) — a
  secured platform wallet, not a dev key.
- **Production deployer key** (`PRIVATE_KEY` per `DeploymentKey.s.sol` rules —
  never the Anvil default on remote RPC) + gas funds on the target chain.
- **Target chain confirmation** for production (Base mainnet vs staying on
  Base Sepolia for the first cohort — decide consciously; "real money" implies
  mainnet USDC, but a staged first cohort on testnet USDC is a legitimate
  de-risking step if the fan cohort is friendly).
- **GCP billing**: staging is on free-trial billing (GPU quota already bit us
  once) — confirm the production project's billing state before go-live ops.
- **Stability AI registration** (free) — not needed for this sprint's P0s, but
  unblocks the stretch item and ADR-BM-3 billing.

## Explicitly NOT in this sprint

- Listener Pro / subscriptions (Phase 3; ADR-BM-6 gate not met).
- Remix real-user enablement (#1342/#1343 + terms — next theme candidate).
- Recursive royalties / LicenseRegistry (Phase 4).

## Exit criteria

- [ ] Production `ShowCampaignEscrow` deployed with 6% fee; address promoted
      through iac/config/ABI; full pledge→escrow→refund/release loop verified
      on the production chain; reconciliation alerting green.
- [ ] At least one real campaign open for pledges in production
      (`vision Sprint Goal` sentence true).
- [ ] `StemMarketplaceV2` at 10%/15% with custody suite green (incl. Gambit on
      the changed contract) and honest fee display; x402 config aligned.
- [ ] Any mid-sprint re-scope recorded here with a dated note.

## Business-model conformance

Serves revenue lines **(1) Shows fees** and **(3) marketplace take-rate**
directly (ADR-BM-6 Phase 1 + the line-3 activation). ADR-BM-4 red lines
respected throughout: success-only fee, fee-free refunds, no payout
subsidies, no yield products.
