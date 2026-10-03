# Vision Sprint 30: Crate Digger v1

**Status:** Application implementation is merged; acceptance remains in
progress (originally planned 2026-10-29 to 2026-11-18).
**Milestone:** [32](https://github.com/akoita/resonate/milestone/32).
**Goal:** A DJ describes what their set needs and gets a quoted, rights-clear
crate they can buy with one signature.

Direction: [RFC: Taste Engine §5](../rfc/taste-engine.md) ·
[milestone plan](../roadmap/2026-10-taste-engine-milestones.md) · epic
[#1952](https://github.com/akoita/resonate/issues/1952).

## Approved scope and order

| Priority | Issue | Outcome |
| --- | --- | --- |
| P0 | [#1962](https://github.com/akoita/resonate/issues/1962) | Crate request API with visible filters and honest coverage |
| P0 | [#1963](https://github.com/akoita/resonate/issues/1963) | Crate page with rights summary and transition previews |
| P0 | [#1964](https://github.com/akoita/resonate/issues/1964) | Quote, then one-signature batched purchase with a receipt per line |
| P1 | [#1965](https://github.com/akoita/resonate/issues/1965) | rekordbox XML and Serato export |
| P1 | [#1966](https://github.com/akoita/resonate/issues/1966) | `crate.pro` entitlement seam, free for now |
| P2 | [#1967](https://github.com/akoita/resonate/issues/1967) | Bounded watching with optional capped auto-buy |

Order: #1962, #1963, then #1964. The first step of #1964 verifies that the
smart account can batch several marketplace calls; if a contract change turns
out to be needed, it becomes its own issue under the `contracts/AGENTS.md`
ladder and the sprint may split. #1966 lands before #1965 and #1967, which sit
behind it.

## Delivery status

The application work for #1962–#1966 and notification-only crate watching
(#1967) is merged. The export implementation and correction in [PR #2043](https://github.com/akoita/resonate/pull/2043)
are merged; manual rekordbox acceptance remains open in #1965. Optional capped
auto-buy is tracked separately in [#2027](https://github.com/akoita/resonate/issues/2027)
and is outside the delivered scope. Sprint 30 remains open until its acceptance
criteria are verified.

## Exit criteria

- On staging, a DJ goes from a sentence to a paid, receipted crate without
  leaving the page, and a failed line is never charged.
- Every cart line shows the rights obtained before the signature.
- The exported file opens in rekordbox with correct BPM and key.

## Revenue line

Line 3, marketplace take-rate (10%), phase 2 (ADR-BM-6). The artist keeps at
least 85% after on-chain royalties; purchases are voluntary and quoted
(ADR-BM-4). No fee change.
