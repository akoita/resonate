# Sprint Plan: Vision Sprint 1 — Remix Finish + First Revenue Rails

> ## ✅ SPRINT COMPLETE — closed 2026-07-05, 12 days early
>
> **Outcome: fully delivered.** [Milestone 3](https://github.com/akoita/resonate/milestone/3)
> closed. Both P0s and both P1s done:
> P0 #1330 — 6% success-only fee live in `ShowCampaignEscrow` end-to-end
> (contract + indexer/API/analytics + honest UX, PR #1340);
> P0 #1206 — licensed remixing finished, milestone 2 closed 9/9,
> scale-to-zero + studio pre-warm decision (PR #1341);
> P1 #1193 — SA3/Gemma license adopt-gate resolved GO with clause-level
> determinations (PR #1344);
> P1 owner ADR review — **ADR-BM-1…6 all ACCEPTED** (PRs #1331/#1339/#1346);
> Business Model v2 Phase 0 complete.
> Stretch items not taken: #1211 (research, backlog); #1333 planning moved
> into Vision Sprint 2 as committed work.
> **Next:** [Vision Sprint 2 — first real money](2026-07-06-vision-sprint-2-first-real-money.md).

**Dates:** Mon 2026-07-06 → Fri 2026-07-17 (10 working days, indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 1: remix finish + first revenue rails](https://github.com/akoita/resonate/milestone/3)
**Tracker filter:** [`label:sprint:vision-1`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-1)
**Working mode:** flexible priority-set sprint — see [docs/sprints/README.md](README.md)

> **Sprint Goal:** The licensed-remixing loop is finished — a non-owner fan's
> Remix license produces an audio-conditioned draft on a warm GPU that is
> actually shaped by the licensed stems — **and** `ShowCampaignEscrow` enforces
> the accepted **6% success-only campaign fee** at custody-grade quality on
> testnet.

If that sentence isn't true at demo, the sprint missed.

## Why this theme

This is the first sprint of **Business Model v2**
([review](../strategy/business-model-review-2026-07.md), epic
[#1332](https://github.com/akoita/resonate/issues/1332)). It deliberately
combines the two judged-next subjects:

1. **Finish what's in flight (user feature):** the Remix sprint
   ([2026-06-30](2026-06-30-remix-licensed-remixing.md), milestone 2) is 8/9
   done — only [#1206](https://github.com/akoita/resonate/issues/1206)
   (warm-GPU audio-conditioned provider) remains. Remix is central to revenue
   lines #2/#3 (Artist Pro + marketplace), so finishing it is both product and
   economics.
2. **Open the first revenue rail (economic):** ADR-BM-1 is accepted (6%
   success-only campaign fee) and the fee parameter must land in
   `ShowCampaignEscrow` **before** the gated production deploy
   ([#1271](https://github.com/akoita/resonate/issues/1271)) — after deploy it
   becomes a custody migration.

## Priorities

| Tier | Issue | What / exit condition |
| --- | --- | --- |
| **P0** | [#1206](https://github.com/akoita/resonate/issues/1206) | Audio-conditioned generation provider + warm GPU inference service — closes milestone 2. Gate on cost/latency before building downstream (per the July roadmap). |
| **P0** | [#1330](https://github.com/akoita/resonate/issues/1330) | 6% success-only fee in `ShowCampaignEscrow`: fee param (bps + recipient), release-time-only accounting, refunds fee-free, full custody test ladder (unit/fuzz/invariant/formal + Gambit; funds-conservation includes the fee sink), indexer + analytics ingestion, honest fee display, deployment handoffs. |
| **P1** | [#1193](https://github.com/akoita/resonate/issues/1193) | Stable Audio 3 adopt-gate: GPU quality spike + Stability/Gemma license review. Output = a recorded adopt/don't-adopt decision — this **unblocks ADR-BM-3** (generation-credit billing, [#1334](https://github.com/akoita/resonate/issues/1334)). |
| **P1** | ADR confirmations | Owner reviews ADR-BM-3/4/5/6 ([#1334](https://github.com/akoita/resonate/issues/1334)–[#1337](https://github.com/akoita/resonate/issues/1337)) — doc-level decisions, cheap, they de-risk the next sprint. |
| **P2 / stretch** | [#1211](https://github.com/akoita/resonate/issues/1211) | Remix research: section/inpaint edits — only if both P0s land early. |
| **P2 / stretch** | [#1333](https://github.com/akoita/resonate/issues/1333) | ADR-BM-2 implementation *planning only* (fee-cap change via upgrade path [#1300](https://github.com/akoita/resonate/issues/1300)) — implementation itself is the leading next-sprint candidate. |

## Carryover / in-flight

- [#1206](https://github.com/akoita/resonate/issues/1206) carries over from
  milestone 2 (kept there so that milestone closes with it; also labeled
  `sprint:vision-1`). Recent groundwork already merged: worker image CI
  (#1307→#1308), backend→worker auth (#1327), cold-start fix (#1328).

## Explicitly NOT in this sprint

- **Production go-live of Shows** — [#1271](https://github.com/akoita/resonate/issues/1271)
  stays gated on an explicit go-decision; this sprint only makes the custody
  contract fee-ready in test.
- **ADR-BM-2 contract change** (fee default + cap) — needs the upgrade path;
  next-sprint candidate.
- **Subscription billing / Artist Pro** — Phase 2; needs ADR-BM-3/6 accepted
  first.

## Exit criteria

- [ ] Milestone 2 closed: licensed remix end-to-end demo on staging
      (non-owner buys Remix license → audio-conditioned draft on warm GPU
      shaped by licensed stems).
- [ ] #1330 merged: fee enforced on testnet with green custody suite; fee
      shown honestly on campaign pages.
- [ ] #1193 decision recorded (adopt / don't adopt), ADR-BM-3 unblocked.
- [ ] Any mid-sprint re-scope is recorded in this doc with a dated note.

## Business-model conformance

Serves revenue line **(1) Shows campaign fees** (#1330, Phase 1) and lines
**(2)/(3) Artist Pro + marketplace** (#1206/#1193, Phase 2 prerequisites). No
red-line exposure: the fee is success-only with fee-free refunds; no payout
subsidies; no yield products.
