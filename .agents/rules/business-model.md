# Business model conformance

Paths in code spans are relative to the repository root.

Resonate's monetization direction is governed by **Business Model v2**:

- Vision, sequencing & roadmap: `docs/strategy/business-model-review-2026-07.md`
- Decisions ADR-BM-1…6: `docs/strategy/business-model-phase0-decisions.md`
  (tracked by epic [#1332](https://github.com/akoita/resonate/issues/1332))
- Canonical fee/split numbers: `docs/rfc/business-model.md`

### Rules

1. **Red lines (ADR-BM-4) — never violate in any issue, RFC, or PR:**
   - no royalty-yield or income-share products for fans (securities/Howey);
   - no platform-subsidized payouts on free listening (there is no pro-rata
     pool to drain, so stream fraud is unprofitable — keep it that way);
   - listener-side payouts are pre-funded and user-centric only;
   - artist receives 85%+ of every transaction; no recoupment, no minimum
     thresholds.

2. **State the revenue line and phase.** Any new issue, RFC, or PR touching
   money, fees, payouts, upload/ingestion trust, AI-generation billing,
   collectibles, or licensing must state which revenue line it serves —
   (1) Shows campaign fees, (2) Artist Pro + generation credits,
   (3) marketplace take-rate, (4) Listener Pro, (5) B2B/agent licensing — and
   its phase per ADR-BM-6, or explicitly state that it is vision-neutral
   (infra/quality).

3. **Fee numbers live in one place.** Once an ADR is accepted,
   `docs/rfc/business-model.md` is the single canonical source for fees,
   splits, and prices. Never introduce a new fee, split, or price in code or
   docs without reconciling it there.

4. **Vision labels.** Open issues carry `vision:core` (directly serves a
   revenue line) or `vision:keep` (conformant / vision-neutral) from the
   2026-07 triage (`docs/strategy/issue-triage-2026-07.md`). Label new issues
   on creation; an issue that fits neither label should be challenged before
   work starts.
