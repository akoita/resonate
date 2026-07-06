# Sprint Plan: Vision Sprint 3 — Dependable Shows Ops

> **CLOSED — 2026-07-06, goal met (all 5 items).** The shows money path is now
> machine-provable and operator-usable:
> - **#1392** — an automated lifecycle smoke walks create → operator-auth →
>   activate → pledge → indexer → cancel → refund (nightly `auto`,
>   self-cleaning) or the full confirm → 1h window → release → fee leg
>   (weekly `full`), filing a `smoke-failure` issue on any break. It went
>   **green on staging in run 4** (all 10 steps, 27s), and its four-run
>   shakeout each caught a real flakiness class — SIWE message format
>   (#1400), write-simulation replica lag (#1401), read replica lag (#1402) —
>   proving the gate against itself. Auth via a new `OPERATOR_ADDRESSES`
>   allowlist (#1397 + iac #184) and a funded smoke wallet.
> - **#1390** — activation prefills the escrow address and discovers the
>   on-chain campaign id by matching draft terms: zero copy-paste from CI logs.
> - **#1356** — create/edit/approve validate terms against the contract
>   (`InvalidDeadline`, dispute-window bounds), with an audited
>   revoke→edit→re-approve correction path — no silent edits.
> - **#1363** — the operator panel explains its own gates (activation help +
>   per-button unlock tooltips).
> - **#1355** — sample fixtures seed honest `provisional_campaign` instead of
>   faking an escrow link; optional env-guarded linking populates fees.
>
> Delivered in one session; every item reviewed and gated by Fable, most
> implemented by Opus 4.8 (Codex hit its weekly limit mid-sprint). Follow-up
> logged: the resonate-iac post-deploy trigger for the smoke (noted in the
> feature docs, not built). Next theme candidate: player action-layer later
> slices (#1367) or a new revenue line per ADR-BM-6.

**Dates:** Mon 2026-07-07 → Fri 2026-07-18 (10 working days, indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 3: dependable shows ops](https://github.com/akoita/resonate/milestone/5)
**Tracker filter:** [`label:sprint:vision-3`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-3)
**Working mode:** flexible priority-set sprint — see [docs/sprints/README.md](README.md)

> **Sprint Goal:** the shows money path is **provable by a machine and
> operable by a non-expert**: every staging deploy automatically walks the
> full campaign lifecycle (create → authority → activate → pledge → confirm →
> release → fee) and fails loudly if any seam breaks, and an operator can take
> a campaign from draft to released without copy-pasting contract values or
> tribal knowledge.

If that sentence isn't true at demo, the sprint missed.

## Why this theme

Vision Sprint 2 proved the fee mechanics end to end on staging — but the
proof was **manual**: a two-day live-UAT walk that surfaced six seam bugs
(#1364, #1379, #1386, #1391, dead CTAs, null tokens) that every existing test
layer had missed, because they lived between systems (backend ↔ chain ↔
CI-created campaigns ↔ env config ↔ wallet execution). The rails work; what's
missing is the guarantee that they *keep* working (#1392) and that operating
them doesn't require the person who built them (#1390, #1356, #1363). This
sprint converts the manual UAT into infrastructure and removes the sharpest
operator friction, so the next campaign — and the first real one — is routine.

## Priorities

| Tier | Item | What / exit condition |
| --- | --- | --- |
| **P0** | [#1392](https://github.com/akoita/resonate/issues/1392) Staging lifecycle smoke | Automated post-deploy (and dispatchable) workflow that walks the full lifecycle against staging with an operator service credential and a funded test wallet, asserting fee/token/status hydration, indexer reconciliation, JSON-serializable responses, and the on-chain `FeeCharged`. Exit: a red smoke blocks/alerts on a broken deploy; a green smoke replaces manual UAT walks. |
| **P0** | [#1390](https://github.com/akoita/resonate/issues/1390) Activation ergonomics (tiers 1–2) | Escrow address prefilled from platform config; on-chain campaign ID discovered by matching the draft's terms (beneficiary, goal, deadlines, token) with a one-click "link & activate". Exit: activating a campaign requires zero copy-paste from CI logs. |
| **P1** | [#1356](https://github.com/akoita/resonate/issues/1356) Terms validation + correction path | Creation/edit validates deadline ordering and, when a contract link exists, cross-checks terms against the chain (goal/deadlines/token — the loop test shipped a $10 draft against a 5 USDC escrow); locked terms get a pre-backer correction path. Exit: a mismatched or invalid campaign cannot reach activation silently. |
| **P1** | [#1363](https://github.com/akoita/resonate/issues/1363) Operator panel guidance | Inline guidance in the operator panel: what each lifecycle action does, where values come from, what unblocks a disabled button. Exit: a new operator can run the lifecycle without asking. |
| **P2** | [#1355](https://github.com/akoita/resonate/issues/1355) Fee-era seed fixtures | Sample campaigns consistent with the fee-era escrow model (no `active` + authority-`none` contradictions; realistic fee fields). Exit: fixtures can't reproduce states real campaigns can't reach. |

Carryover note: #1355, #1356, #1363 carry over from the Sprint 2 milestone
(logged there as open at close); #1390 and #1392 were filed from Sprint 2's
live-UAT findings.

## Operator inputs required (only @akoita can provide)

- **Staging operator service credential** for #1392 (an operator-scoped API
  token/service account the smoke can use headlessly) — mechanism to be
  designed early in the sprint.
- **Funded test wallet policy** for #1392: a dedicated staging smart account
  holding test USDC (faucet top-ups or a pre-funded allowance) for the smoke's
  pledges.

## Explicitly NOT in this sprint

- **Production anything** — unchanged from the Sprint 2 re-scope; #1271 keeps
  the gate checklist for when prod prep begins.
- #1390 tier 3 (backend-initiated on-chain creation via a platform signer) —
  an explicit key-custody decision deferred with prod prep.
- New revenue-line work (credits #1334, Listener Pro, licensing) — this sprint
  hardens line (1)'s path rather than opening new lines.
- Player action layer later slices (#1367 remix/buy/artist-room/collect chips).

## Exit criteria

- [ ] Staging lifecycle smoke exists, runs post-deploy (and on dispatch),
      covers create→authority→activate→pledge→confirm→release→fee, and is
      green on current staging (#1392).
- [ ] Campaign activation requires no manually copied contract address or
      campaign ID (#1390 tiers 1–2).
- [ ] Invalid or chain-mismatched campaign terms are rejected at
      creation/edit, and locked terms have a pre-backer correction path
      (#1356).
- [ ] Operator panel explains its own lifecycle (#1363).
- [ ] Seed fixtures are fee-era consistent (#1355).
- [ ] Any mid-sprint re-scope recorded here with a dated note.

## Business-model conformance

Serves revenue line **(1) Shows campaign fees** directly — this sprint hardens
and de-risks the collection path proven in Sprint 2. ADR-BM-4 red lines
respected: success-only fee, fee-free refunds, no payout subsidies, no yield
products. Smoke campaigns are internal test artifacts and never surface in
public discovery.
