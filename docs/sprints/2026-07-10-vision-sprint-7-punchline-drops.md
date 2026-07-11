# Sprint Plan: Vision Sprint 7 — Punchline Drops MVP

**Dates:** 2026-07-10 → 2026-07-25 (indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 7: Punchline Drops MVP](https://github.com/akoita/resonate/milestone/9)
**Tracker filter:** [`label:sprint:vision-7`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-7)
**Working mode:** flexible priority-set sprint — see [README.md](README.md)
**Revenue line:** (3) marketplace take-rate / ownership products — a new **collectible** asset class (Engagement). Fan→artist commerce; artist keeps 85%+ (ADR-BM-4).

> **OUTCOME (closed 2026-07-11): goal met — 11/11 slices shipped in ~2 days.**
> The demo loop is live: an artist builds a drop from a rights-clean track
> (optionally with a complete-set bonus clip + note), a fan collects free
> moments, completes the set, unlocks the bonus, and browses everything in
> Library → Moments; the full view → preview → collect funnel and per-moment
> artist metrics are measurable (#489). Epic #490 closed. Also shipped: three
> design passes (collectible-first "living audio object" cards) and two infra
> fixes surfaced by the work (encrypted-stem decrypt allowlist; CI Postgres
> connection ceiling). Deliberate deferrals, tracked: paid collects
> [#1462](https://github.com/akoita/resonate/issues/1462), optional on-chain
> claims [#1467](https://github.com/akoita/resonate/issues/1467)
> (trigger-gated), auctions
> [#1470](https://github.com/akoita/resonate/issues/1470) (trigger-gated).
> Operator inputs still pending: moment pricing reconciliation into
> `business-model.md`; verified-catalog demo scope.

> **Sprint Goal:** ship the **Phase-1 Punchline Drops MVP** — artists turn a
> track's **vocal stem** into scarce, artist-approved collectible **moments**
> (title, lyric, artwork, edition size, price), and fans **discover, collect,
> and complete sets** directly from track pages, with **clear non-commercial
> rights** and simple unlock mechanics. At demo: an artist builds a drop from a
> rights-clean track, a fan collects a moment and sees it in their inventory,
> and completing a set unlocks a bonus — all rights-safe and off-chain.

## Vision alignment

Punchline Drops is a new **ownership/engagement product** that turns the most
shareable part of a song (the hook / vocal moment) into a collectible — feeding
the same fan→artist commerce flywheel as stems and remixes, at a lower price
point and higher emotional pull. It reuses the existing stem-separation and
rights-gating rails. Collectibles carry **utility** (access/perks/unlocks),
never income rights (ADR-BM-4 red line).

## Guardrails (rights-safe by construction)

- **Verified/artist-uploaded catalogs only** for the MVP — follow the
  [Rights Verification & Copyright Enforcement Strategy](../rfc/rights-verification-strategy.md).
  Famous/legacy/label-controlled works are **out of scope** unless the
  rightsholder is verified. Eligibility + rights gating is issue #480 and gates
  everything downstream.
- **Default rights:** personal collectible only — **no commercial, no remix, no
  copyright transfer** (mvp doc §"Default MVP rights").
- **Off-chain ownership for MVP** — do NOT block Phase 1 on a new collectible
  contract unless wallet-portable ownership becomes a hard requirement (epic
  #490 note). Ownership is a DB grant; on-chain/License-NFT is a later phase.
- Collectibles are **utility**, not yield (ADR-BM-4).

## Priorities (the epic's build order — backend-first)

Design of record: [`docs/features/punchline_drops_mvp.md`](../features/punchline_drops_mvp.md)
+ [`punchline_drops_execution_plan.md`](../features/punchline_drops_execution_plan.md).
Epic: [#490](https://github.com/akoita/resonate/issues/490).

1. **#479** Prisma models (drop, moment, edition, ownership grant).
2. **#480** Track eligibility + rights gating (verified-catalog only) — the gate.
3. **#481** Vocal-stem clip extraction service (reuse stem separation).
4. **#482** Draft + publish APIs.
5. **#483** Vocal clip selection + preview UI.
6. **#484** Artist drop builder on the release page.
7. **#485** Collectible purchase + ownership grant.
8. **#486** Track-page "collect moments" module.
9. **#487** Collector inventory view.
10. **#488** Complete-set unlock rewards.
11. **#489** Analytics events + artist metrics.

Slices 1–4 (backend + gate) land first and unblock the UI slices; disjoint
slices run in parallel under maestro (Opus-4.8-high workers), reviewed +
verified by the orchestrator before each merge.

## Operator inputs required (only @akoita)

- Confirm the verified-catalog scope for the MVP demo (which artist/catalog).
- Pricing for collectible moments (reconcile any number into
  `docs/rfc/business-model.md`; take-rate reuses the marketplace 10%).
- Go/no-go on any collectible-contract work (kept off-chain by default).

## Explicitly NOT in this sprint

- On-chain collectible / License-NFT contract (off-chain grant for MVP).
- Commercial/remix rights on moments (personal collectible only).
- Legacy/label-controlled catalogs.
- Live fiat (purchase uses the existing x402/stablecoin + credit rails; no new
  Stripe).

## Exit criteria

- An artist can build + publish a drop of moments from a **rights-clean** track
  (eligibility enforced); a fan can **collect** a moment and see it in their
  **inventory**; **completing a set unlocks** a bonus; analytics events fire.
- Rights gating provably blocks ineligible tracks. Feature catalog + User Guide
  updated. Ownership is off-chain and clearly non-commercial in the UI.

## Business-model conformance

Revenue line (3) — a new collectible ownership product; marketplace take-rate
(10%, ADR-BM-2) reused, **artist 85%+ preserved (ADR-BM-4)**. Collectibles carry
utility only, never income/yield (ADR-BM-4 securities red line). Any price
reconciled in `docs/rfc/business-model.md`.
