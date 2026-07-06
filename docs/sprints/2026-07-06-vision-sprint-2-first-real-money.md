# Sprint Plan: Vision Sprint 2 — First Real Money (Staging Edition)

> **CLOSED — 2026-07-06, goal met.** Both rails proven on staging: the full
> pledge→release loop ran end to end on Base Sepolia (escrow campaign 3:
> gross 5.00 → net 4.70 to the artist, fee 0.30 USDC = exactly 6% to the fee
> recipient, `FeeCharged` on-chain, indexer-reconciled to `released` with the
> exact breakdown), and `StemMarketplaceV2` enforces the accepted 10%/15%
> take-rate. The lifecycle is one-click operable via the contracts ops console
> (#1394/#1395). Live-UAT along the way drove ~15 merged fixes (fee hydration
> #1364/#1366, chip wiring #1367/#1379/#1385, serialization #1386, payment
> token #1391/#1393, campaign page redesign #1373–#1384). Open items #1355,
> #1356, #1363 carry over to
> [Vision Sprint 3](2026-07-06-vision-sprint-3-dependable-shows-ops.md),
> which converts the manual UAT into an automated lifecycle smoke (#1392) and
> removes the operator friction found here (#1390).

> **RE-SCOPE — 2026-07-05 (@akoita):** the project stays in dev/test/staging
> until a **stable and coherent version** exists; **no production concerns for
> now**. #1271 (production go-live) is pulled out of this sprint — its gate
> checklist stays for when prod prep begins. "First real money" therefore
> means the fee mechanics proven end to end **on staging (Base Sepolia,
> testnet USDC)**: both rails deployed at the accepted rates and observably
> collecting. The production operator inputs listed below are struck for this
> sprint; only staging-level config is needed.

**Dates:** Mon 2026-07-06 → Fri 2026-07-17 (10 working days, indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 2: first real money](https://github.com/akoita/resonate/milestone/4)
**Tracker filter:** [`label:sprint:vision-2`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-2)
**Working mode:** flexible priority-set sprint — see [docs/sprints/README.md](README.md)

> **Sprint Goal (re-scoped 2026-07-05):** both revenue rails are proven on
> staging: **Shows collects the 6% fee end to end on Base Sepolia**, and **the
> marketplace enforces the accepted 10% / 15% take-rate end to end** — the
> platform's fee mechanics are stable and coherent, ready for a future prod
> decision.

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
| **P0** | Shows fee live on staging *(re-scoped 2026-07-05; was #1271 prod go-live)* | Deploy the fee-bearing `ShowCampaignEscrow` (6%) to **staging/Base Sepolia**, promote the address through staging config + `web` ABI, indexer + reconciliation on, and verify the full pledge→escrow→release loop **with the 6% fee observably collected** by the staging fee wallet. Exit: fee visible in campaign accounting + analytics on staging. |
| **P0** | [#1333](https://github.com/akoita/resonate/issues/1333) Marketplace take-rate | `StemMarketplaceV2` enforces 10% (15% x402 micro) — fee cap + default change with the full custody test ladder, x402 config alignment, honest fee display in buy modals, deployment handoffs. Exit: testnet-verified at the decided rates; prod-ready. |
| **P1** | First-campaign content | 1–3 real campaigns prepared with the wedge artists (BD by @akoita; engineering supports with campaign creation/authority flows already shipped). |
| **P1** | Revenue observability | The fee/settlement analytics shipped in #1330 surface in the artist/operator views so the first collected fee is visible and auditable (north-star metric groundwork, ties to #281). |
| **P2 / stretch** | [#1334](https://github.com/akoita/resonate/issues/1334) credits kickoff | Only if the Stability registration lands mid-sprint and P0s are done. |

## Operator inputs required (only @akoita can provide)

> **Re-scope 2026-07-05:** production items below are ~~struck~~ for this
> sprint. Needed now: only a **staging fee-recipient address** (Base Sepolia —
> a dev wallet is fine) for `SHOW_CAMPAIGN_FEE_RECIPIENT` / `FEE_RECIPIENT` in
> staging config, and optionally the free **Stability registration** for the
> stretch item.

- ~~**Production fee-recipient wallet** (`SHOW_CAMPAIGN_FEE_RECIPIENT`) — a
  secured platform wallet, not a dev key.~~
- **Production deployer key** (`PRIVATE_KEY` per `DeploymentKey.s.sol` rules —
  never the Anvil default on remote RPC) + gas funds on the target chain.
- ~~**Production deployer key** + gas funds; **target chain confirmation**;
  **production GCP billing state**~~ — deferred with prod prep (re-scope
  2026-07-05).
- **Stability AI registration** (free) — not needed for this sprint's P0s, but
  unblocks the stretch item and ADR-BM-3 billing.

## Explicitly NOT in this sprint

- **Production anything** (re-scope 2026-07-05): go-live ops, mainnet deploys,
  real-money wallets, real-user cohorts — #1271 keeps the gate checklist for
  when a stable, coherent version triggers prod prep.
- Listener Pro / subscriptions (Phase 3; ADR-BM-6 gate not met).
- Remix real-user enablement (#1342/#1343 + terms — next theme candidate).
- Recursive royalties / LicenseRegistry (Phase 4).

## Exit criteria (re-scoped 2026-07-05)

- [ ] Fee-bearing `ShowCampaignEscrow` (6%) deployed to **staging/Base
      Sepolia**; address promoted through staging config + web ABI; full
      pledge→escrow→refund/release loop verified with the fee observably
      collected; reconciliation alerting green on staging.
- [ ] `StemMarketplaceV2` at 10%/15% redeployed on staging with custody suite
      green (incl. Gambit on the changed contract), honest fee display, and
      x402 config aligned.
- [ ] Fee/settlement figures visible in artist/operator analytics on staging.
- [ ] Any further mid-sprint re-scope recorded here with a dated note.

## Business-model conformance

Serves revenue lines **(1) Shows fees** and **(3) marketplace take-rate**
directly (ADR-BM-6 Phase 1 + the line-3 activation). ADR-BM-4 red lines
respected throughout: success-only fee, fee-free refunds, no payout
subsidies, no yield products.
