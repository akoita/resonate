# Issue #1009 Implementation Plan

## Goal

Give listeners a durable, understandable control surface for the taste memory
that shapes recommendations, agent playback, and future community matching.
The first slice should make the system inspectable and correctable without
exposing raw listening history, wallet data, ownership data, or sensitive
inferences.

## Current Baseline

- `AgentSignal` stores listener-agent feedback with sanitized metadata, and
  `AgentLearningService` computes `AgentConfig.learnedTasteProfile`.
- `AgentConfig.learnedTasteProfile` already exposes a compact score,
  genre weights, favored genres, and aggregate counts, but there is no
  listener-facing governance surface for it.
- `RecommendationsService` has in-memory preferences and recent-track
  fallback behavior, but no durable controls for reset or hidden signals.
- `AgentSelectorService` can blend selected vibes, learned genre weights,
  safe audio features, and optional BigQuery taste scores into AI DJ picks.
- `AgentBigQueryTasteSignalService` maps warehouse explanations into sanitized
  listener reasons, but there is no per-listener control boundary for using
  those scores in social or cohort-style features.
- Analytics governance already stores versioned events and consent basis, but
  user-facing consent controls are still partial.
- The web Settings page currently covers local library sources,
  auto-scanning, and notifications only.

## First Slice

1. Add durable taste memory governance models:
   - one settings row per user for social matching, city/scene discovery,
     agent-originated playback training, and explanation preference;
   - a hidden/downranked signal table for safe signal categories such as
     genre, mood, artist, scene, intent, novelty, replay, and commerce;
   - a reset marker so recommendations and agent learning can ignore signals
     created before the reset without deleting raw event records.
2. Add a backend taste memory service and authenticated API:
   - `GET /recommendations/taste-memory`
   - `PATCH /recommendations/taste-memory/settings`
   - `POST /recommendations/taste-memory/reset`
   - `POST /recommendations/taste-memory/signals`
   - `DELETE /recommendations/taste-memory/signals/:id`
3. Return only a sanitized summary:
   - favored genres and moods when safely available;
   - recent intent categories from safe `AgentSignal` metadata;
   - novelty/replay and commerce preference summaries as coarse labels;
   - hidden/downranked signals and current governance settings;
   - no raw event rows, no wallet identifiers, no ownership claims, no private
     counts, no emails, no URLs, and no model internals.
4. Feed controls into recommendation and agent-serving inputs:
   - hidden genres/moods are excluded from recommendation preference matching;
   - downranked signals lower their weight without disappearing from the
     user-visible control list;
   - reset makes recommendations fall back to fresh/default behavior until new
     post-reset signals exist;
   - agent-originated playback signals do not train taste memory when the
     setting is disabled;
   - social/cohort matching helpers default to disabled unless the user opts in.
5. Add a listener-facing Settings surface:
   - compact taste summary cards;
   - privacy toggles for social matching, city/scene discovery, and agent
     playback training;
   - explanation preference control;
   - hidden/downranked signal management;
   - reset action with clear confirmation and success state.
6. Emit governed analytics events for changes:
   - `taste_memory.settings_updated`
   - `taste_memory.signal_hidden`
   - `taste_memory.signal_restored`
   - `taste_memory.reset`
   - include consent basis and only safe signal category/value metadata.

## Non-Goals

- Do not expose raw listening history or analytics event rows.
- Do not expose wallet data, NFT ownership, private collection state, or
  sensitive inferred attributes in taste explanations.
- Do not build public listener profiles, social cohorts, or city-scene matching
  UI in this issue.
- Do not require BigQuery to be enabled for the local feature to work.
- Do not replace the existing recommendation engine; this issue adds a
  governance layer and wires it into the current serving paths.

## Implementation Notes

- Put the durable service near `backend/src/modules/recommendations/` because
  the first user-facing controls govern recommendation behavior, while exposing
  helper methods for agent code to consume.
- Use a Prisma migration for the settings and hidden-signal tables; do not
  store user governance state in in-memory maps.
- Keep reset as a timestamp marker rather than deleting `AgentSignal` rows, so
  auditability and analytics governance remain intact.
- Teach `AgentLearningService.computeTasteProfile` to ignore pre-reset and
  hidden/downranked signals when it computes the user-facing profile.
- Teach `RecommendationsService.getRecommendations` to sanitize preferences
  before scoring and to avoid returning hidden reasons.
- Keep `AgentSelectorService` explanations sanitized through the existing
  explanation-category mapping; add governance filtering before scores become
  listener-facing reasons.
- Use existing product analytics ingestion patterns rather than introducing a
  new analytics path.

## Validation

Backend:

- Unit tests for sanitized summary shaping and explanation redaction.
- Recommendation tests for hidden-signal exclusion and fallback after reset.
- Agent learning tests for reset windows and agent-originated playback training
  disabled by policy.
- Consent/settings tests proving social matching is disabled by default and
  only enabled after explicit opt-in.
- Analytics instrumentation tests for safe governed events and consent basis.

Frontend:

- API helper tests for taste memory endpoints.
- Settings component tests for available summary data, empty/no-signal state,
  toggles, hidden-signal restore, and reset success state.

Manual:

- Open `/settings` with an authenticated wallet.
- Confirm the taste memory section renders with no learned profile.
- Record or seed taste signals, then confirm only sanitized summaries appear.
- Hide a genre or mood and confirm future recommendation reasons exclude it.
- Reset taste memory and confirm recommendations fall back to fresh/default
  behavior until new signals are recorded.

Docs:

- Update `docs/features/README.md`.
- Add a dedicated `docs/features/listener_taste_memory_controls.md` page.
- Cross-link the feature from Agent Taste Intelligence and Analytics Consent
  And Retention Policy where relevant.
