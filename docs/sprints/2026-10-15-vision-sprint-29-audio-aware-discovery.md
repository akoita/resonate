# Vision Sprint 29: Audio-aware discovery foundations

**Status:** Planned 2026-09-30, starts after Sprint 28 closes (indicative
2026-10-15 to 2026-10-28).
**Milestone:** [31](https://github.com/akoita/resonate/milestone/31).
**Goal:** Ranking and search know what every track sounds like (measured tempo,
key and energy) and what it is close to (real embeddings), and a ranking change
is promoted only on a measured win.

Direction: [RFC: Taste Engine §3.2–3.3](../rfc/taste-engine.md) ·
[milestone plan](../roadmap/2026-10-taste-engine-milestones.md) · epic
[#1952](https://github.com/akoita/resonate/issues/1952).

## Approved scope and order

| Priority | Issue | Outcome |
| --- | --- | --- |
| P0 | [#1959](https://github.com/akoita/resonate/issues/1959) | Full mixes are measured at ingestion and the catalog is backfilled |
| P0 | [#1960](https://github.com/akoita/resonate/issues/1960) | Ranking and the catalog API use measured track features |
| P0 | [#1452](https://github.com/akoita/resonate/issues/1452) | Real content embeddings with pgvector HNSW |
| P1 | [#1455](https://github.com/akoita/resonate/issues/1455) | Offline and online measurement, including resonant discoveries |
| P2 | [#1961](https://github.com/akoita/resonate/issues/1961) | Natural-language taste edits, confirmed before they apply |

Order: #1959, then #1960, which reads its output; #1452 in parallel; #1455
once the resonance signals exist.

## Exit criteria

- At least 90% of published staging tracks carry measured tempo and key with a
  confidence value.
- A zero-play track is reachable through similarity.
- The quality dashboard reports resonant discoveries and per-surface skip rate.

## Deployment half

The staging backfill run and the embedding jobs are tracked in
`resonate-iac#257`.

## Revenue line

Vision-neutral infrastructure for Lines 3 and 4 (ADR-BM-6). Embedding calls are
metered and bounded to backfill plus on-ingest. No fee, split or payout change.
