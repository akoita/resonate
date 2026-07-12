# Vision Sprint 9 — Custody to Production + First Paid Collects

- **Milestone:** [11 — Vision Sprint 9](https://github.com/akoita/resonate/milestone/11) · label `sprint:vision-9`
- **Window:** 2026-07-12 → 2026-07-25
- **Selected from the whole project context** (ADR-BM-6 sequencing, backlog
  triage, RFCs, codebase state) — deliberately NOT from the previous sprint's
  momentum (the Drops demand cluster waits for this sprint's funnel data).

## Goal

End the sprint with the **Shows production go-live gate fully green** — only
the owner's explicit go-decision remaining — and **Drops collecting real
fees** through the generalized x402 rail.

## Why this sprint (the strategic read)

ADR-BM-6 (accepted 2026-07-05) fixes the activation order: **(1) Shows fees →
(2) Artist Pro/credits → (3) marketplace take-rate → (4) Listener Pro →
(5) B2B**. The backlog's **only P0** is #1271 (Shows production-readiness +
gated go-live), and Sprints 2–8 quietly completed its prerequisites: custody
fuzz/invariant/formal hardening (#943/#944 ✅), blocking Halmos gate
(#1260 ✅), the nightly money-path smoke (#1392, trust restored via #1483),
billing/credit foundations (S5–S6), and a discovery-grade Home storefront
(S8). What stands between the product and its **first collected real
revenue** is exactly this sprint's P0 set.

## Sprint content

### P0 — Line 1: the go-live gate

| Issue | Slice | Why |
| --- | --- | --- |
| #1497 (slice of #1300) | Timelock + multisig upgrade authority; `ShowCampaignEscrow` → UUPS with full re-verification (Halmos/Certora/storage-layout) + ops handoffs | Immutable production custody = unpatchable vulnerability with real funds inside. Land the posture BEFORE the first production deploy. |
| #1271 | Readiness completion: internal security review of the 3 custody contracts + full testnet loop (pledge → escrow → receipt → refund/release) with indexer reconciliation + mismatch alerting proven | The gate itself. Go-live stays GATED on the owner's explicit decision. |
| #1498 (slice of #1336) | Payout-eligibility gating to verified states (fail-closed) + honest artist-facing UI | ADR-BM-5: no real-money payouts without a verified-human gate. Operator confirms the ADR day-1. |
| #1224 | Finish researched, media-rich sample campaigns | The go-live cohort needs real content. Already in progress. |

### P1 — Line 3: first paid collects

| Issue | Slice | Why |
| --- | --- | --- |
| #1462 | Generalize the x402 rail beyond stems → paid moment collects, pricing reconciled into `docs/rfc/business-model.md` | **Gated on the operator pricing decision (day-1 sprint task).** Turns the shipped Drops funnel into a Line 3 collector. |
| #1477 | Pride loop: owned-moment showcase + OG share cards | The one demand-cluster item that directly makes paid collects convert. |

### P2 — protecting the storefront

| Issue | Slice | Why |
| --- | --- | --- |
| #1491 | Home performance: measure (post staging deploy) → fix heavy card surfaces + lazy-mount → set a Home perf budget | Home is now the shop window for Shows AND Drops. |

## Operator decisions this sprint depends on

1. **ADR-BM-5 confirmation** (#1336) — gates #1498.
2. **Moment pricing** — gates #1462; the numbers land in
   `docs/rfc/business-model.md` first (canonical source rule).
3. **Production target account**: deploy production Shows on the current GCP
   project, or complete/lead with the #915 / iac#185 migration first?
   Going live first means migrating live custody later — decide deliberately
   before the go-decision.
4. (End of sprint) the **go/no-go decision** itself — explicitly out of the
   sprint's control by design (#1271 keeps go-live gated).

## Explicitly NOT selected (and why)

- **Discovery WS-3/5/6/8/9** (#1450, #1452, #1453, #1455, #1456): the S8
  foundation is sufficient until listening volume grows; WS-3 marts follow
  the BigQuery warehouse epic (#881) cadence.
- **Drops demand cluster remainder** (#1476 Golden Moments, #1481 meaning
  layer, #1478 portability): sequenced behind #1462 + #1477 funnel data.
- **#1492 Phase B** (stable credited-artist identities): Phase A shipped;
  Phase B waits so #1450's marts and the identity re-key land together.
- **GCP migration** (#915, iac#185): raised as decision 3 above rather than
  pulled in wholesale.
- **Watch items**: TS7 (#1424), Prisma 7 (#413), i18n (#838), a11y (#837).

## Carry-over / automated

- #1399 closes automatically after 3 consecutive green nightly smokes
  (scheduled watcher; counter started 2026-07-12).
- Staging deploy of Sprint 7–8 work remains an operator action and is a
  prerequisite for the #1491 measurement pass.

## Business-model conformance

P0 serves **Line 1** (Shows fees — first collected revenue), P1 serves
**Line 3** (marketplace take-rate on collectibles). ADR-BM-4 red lines
unaffected: collectibles stay utility-not-yield; payouts remain pre-funded;
artist ≥85% of every transaction; the payout identity gate strengthens (not
weakens) the doctrine. New prices (#1462) land in `docs/rfc/business-model.md`
before any code carries them.
