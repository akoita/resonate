---
title: "Listener Taste Memory Controls"
status: in-progress
owner: "@akoita"
issue: 1009
---

# Listener Taste Memory Controls

## Status

`in-progress`

Listeners can inspect and govern the sanitized taste memory used by
recommendations and AI DJ learning. The first implementation persists privacy
settings, hidden/downranked taste signals, and reset markers in Postgres, then
wires those controls into recommendation preference matching and agent taste
profile computation.

## Who It Is For

- Listeners who want recommendations to remain understandable and correctable.
- Agent developers who need governed taste inputs instead of raw behavior logs.
- Backend and data developers adding future community, cohort, or city-scene
  matching features.
- Privacy/compliance reviewers validating that raw event history and wallet
  data are not exposed in listener controls.

## Value

Taste memory should feel like a listener-owned instrument, not a hidden model.
The control surface lets users see safe summaries, hide or downrank signals,
disable social taste matching, disable city/scene discovery, decide whether AI
DJ-originated playback trains the profile, tune recommendation explanations,
and reset the profile without deleting audit records.

## How To Use

UI:

- Open `/settings`.
- Use the **Taste Memory** section to review safe summaries such as favored
  genres, moods, artists, recent intents, novelty pattern, and commerce
  preference.
- Toggle social matching, city/scene discovery, and AI DJ playback training.
- Add a hidden or downranked signal such as a genre or mood.
- Restore individual signal controls when they should influence discovery
  again.
- Reset taste memory to ignore older taste signals from recommendation and AI
  DJ learning inputs.

API:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/recommendations/taste-memory` | Return sanitized summary, settings, controls, and privacy notes for the authenticated listener. |
| `PATCH` | `/recommendations/taste-memory/settings` | Update privacy and explanation settings. |
| `POST` | `/recommendations/taste-memory/reset` | Set a reset marker and clear the persisted learned profile. |
| `POST` | `/recommendations/taste-memory/signals` | Hide or downrank a safe taste signal. |
| `DELETE` | `/recommendations/taste-memory/signals/:id` | Restore a hidden/downranked signal. |

## Privacy Boundaries

The taste memory response is intentionally sanitized. It does not expose raw
listening events, raw analytics rows, wallet identifiers, NFT ownership state,
emails, URLs, exact private counts, or model internals. Social/cohort matching
is disabled by default and must be explicitly enabled by the listener before
future matching features can consume private taste data.

Reset is implemented as a timestamp marker. Older `AgentSignal` and analytics
records remain available for audit and governed retention, but recommendation
and agent-learning inputs ignore signals before the reset marker.

## Main Code References

- Backend service:
  `backend/src/modules/recommendations/taste_memory.service.ts`
- Backend API:
  `backend/src/modules/recommendations/recommendations.controller.ts`
- Recommendation filtering:
  `backend/src/modules/recommendations/recommendations.service.ts`
- Agent learning policy:
  `backend/src/modules/agents/agent_learning.service.ts`
- Agent selector policy:
  `backend/src/modules/agents/agent_selector.service.ts`
- Web API helpers:
  `web/src/lib/api.ts`
- Settings UI:
  `web/src/components/settings/TasteMemorySettingsPanel.tsx`

## Analytics

Taste memory changes emit governed analytics/domain events:

- `taste_memory.settings_updated`
- `taste_memory.signal_hidden`
- `taste_memory.signal_downranked`
- `taste_memory.signal_restored`
- `taste_memory.reset`

These events use the `taste_memory_controls:v1` consent basis in the domain
event bridge and carry only safe setting or signal metadata.

Agent-mediated playback analytics can now carry `initiator`,
`agentOriginated`, `agentSessionId`, and `playbackCommandId` markers. Downstream
taste learning should continue to respect `agentPlaybackTrainingEnabled` before
using those agent-originated playback signals.

## Verification

Focused coverage:

- `backend/src/tests/recommendations.controller.spec.ts`
- `backend/src/tests/recommendations.integration.spec.ts`
- `backend/src/tests/agent_learning.spec.ts`
- `backend/src/tests/agent_learning.integration.spec.ts`
- `web/src/lib/api.test.ts`

Manual smoke:

1. Open `/settings` with an authenticated wallet.
2. Confirm the Taste Memory section renders with empty-state copy when no
   profile exists.
3. Hide a genre and confirm future recommendation reasons no longer show it.
4. Disable AI DJ playback training and confirm agent-originated playback does
   not create new taste signals.
5. Reset taste memory and confirm recommendations fall back until new signals
   are recorded.
