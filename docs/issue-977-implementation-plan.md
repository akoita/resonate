# Issue 977 Implementation Plan

Issue: [#977](https://github.com/akoita/resonate/issues/977)

## Goal

Use the running analytics pipeline to make AI DJ recommendations, Session
Intent presets, and future creative-agent behavior more adaptive, measurable,
and explainable.

## Current Foundation

- The analytics ledger and warehouse path can export playback, commerce,
  rights, agent, and generation events.
- `AgentSelectorService` already has deterministic and model-assisted ranking
  paths with strict fallback behavior.
- `AgentBigQueryTasteSignalService` can consume bounded BigQuery taste scores
  from `user_track_recommendation_scores`.
- Session and mood/vibe flows already create agent-facing preference signals.

## Workstreams

1. Data materialization: implement #981 so analytics events produce the serving
   table contract documented in `docs/features/agent_taste_intelligence.md`.
2. Offline ML evaluation: implement #978 to compare BigQuery ML scores against
   the deterministic selector before promotion.
3. Explanations: implement #983 so analytics-derived scores produce bounded,
   listener-safe recommendation reasons.
4. Feedback loop: implement #980 so mood, vibe, and Session Intent outcomes are
   represented consistently in `AgentSignal` metadata.
5. UI/UX: implement #979 to turn the current preset gallery into a compact,
   instrumented Session Intent control.
6. Measurement: implement #982 so operators can see recommendation quality,
   preset effectiveness, score freshness, and model version behavior.

## Recommended Order

1. Start with #979 and #980 together, because the UI needs instrumentation at
   the moment users express intent.
2. Follow with #981, using the new intent/outcome fields as materialization
   inputs when available.
3. Add #982 before broad rollout so quality regressions are visible.
4. Use #978 to decide whether ML output should blend with or replace the
   baseline table.
5. Add #983 once the score and metadata fields are stable enough to explain.

## Safety Constraints

- Keep deterministic ranking as the online fallback.
- Do not run unbounded warehouse scans inside recommendation serving.
- Do not expose raw listener history in explanations.
- Use configured environment variables and existing analytics configuration
  patterns instead of hardcoded project, dataset, or endpoint values.
- Update `docs/features/README.md`, `docs/features/agent_taste_intelligence.md`,
  and deployment environment docs whenever serving contracts or env vars change.

## Initial UX Decision

Keep the AI DJ preset panel as a product concept, but redesign it. The useful
primitive is not the large visual cards; it is explicit listener intent. The
next UI should make the selected intent, generated constraints, and start
action obvious while emitting analytics events for viewed, selected, started,
accepted, skipped, saved, and purchased outcomes.
