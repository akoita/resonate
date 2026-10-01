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

Listeners can also type what they want in their own words ("less drill, more
live instruments"), review the exact proposed changes as editable statements,
and apply only what they confirm (#1961, ADR-TE-5). See
[Taste edits in your own words](#taste-edits-in-your-own-words). This is
vision-neutral quality work (taste passport for Listener Pro, Line 4 phase 4,
ADR-BM-6); it changes no fee, split or price.

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
- Under **Tell us what you want more or less of**, type a wish in your own
  words and choose **Preview changes**. Each proposed change is a row you can
  untick, switch between more and less, or remove; **Apply** saves only the
  ticked rows. Nothing is written before Apply.
- Restore individual signal controls when they should influence discovery
  again. Entries written by taste edits are labeled as declared and are removed
  with the same control (**Remove** for boosted entries and notes,
  **Restore** for hidden ones).
- Reset taste memory to ignore older taste signals from recommendation and AI
  DJ learning inputs.

API:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/recommendations/taste-memory` | Return sanitized summary, settings, controls, and privacy notes for the authenticated listener. |
| `PATCH` | `/recommendations/taste-memory/settings` | Update privacy and explanation settings. |
| `POST` | `/recommendations/taste-memory/reset` | Set a reset marker and clear the persisted learned profile. |
| `POST` | `/recommendations/taste-memory/signals` | Hide or downrank a safe taste signal. |
| `DELETE` | `/recommendations/taste-memory/signals/:id` | Restore (remove) any control, including declared ones. |
| `POST` | `/recommendations/taste-memory/edits/preview` | Body `{ text }` (1-500 characters). Returns `{ items }`, the proposed edits. **Never writes.** |
| `POST` | `/recommendations/taste-memory/edits/apply` | Body `{ items: [{ signalType, value, action }] }` (1-20 items). Validates every item, upserts only the confirmed ones as declared controls, returns the updated taste memory plus `edits: { appliedCount, ignoredCount }`. |

`POST /recommendations/taste-memory/signals` keeps its original contract: it
accepts only `hidden` and `downranked` on the original signal types. `boosted`,
`energy` and `note` controls can only be written through confirmed taste edits.

## Taste edits in your own words

ADR-TE-5 / [RFC §3.6](../rfc/taste-engine.md): natural-language edits are parsed
into declared signals and shown back for confirmation before they apply.

**Flow.** Preview parses the text and returns proposed items; the listener edits
the list; Apply receives only the confirmed `(signalType, value, action)` triples.
The server re-validates each one, so the preview output is a proposal, not
authority.

**Parser scope (`taste_edit_parser.ts`, deterministic, pure).** Clauses are split
on commas, semicolons and "and" ("drum and bass" and "rhythm and blues" stay
whole). Cues: *more, love, want, like* for more; *less, fewer* for less; *no,
without, avoid, stop, hide, hate* as rejections. A bare follow-on clause
("less drill and trap") inherits the previous direction; a bare genre with no
direction is reported as unmapped rather than guessed.

| Item kind | Stored as (`signalType` / `action`) | Notes |
| --- | --- | --- |
| `boost_genre`, `downrank_genre` | `genre` / `boosted`, `downranked` | Catalog genres plus aliases (hip hop, lofi, rnb, dnb...). Genre "hide" phrasing maps to downrank; hiding a whole genre stays a manual control. |
| `boost_mood`, `downrank_mood` | `mood` / `boosted`, `downranked` | Focus, Hype, Dark, Zen, Club, Late Night, Warm. "Chill" is energy, not a mood. |
| `energy_preference` | `energy` / `boosted`, value `low`, `medium` or `high` | "more energetic", "calmer", "chill". "Less energetic" flips the band. One declared band at a time: the newest replaces the rest. |
| `hide_artist` | `artist` / `hidden` | Only when the name matches an existing artist display name (case-insensitive) and the clause is a rejection ("no", "hide"...). The parser itself is pure: the service looks names up read-only and injects the result. |
| `written_preference` | `note` / `declared` | Instrument and production phrases ("more live instruments"). **Stored and shown, with no ranking effect in this slice.** |
| `unmapped` | never stored | Shown honestly ("Couldn't map 'x' to a taste signal"), not selectable, ignored if sent to Apply. |

The genre and mood vocabulary mirrors the artist upload form's suggestions
(there is no shared backend list yet). Input is bounded to 500 characters and 10
clauses; clauses beyond the bound are reported as unmapped, not dropped silently.

**Declared semantics.**

- Applied edits are controls with `source: "declared_text_edit"`. They are
  visible and removable like every other control, and **never decay**: controls
  have no time-based weight, and taste-memory reset does not delete them.
- `boosted` weights a matching genre, mood or artist signal at x1.5
  (`BOOSTED_SCORE_MULTIPLIER`); `downranked` stays x0.35; `hidden` still wins
  over everything.
- Declared taste overrides inferred taste (ADR-TE-2 rule 6). Boosted genres and
  moods are added to recommendation preference matching next to the listener's
  own, a declared energy band fills in only when no energy was requested, and
  the shared ranking core adds a `declared_preference` signal (weight 20, above
  the learned-preference cap of 18) explained as "You asked for more of this".
  The AI DJ and learned profile pick the boost up through
  `scoreMultiplierForSignal`; the DJ's own queries and session energy are left
  alone.
- A `note` reaches no ranking map. The UI and this page say so: it is a saved
  statement of preference until a later slice gives it an effect.
- A declared edit on a signal that already has a control replaces that control
  (one control per signal type and value).
- Home: declared boosts reach the rails through `getRecommendations`, but a
  listener whose only declared taste is a boost still sees the honest
  cold-start rail until they save a preference or play something.

**Model parser (follow-up [#2006](https://github.com/akoita/resonate/issues/2006), not shipped).** `TasteEditParser` is the seam: the
service takes a parser implementing it, and only the deterministic one exists.
A model-backed parser would return the same `ProposedTasteEdit` items, go through
the same preview, confirmation and server validation, and must never widen the
allowed (signalType, action) combinations (`DECLARED_EDIT_RULES`).

## Privacy Boundaries

The taste memory response is intentionally sanitized. It does not expose raw
listening events, raw analytics rows, wallet identifiers, NFT ownership state,
emails, URLs, exact private counts, or model internals. Social/cohort matching
is disabled by default and must be explicitly enabled by the listener before
future matching features can consume private taste data.

Taste-signal values and optional sources have an 80-character raw limit. The
backend rejects an over-limit required value before tag, control-character, or
whitespace normalization begins. Valid values at the limit remain accepted,
and the same bounded normalizer governs agent-learning metadata and taste-memory
labels.

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
- Taste edit parser, vocabulary and DTOs:
  `backend/src/modules/recommendations/taste_edit_parser.ts`,
  `backend/src/modules/recommendations/taste_edit_vocabulary.ts`,
  `backend/src/modules/recommendations/taste_edit.dto.ts`
- Settings UI:
  `web/src/components/settings/TasteMemorySettingsPanel.tsx`,
  `web/src/components/settings/TasteEditSection.tsx`

## Analytics

Taste memory changes emit governed analytics/domain events:

- `taste_memory.settings_updated`
- `taste_memory.signal_hidden`
- `taste_memory.signal_downranked`
- `taste_memory.signal_boosted`
- `taste_memory.edits_applied` (counts only: applied, ignored, boosted,
  downranked, hidden, declared)
- `taste_memory.signal_restored`
- `taste_memory.reset`

These events use the `taste_memory_controls:v1` consent basis in the domain
event bridge and carry only safe setting or signal metadata. The free text a
listener types is never logged, stored or published; a written note's text is
stored only as the control the listener confirmed, and is omitted from every
event, including the restore event when it is removed.

Agent-mediated playback analytics can now carry `initiator`,
`agentOriginated`, `agentSessionId`, and `playbackCommandId` markers. Downstream
taste learning should continue to respect `agentPlaybackTrainingEnabled` before
using those agent-originated playback signals.

## Verification

Focused coverage:

- `backend/src/tests/recommendations.controller.spec.ts`
- `backend/src/tests/recommendations.controller.http.spec.ts` (taste edit routes: auth, 400 cases)
- `backend/src/tests/recommendations.integration.spec.ts`
- `backend/src/tests/taste_edit_parser.spec.ts`
- `backend/src/tests/taste_memory_declared_policy.spec.ts`
- `backend/src/tests/taste_edits.integration.spec.ts` (preview writes nothing, apply writes only confirmed items, invalid combinations rejected, boosted preference matching, removal restores; CI only, needs Docker)
- `backend/src/tests/agent_learning.spec.ts`
- `backend/src/tests/agent_learning.integration.spec.ts`
- `web/src/lib/api.test.ts`
- `web/src/components/settings/tasteEdits.test.ts`
- `web/src/components/settings/TasteEditSection.test.tsx`

Manual smoke:

1. Open `/settings` with an authenticated wallet.
2. Confirm the Taste Memory section renders with empty-state copy when no
   profile exists.
3. Hide a genre and confirm future recommendation reasons no longer show it.
4. Disable AI DJ playback training and confirm agent-originated playback does
   not create new taste signals.
5. Reset taste memory and confirm recommendations fall back until new signals
   are recorded.
6. Type "less drill, more live instruments", choose Preview changes, and confirm
   nothing is listed under controls yet. Untick one row, Apply, and confirm only
   the ticked rows appear, labeled as declared, and that Remove undoes each.
