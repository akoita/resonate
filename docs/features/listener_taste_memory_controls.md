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
  genres, moods, credited artists, measured energy and tempo bands, coarse
  time-of-day preferences, recent intents, novelty pattern, and commerce preference.
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
| `written_preference` | `note` / `declared` | Instrument and production phrases ("more live instruments"). Stored and shown. When the embedding provider is enabled, the note also steers Home through its embedding (below); with it disabled the note has no ranking effect. |
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
- A `note` reaches no ranking map (`hidden`/`downranked`/`boosted`). Its effect
  is a Home candidate source (#2003, #2006): when `TRACK_EMBEDDING_PROVIDER` is
  enabled, applying a note embeds its text as a retrieval query and stores only
  the vector (`ListenerTasteNoteEmbedding`, deleted with the control, kept
  through a taste reset like the control). Home then adds the nearest tracks to
  up to two of the listener's newest notes as candidates, with a small
  `declared_note_match` signal (weight 8, below a declared boost) explained as
  "You asked for more of this". The text is sent to the embedding provider and is
  never logged, published, or stored outside the control. Embedding is
  best-effort: with the provider disabled or failing, the note is saved with no
  vector and has no ranking effect. Removing the note removes the vector and the
  effect. See [Agent Taste Intelligence](agent_taste_intelligence.md)
  §Home candidate source.
- A declared edit on a signal that already has a control replaces that control
  (one control per signal type and value).
- Home: declared boosts reach the rails through `getRecommendations`, and a
  listener whose declared taste includes a boosted genre or mood is **not** on
  the cold-start rail (#2006): they get the personalized rails instead of
  "Catalog signal", and downranks, hides, notes and a lone energy band do not
  count. A declared energy band alone keeps the honest cold-start rail, because
  it re-ranks but gives the personalized rails nothing to anchor on. The check
  is `isColdStart` in `home-feed.service.ts`.

**Model-assisted parsing (optional, [#2006](https://github.com/akoita/resonate/issues/2006)).**
`TasteEditParser` is the seam. The default is the deterministic parser. Setting
`TASTE_EDIT_PARSER_STRATEGY=model-assisted` swaps in `ModelTasteEditParser`
(`model_taste_edit_parser.ts`), selected by the `TASTE_EDIT_PARSER` provider in
`RecommendationsModule`. It reads looser phrasing ("not a fan of Foo", "something
to run to") and returns the same `ProposedTasteEdit` items, through the same
preview, confirmation and server-side validation. The model's answer is treated
as untrusted:

- The model gets only the bounded text (at most 500 characters) and the allowed
  vocabulary, and answers with a JSON schema of `{kind, value, direction?,
  phrase}` items (`kind` and `direction` are enums).
- Every item is re-validated: genre and mood values must map to the vocabulary,
  energy must be `low`, `medium` or `high`, an artist is hidden only when the
  listener's text names it, the direction is a rejection, and the artist lookup
  finds an existing artist (a bounded, read-only query, at most 5 per request),
  and a note must be the listener's own words (bounded like the deterministic
  parser). Nothing outside `DECLARED_EDIT_RULES` can come out.
- The deterministic parser always runs. Its readings win any conflict (same
  signal with a different action, a second energy band). Model items add what
  the rules could not read, and text neither parser could map stays reported as
  unmapped, so the listener sees what was left out.
- A missing key, timeout, provider error, or malformed or empty output returns
  the deterministic result unchanged.
- Privacy: the listener's text is sent to the configured model provider **only**
  when model-assisted parsing is enabled. Neither the text nor the raw model
  output is ever logged; failures log a fixed reason code
  (`timeout`, `invalid_output`, `provider_error`, `missing_api_key`).
- Settings and credentials: see `docs/deployment/environment.md`
  (`TASTE_EDIT_PARSER_STRATEGY`, `TASTE_EDIT_PARSER_MODEL`,
  `TASTE_EDIT_PARSER_TIMEOUT_MS`, `GOOGLE_AI_API_KEY`). Enabling it in a deployed
  environment is a `resonate-iac` change.

Limits: the model does not change what the confirmation list can hold, only how
much of the listener's wording it can read; it adds one model call per preview.

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
analytics-to-taste learning requires both current optional measurement consent
and `agentPlaybackTrainingEnabled`. Disabling training pauses learning from
listener starts, skips, completions, loops, saves, removals, and playlist
additions. Agent-originated playback is excluded from this listener telemetry
mirror. See [learning from listening habits](agent_taste_intelligence.md#learning-from-listening-habits-2062)
for weights, deduplication, and coarse local context.

## Habit summaries (#2063)

Taste Memory uses the same decayed, bounded profile as the learning service;
it does not add a persisted profile to recent signals a second time. Release
moods and credited artist labels feed summaries. Energy and tempo bands require
current full-mix measurements, and context uses only hour buckets and
weekday/weekend categories. Missing evidence leaves an empty summary.

Hide, downrank, boost and reset govern both global and context weights. Reset
clears every learned dimension while keeping declared controls. The response
adds `favoredEnergyBands`, `favoredTempoBands` and `contexts` without exposing
itemized listening history. Existing clients can continue reading the original
summary fields. See [habit profile v2](agent_taste_intelligence.md#habit-profile-v2-2063)
for source, decay and history limits.

## Your listening lanes (#2064)

Taste Memory shows up to six repeated listening patterns as catalog-labelled
cards with coarse times. At least two sessions and sufficient decayed evidence
are required; a new listener may see no cards. Measured energy is shown only
when available. Cards contain no track list or exact listening times.

**Hide from mixes** saves a lane hide; **Restore to mixes** removes it. These
controls prepare for My Mix in #2065, which is not launched by this slice.
Hidden lanes remain visible here for restoration but are excluded from the
mix-facing resolver. Hiding a genre, mood or artist rebuilds the affected lanes.
Reset clears learned lanes and their hides while preserving explicitly declared
preferences. See [listening lanes](agent_taste_intelligence.md#listening-lanes-2064)
for the API, evidence thresholds and caching contract.

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
- `backend/src/tests/taste_memory_profile_v2.integration.spec.ts`
- `backend/src/tests/listening_lanes.spec.ts`
- `backend/src/tests/listening_lanes.integration.spec.ts`
- `web/src/components/settings/TasteMemorySettingsPanel.test.tsx`
- `web/tests/taste-memory-habits.spec.ts`
- `web/src/lib/api.test.ts`
- `web/src/components/settings/tasteEdits.test.ts`
- `web/src/components/settings/TasteEditSection.test.tsx`

Manual smoke:

1. Open `/settings` with an authenticated wallet.
2. Confirm the Taste Memory section renders with empty-state copy when no
   profile exists.
3. Hide a genre and confirm future recommendation reasons no longer show it.
4. Disable AI DJ playback training and confirm listener playback and library
   analytics do not create new taste signals. Repeat with optional measurement
   consent disabled.
5. Reset taste memory and confirm recommendations fall back until new signals
   are recorded.
6. Type "less drill, more live instruments", choose Preview changes, and confirm
   nothing is listed under controls yet. Untick one row, Apply, and confirm only
   the ticked rows appear, labeled as declared, and that Remove undoes each.
