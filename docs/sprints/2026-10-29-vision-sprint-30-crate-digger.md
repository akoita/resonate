# Vision Sprint 30: Crate Digger v1

**Status:** Closed 2026-10-14. All six approved items are closed and their
work is merged on `main` (originally planned 2026-10-29 to 2026-11-18). The
manual rekordbox/Serato import check carries over to
[#2121](https://github.com/akoita/resonate/issues/2121).
**Milestone:** [32](https://github.com/akoita/resonate/milestone/32).
**Release:** [Milestone 32 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-32-vision-sprint-30-crate-digger)
records the closed application milestone, not a software version or deployment
event.
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

## Delivery status (2026-10-14)

| Issue | Status | Where |
| --- | --- | --- |
| #1962 | `implemented` | #2021: crate request API with visible, editable filters and honest coverage |
| #1963 | `implemented` | #2022: crate page with per-line rights, transition previews, edit and reorder; follow-up #2029 lets the sentence decide the crate size. #2033 (#2032) merges the Marketplace into Crates & Stems with Add to crate |
| #1964 | `implemented` | #2024: quote, one-signature batched purchase and chain-verified receipts per stem; #2040 records the verified purchases at settlement so stems count as owned at once |
| #1965 | `implemented` | #2025: rekordbox XML and Serato crate export with byte-exact fixtures; #2043 gives every stem of a track the mix's grid; #2055 gives them one key and drops the repeated artist from rekordbox titles. Open-source parsers read the fixtures and a real export cleanly; the manual import into rekordbox (optionally Serato) carries over to #2121 |
| #1966 | `implemented` | #2021 and #2026: `crate.pro` seam, free for everyone, with per-feature `pro`, `export` and `watch` decisions |
| #1967 | `implemented` (slice A) | #2026: watch a saved crate for new releases, notify only; #2028 points the optional capped auto-buy at #2027, which is outside the delivered scope |

## Exit criteria

- On staging, a DJ goes from a sentence to a paid, receipted crate without
  leaving the page, and a failed line is never charged.
- Every cart line shows the rights obtained before the signature.
- The exported file opens in rekordbox with correct BPM and key.

The purchase flow is covered by unit, integration and Playwright tests (the
signing step cannot run under mock auth). For the export, byte-exact fixtures
and open-source parsers confirm tempo, key, the first-beat cue and the paths,
including on a real export. Opening the file in rekordbox itself needs
a person with the app and is tracked in #2121.

## Carry-over and next milestone

- #2121: manual rekordbox (and optional Serato) import check.
- #2027: optional capped auto-buy for watched crates.
- Epic #1952 stays open for its later deliverables.

Next in the approved sequence:
[Vision Sprint 31: Scene Scout](2026-11-19-vision-sprint-31-scene-scout.md),
whose acceptance is in progress.

## Revenue line

Line 3, marketplace take-rate (10%), phase 2 (ADR-BM-6). The artist keeps at
least 85% after on-chain royalties; purchases are voluntary and quoted
(ADR-BM-4). No fee change.
