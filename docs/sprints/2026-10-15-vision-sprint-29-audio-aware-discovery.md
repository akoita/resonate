# Vision Sprint 29: Audio-aware discovery foundations

**Status:** Closed 2026-10-02. All five approved items and their follow-ups
are merged on `main` (planned 2026-09-30 for 2026-10-15 to 2026-10-28; it
started when Sprint 28 closed).
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

## Delivery status (2026-10-02)

| Issue | Status | Where |
| --- | --- | --- |
| #1959 | `implemented` | #2001: the worker measures the full mix (`original` stem) at ingestion, with a derived Camelot code; the admin backfill takes `types` and reports `remainingByType`. Follow-ups: #2014 and #2015 (#2013) run the backfill through the job dispatch when the worker is a Cloud Run Job; #2017 (#2016) detects keys at 22.05 kHz on the harmonic component, and `refresh: true` re-measures older analysis revisions; #2019 (#2018) uses Albrecht–Shanahan key profiles with a per-revision confidence cutoff |
| #1960 | `implemented` | #2002: ranking uses measured tempo, key, Camelot and energy with a per-field `featureSources`, falling back to inferred values when confidence is low; the catalog track response carries measured `audioFeatures` only, and no BPM is shown unless it was measured |
| #1452 | `implemented` | #2004: 768-dim Vertex AI track embeddings in pgvector with an HNSW cosine index, embed on ingest, a bounded admin backfill and `similarTracks`; the provider defaults to `disabled`. Follow-up #2010 (#2003) adds embedding neighbours of saved or finished tracks as a Home candidate source, so a zero-play track is reachable from Home |
| #1455 | `implemented` | #2008: per-surface click, skip, save and completion rates, resonant discoveries, a deterministic ranker holdout (`DISCOVERY_RANKER_EXPERIMENT`) and an offline recall@k/NDCG@k script. Follow-up #2009 (#2005) attributes DJ outcomes to the ranker variant and adds the three sections to `/analytics/agent-quality` |
| #1961 | `implemented` | #2007: "Tell us what you want more or less of" in Settings, previewed and confirmed before it applies. Follow-ups: #2010 gives written notes a ranking effect through note embeddings; #2011 (#2006) adds the optional model-assisted parser, lets a boost alone leave cold start, and refreshes the `/settings` screenshot |

Every variant ranks identically today: #1455 shipped the mechanism that
compares a candidate ranker against `baseline`, not a candidate ranker.

## Exit criteria

- At least 90% of published staging tracks carry measured tempo and key with a
  confidence value.
- A zero-play track is reachable through similarity.
- The quality dashboard reports resonant discoveries and per-surface skip rate.

The code for all three ships in this sprint, with integration coverage for the
cold-start reach (`track_embedding.integration.spec.ts`,
`home_embedding_candidates.integration.spec.ts`). The staging checks (feature
coverage after the backfill, similarity reach once embeddings are enabled, and
the dashboard on staging data) are verified after deployment, in the deployment
half below.

## Deployment half

The staging backfill run and the embedding jobs are tracked in
`resonate-iac#257`.

## Revenue line

Vision-neutral infrastructure for Lines 3 and 4 (ADR-BM-6). Embedding calls are
metered and bounded to backfill plus on-ingest. No fee, split or payout change.
