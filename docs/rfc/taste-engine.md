# RFC: Taste Engine — one recommendation framework, three faces (Session DJ, Crate Digger, Scene Scout)

- **Status:** accepted 2026-09-30 (ADR-TE-1…6 accepted on [#1953](https://github.com/akoita/resonate/issues/1953))
- **Date:** 2026-09-30
- **Owner:** @akoita
- **Tracking epic:** [#1952](https://github.com/akoita/resonate/issues/1952)
- **Decisions:** [ADR-TE-1…7](../strategy/taste-engine-decisions.md) (ADR-TE-1…6 accepted on [#1953](https://github.com/akoita/resonate/issues/1953); ADR-TE-7 proposed in [#1976](https://github.com/akoita/resonate/issues/1976))
- **Strategy:** [AI DJ Rethink and Taste Engine](../strategy/ai-dj-taste-engine-2026-09.md)
- **Sequencing:** [Taste Engine milestone plan](../roadmap/2026-10-taste-engine-milestones.md)
- **Extends:** [RFC: Discovery Intelligence](discovery-intelligence.md) (epic
  [#1447](https://github.com/akoita/resonate/issues/1447)), which stays the
  ranking-infrastructure plan. This RFC defines what the ranking optimizes,
  which rules bind it, and the three products built on it.
- **Supersedes in part:** the AI DJ as an autonomous stem buyer
  (`docs/features/agent_taste_intelligence.md`, epic
  [#977](https://github.com/akoita/resonate/issues/977)).
- **Revenue line & phase (required statement):**
  - Taste framework (§3): **vision-neutral infrastructure and quality**.
  - Crate Digger (§5): **Line 3, marketplace take-rate (10%)**, phase 2
    (Oct–Dec 2026); advanced features on an entitlement seam for **Line 2,
    Artist Pro**.
  - Scene Scout (§6): **Line 2, Artist Pro**, phase 2; converts into Line 1
    (Shows, 6%) and Line 3.
  - Session DJ (§4): **Line 4, Listener Pro**, phase 4 (Q1 2027 gate of
    500–1,000 genuine weekly active listeners); pay-per-play settles on the
    x402 personal rail at the canonical 15% take.
  - MCP `crate.build` (§5.7): **Line 5, B2B and agents**, last.
  - No new fee, split or price. ADR-BM-4 compliance is stated in §10.

## 1. Problem

The AI DJ proves an agent can read listening analytics and buy stems on-chain
without a human, but nobody wants that: listeners want to listen and support,
and DJs want to choose what they pay for. Meanwhile the recommendation stack has
no written objective, no binding rules, and no product for the two audiences
that actually pay (DJs and producers through the marketplace, artists through
Artist Pro). Full findings: [strategy §1](../strategy/ai-dj-taste-engine-2026-09.md#1-findings-a-fine-machine-with-no-job).

Three code facts shape the design:

1. **Audio features are measured on separated stems only.** The demucs worker
   extracts tempo, beats, key, RMS energy and onset density for each separated
   stem (`workers/demucs/main.py`, `extract_stem_features`) and ingestion
   stores them on `Stem.audioFeatures` (`stem-result.subscriber.ts`). The
   `original` stem row is written at ingestion without features; only the
   admin backfill (`POST /admin/stems/backfill-audio-features`), which selects
   every unencrypted stem without features, can reach it today. The ranker
   ignores measured features either way and uses metadata-inferred ones
   (`agent_audio_feature.service.ts`, `source: "metadata_inferred"`). Real
   mixing and audio-aware search need full-mix measurement first.
2. **Generation paths sit next to the session code.** The orchestrator
   generates tracks when fewer than `SPARSE_CATALOG_THRESHOLD = 3` matches
   exist; it serves the admin-only `POST /agents/run`, `/agents/orchestrate`
   and `/agents/runtime` routes and the evaluation harness, not listener
   sessions. `AgentMixerService.generate` would create Lyria transitions and
   fills, unbilled, but no route calls it. Both are removed before any
   listener path can adopt them (ADR-TE-4).
3. **The shared ranking core exists.** `DiscoveryRankingService`
   (`backend/src/modules/recommendations/discovery-ranking.service.ts`, #1448)
   already serves Home; the DJ selector is not fully routed through it yet
   (#1456).

## 2. Goals and non-goals

**Goals**

- One taste model and one ranking core behind every surface: Home, listening
  sessions, crates, the artist cockpit, and external agents.
- A written objective (resonance) and written rules (ADR-TE-2) that tests can
  assert.
- A listener-owned taste profile that can be seen, edited, exported and reset.
- Three products that give each audience a reason to come back: the Session
  DJ, the Crate Digger and Scene Scout.
- No agent spending without an approved quote (ADR-TE-1).

**Non-goals**

- Replacing the Discovery Intelligence workstreams (candidates, embeddings,
  collaborative filtering, marts). This RFC consumes them.
- Real-time AI generation in listening sessions (ADR-TE-4).
- Contract changes. Batched purchases use the existing smart account.
- Social feed ranking (epic #996).
- Paid placements of any kind (ADR-TE-2.1).

## 3. The taste framework

### 3.1 Taste model: five layers weighted by commitment

| Layer | Signals | Source today | Weight rule |
| --- | --- | --- | --- |
| **Commitment** | Purchase, Shows pledge (settled), collected moment, published remix of a track, follow | `purchase` in `AGENT_SIGNAL_WEIGHTS`; others new | Highest; slow decay |
| **Declared** | Hide, downrank, reset (#1009); "less of this"; written preferences; passport edits | Taste memory controls | Overrides inference (ADR-TE-2.6) |
| **Behavioral** | Full play, replay, loop intent, save/removal, playlist add, skip, early skip | `AgentSignal` (#1449, #2062) | Configured weights; behavioral decay implemented in #2063 |
| **Context** | Session intent, coarse time of day/week, session position | Session request and bounded signal metadata (#2062) | Current request steers ranking; coarse contextual affinities are implemented in #2063, without changing declared taste |
| **Scene** | City and community aggregates above `DISCOVERY_MIN_AUDIENCE` | Popularity marts (#1451) | Lowest; cold start and exploration only |

Proposed additions to `AGENT_SIGNAL_WEIGHTS`
(`backend/src/config/agent_learning.ts`, re-exported by the learning service), as starting values
to tune with the offline evaluation (#978, #1455):

| Action | Weight | Notes |
| --- | --- | --- |
| `purchase` | 5 (unchanged) | Counted only after settlement |
| `pledge` | 6 | Shows pledge; removed on refund |
| `collect` | 5 | Paid or free moment collect |
| `remix_published` | 6 | On the source track |
| `follow` | 4 | On the artist's catalog |
| `less_of_this` | −4 | Declared; also written to taste memory as a downrank |

Habit telemetry [#2062](https://github.com/akoita/resonate/issues/2062) adds
configured `loop` (+2.5) and `unsave` (−2) weights. Loop intent is capped once
per track/browser session across segment loops and finite repeat counts; a
completion within seven days of an earlier completed play maps to the existing
`replay` (+2) weight. The browser sends only hour and weekday categories,
never a time zone or exact local clock. These categories are retained as bounded
signal metadata and warehouse dimensions, under analytics consent and the
playback-training setting. See the [learning-loop contract](../features/agent_taste_intelligence.md#learning-from-listening-habits-2062).

Decay: behavioral signals use a 60-day half-life, commitment signals 365 days,
declared signals never decay until the listener removes them. Weights and
half-lives are configuration, not constants in code paths. The v2 implementation
(#2063) reads at most 500 newest signals within 730 days, retains v1 genre fields,
and adds mood, credited artist, measured energy/tempo and coarse context maps.
Taste Memory shows safe summaries from the same governed computation. The
profile reads no inferred audio features and recomputes at read time to apply
current decay and controls.

Listening lanes (#2064) group repeated sessions by governed catalog genre/mood
and coarse context, merge similar groups deterministically, and expose up to
six lanes with strength and measured energy. Two natural lanes satisfy the
separate-habits fixture; the implementation does not fabricate a third.
Insufficient evidence retains the single-profile fallback. Hidden values are
excluded and listeners can hide a lane from future mixes in Taste Memory.
See the [implemented lane contract](../features/agent_taste_intelligence.md#listening-lanes-2064)
for thresholds and cache lifecycle. My Mix (#2065) blends visible lanes with
strength/context shares and whole-track quotas. Session edits do not change
Taste Memory unless explicitly saved; missing lane coverage stays visible even
when another lane fills its slots. The shared exploration and diversity policy
still applies. See [My Mix](../features/agent_taste_intelligence.md#my-mix-2065).

Manipulation protection (ADR-TE-2.5): signals from accounts younger than the
trust threshold or flagged as anomalous are down-weighted; self-plays and
self-purchases never count toward the artist's own reach; commitment signals
count only after settlement.

### 3.2 Track representation

Each track carries five groups of features:

1. **Metadata:** genre, mood, credits, release date, AI declaration.
2. **Measured audio (new, full mix):** tempo and confidence, beat grid anchor
   (`firstBeatSec`), key and mode with confidence, Camelot code, RMS energy,
   onset density, duration. Stored on the `original` stem row's
   `audioFeatures` with the existing `stem-audio-features/v1` schema and
   sanitizer, extracted at ingestion through the worker's existing
   single-file `/analyze` path. The existing backfill
   (`stem-feature-backfill.service.ts`) already selects `original` rows; it
   gains a type filter so the catalog's full mixes can be backfilled first and
   progress reported per type. `agent_audio_feature.service.ts` then reads
   measured values first (`source: "measured_full_mix"`) and falls back to
   inferred ones.
3. **Embeddings:** the real content embeddings of #1452, replacing the 16-dim
   hash.
4. **Rights and availability:** separated stems available and their quality
   (#322), license types offered and prices, export permission.
5. **Trust:** verified human artist, AI label, ingestion trust state.

Key compatibility uses the Camelot wheel (same key, ±1, relative
major/minor), applied only when both key confidences are above a threshold.
Below it, the planner treats the pair as unknown, not incompatible.

### 3.3 Objective and metrics

- **Resonance label:** a track resonates for a listener when it is played to
  at least 90% of its length and then replayed or saved within seven days.
- **Resonant discovery:** a resonant track by an artist the listener had never
  played before the session.
- **North-star:** resonant discoveries per active listener per week.
- **Guardrails:** early-skip rate, exploration share actually served, share of
  recommendations going to verified human artists, artist concentration
  (share of the top 10 artists in all recommendations), and the deterministic
  fallback rate.

The ranker optimizes resonance, not minutes played. The agent quality
dashboard (`GET /analytics/agent/quality`) and the #1455 measurement work add
the north-star and guardrails per surface.

### 3.4 Pipeline and policy stage

The four-stage shape of the Discovery Intelligence RFC (§3–4) stays:
candidates, ranking, policy, feedback. This RFC fixes the policy stage, which
every surface calls and tests assert:

1. Apply declared taste (hides, downranks, "less of this") before anything
   else.
2. Remove fully AI-generated tracks unless the request explicitly asked for AI
   content (ADR-TE-2.3).
3. Reserve the exploration share (default 20% of a session or page, at least
   one track) for verified human artists the listener has never played,
   chosen by taste fit.
4. Apply diversity caps (at most two tracks per artist per page or per 10
   session tracks). A listening session that would otherwise dead-end (#2056)
   relaxes only the 10-track session window, never the per-page cap; then,
   mid session and only once every matching track has played, it widens to
   the newest catalog-wide tracks. A request nothing in the catalog matches is
   never widened: the session says so and the gap is recorded as demand
   (ADR-TE-4). Session tracks are never repeated, and rules 1, 2 and 3 are
   never relaxed.
5. Attach a categorical explanation to every item (§3.5).
6. Never read payment, placement or partner data. The policy stage has no
   input through which ranking could be bought (ADR-TE-2.1). Commercial
   availability is a filter a DJ chooses, never a boost: the `listed` signal
   (+14, "Purchasable stem available") in `DiscoveryRankingService` leaves
   listener ranking and survives only as a Crate Digger filter.

The deterministic fallback (no warehouse, no embeddings, no LLM) must still
pass the same policy assertions.

### 3.5 Explanations

A bounded vocabulary, shared by all surfaces and localized in the web app:

- "Because you saved {n} {genre} tracks this month"
- "New from an artist you follow"
- "Fits your {intent} session: {bpm} BPM, {energy} energy"
- "Discovery pick: new verified artist close to your taste"
- "Popular with listeners in {city}" (only above the audience threshold)
- "Matches your crate: {key}, {bpm} BPM, acapella available"

Explanations never name another listener or list their history.

### 3.6 Taste passport

- **View:** the layers of §3.1 as readable statements ("You commit to Afro
  house and Amapiano; you are exploring jazz").
- **Edit:** remove a statement, pin one, add a written preference; edits are
  declared signals.
- **Export and reset:** a versioned JSON document (`taste-passport/v1`) with
  declared preferences, top genres and artists, and commitment summaries,
  never raw events; reset already exists (#1009).
- **Natural-language edits** ("less drill, more live instruments") are parsed
  into declared signals and shown back for confirmation before they apply.

### 3.7 Privacy

The existing consent machinery applies unchanged (`shouldTrainAgentPlayback`,
`canUseTasteForSocialMatching`, taste memory). Scene aggregates respect
`DISCOVERY_MIN_AUDIENCE`. Artists only ever see aggregates.

## 4. Session DJ (listeners)

The rebuilt AI DJ: sessions curated for an intent and mixed on the full track.

1. **Intent to arc.** A request ("40-minute run, building energy") becomes a
   duration and an energy curve (start, peak, end) plus genre and discovery
   parameters. A deterministic parser handles presets and common phrases; an
   optional LLM parser produces the same structure and is always shown back as
   editable controls.
2. **Selection.** The shared ranker scores candidates with the intent as
   context; a sequencer then orders them along the energy curve, preferring
   tempo within ±6% (or a clean half/double tempo) and Camelot-compatible keys.
3. **Transitions.** A deterministic transition plan per pair: crossfade length
   in bars from the tempo, beat-aligned entry from the beat grid, EQ low-cut
   blend on the outgoing track, optional filter sweep. Executed with the
   `remix-fx` DSP contract in the browser (WebAudio) with a server pre-render
   fallback for weak devices. No generation, no GPU.
4. **Honest gaps.** If the catalog cannot fill the intent, the session is
   shorter and says so; the gap is recorded as demand (§6.3). The
   sparse-catalog generation path is removed (ADR-TE-4).
5. **Next action.** After a resonant discovery, one card offers a single
   action: follow, save, join the artist's room, back the artist's Shows
   campaign in the listener's city, or collect a moment. Never more than one
   card per 20 minutes.
6. **Pay-per-play (Listener Pro, later).** Each play settles from the
   listener's pre-funded, capped budget to the artist played on the x402
   personal rail (85% artist, 15% platform), with a monthly statement. This is
   the only standing agent authorization (ADR-TE-1.2).

Free listeners get sessions with presets; custom intents, the discovery slider
and pay-per-play are Listener Pro candidates behind an entitlement seam.

### 4.1 Sonic Radar becomes the discovery journal

`web/src/app/sonic-radar/page.tsx` stops listing agent purchases and becomes:

- the tracks that resonated, grouped by session, with their explanation;
- one next action per artist;
- headline numbers: resonant discoveries this week and new artists;
- with Listener Pro: "where your money went", the per-artist pay-per-play
  statement.

Purchase history moves to the Crate Digger's crate history for DJs and to the
existing wallet and library views for everyone.

## 5. Crate Digger (DJs and producers)

### 5.1 Request

`POST /crates/requests` accepts either text ("peak-time Afro house, 122–124
BPM, acapella available, under $20 total") or a reference track. The parser
returns **visible, editable filters**: BPM range, keys (with Camelot
neighbors), energy range, required stems, license type, maximum total and per
item, verified human only. The LLM parser is optional; the filters are the
contract.

### 5.2 Search and ordering

Candidates come from the measured features, the rights data and the shared
ranker (with the DJ's taste). The result is ordered for a set: a path through
energy and harmonic compatibility, with a preview of each transition using the
Session DJ planner. The response always states coverage honestly
("3 of 8 found") and records unmet filters as demand (§6.3).

### 5.3 Crate page

A crate page (`/crates/:id`) shows each line with BPM, key, energy, available
stems and their quality score (#322), license options and prices, and a
transition preview. The DJ can remove, reorder, lock or swap lines.

### 5.4 Quote and one-signature purchase

1. `POST /crates/:id/quote` reuses the negotiator's pricing to produce a quote
   with, per line, the rights obtained, the price, the artist share and the
   platform fee (10% marketplace), plus a total and an expiry.
2. The DJ approves the quote; the backend builds one ERC-4337 user operation
   batching the ERC-20 approval and the marketplace `buy` calls through the
   existing smart account. **No contract change.**
3. Receipts and license proofs are stored per line; a partial failure refunds
   nothing that was not charged and reports which lines failed.

### 5.5 Export

rekordbox XML and Serato crate export for tracks whose license allows
download, with BPM, key and cue at the first beat. Lines without an export
right are listed but not exported.

### 5.6 Pro seam and bounded watching

- A `crate.pro` entitlement seam (pattern: `remix-entitlements.ts`, #1903)
  gates saved crates beyond a free number, export, and watching. Free for now,
  until Artist Pro billing exists.
- **Bounded watching (opt-in):** a saved crate can watch for new releases that
  match its filters and notify; optional auto-buy under a per-item and monthly
  cap uses the existing session keys, with a receipt and notification per
  purchase (ADR-TE-1.3).

### 5.7 External agents

Later, the same capability as an MCP tool `crate.build` that returns a quote,
never a purchase. Payment follows the existing x402 and quote contract (#1006).

## 6. Scene Scout (artists)

### 6.1 Qualified demand

Aggregates per track and per city: resonant plays, saves, follows, purchases
and pledges over 7 and 28 days, only above `DISCOVERY_MIN_AUDIENCE`. No
listener identity reaches the artist.

### 6.2 Next action in the cockpit

The artist action cockpit (#1121) already ships 15 deterministic card types
(`ArtistActionCardType` in `backend/src/modules/analytics/analytics.service.ts`)
with a stable card schema, a minimum-signal floor and impression/click
analytics. Its Shows card (`review_show_city_demand`) reads explicit
city-interest joins on an existing campaign. Scene Scout adds card types driven
by listening demand, for example proposing a Shows campaign in a city where
none exists yet, publishing a stem DJs keep asking for, or reading a new
release's reception. Each card shows the evidence and one action. With too
little data, it says "not enough listening yet" instead of guessing.

### 6.3 What pros searched for

Unmet crate filters and honest session gaps become "searched but missing"
signals: for example "DJs looked for an acapella of this track 14 times this
month". The implemented request/session slice uses canonical single-filter
near matches, current consent and 28-day requester-observation expiry. Only
thresholded category totals become `DemandSignal` snapshots; these sources
have no trustworthy city dimension. Stem and license cards open the existing
release supply controls. See [Scene Scout](../features/scene_scout.md) for the
current contract and external acceptance tracking.

### 6.4 First listeners

Each new release by a verified human artist enters the exploration share of
listeners whose taste fits (§3.4 step 3), and the artist receives a reception
summary after seven days. The implemented source uses the first seven catalog
days (`Release.createdAt`), since publication time is not separately stored.
Reservations enforce one placement per listener/release and 1,000 per release,
with a durable anonymous counter that survives listener erasure. Reception
requires actual consent-qualified plays after placement; follows remain
unavailable. See [Scene Scout](../features/scene_scout.md) for serving thresholds
and lifecycle behavior.

## 7. Agent autonomy and money (ADR-TE-1)

| Path | Who authorizes | Cap | Receipt |
| --- | --- | --- | --- |
| Crate quote purchase | DJ approves the quote | Quote total | Per line |
| Bounded watching auto-buy | DJ writes the rule and the caps | Per item and monthly | Per purchase + notification |
| Pay-per-play | Listener funds and caps the Listener Pro budget | Monthly budget | Monthly statement |
| External agent (`crate.build`) | Owner approves the quote | Quote total | Per line |

The listener DJ's autonomous stem buying stops first: `AgentConfig.sessionMode`
defaults to `curate`, but the Hype and Dark presets
(`web/src/components/agent/AgentSessionPresets.tsx`) set `buy`, so choosing a
mood starts purchases. The presets stop selecting `buy`, `buy` mode is gated
behind an operator flag that defaults off, and the mode is removed once the
crate quote flow ships.

## 8. Removals and freezes

- Remove the orchestrator's sparse-catalog generation
  (`agent_orchestrator.service.ts`, `SPARSE_CATALOG_THRESHOLD`) and the
  mixer's Lyria transitions and fills (`agent_mixer.service.ts`), ADR-TE-4.
- Freeze ERC-8004 identity and reputation publishing, on-chain curator agents,
  and unrequested agent-to-agent negotiation, ADR-TE-6. They proved the
  technology but serve no current customer. Flags (`ERC8004_ENABLED`,
  `ERC8004_REPUTATION_SCHEDULER_ENABLED`, both default off) stay; code stays
  unless it blocks a change. #322 stem quality ratings stay as data for the
  Crate Digger quality filter; only their on-chain publishing is frozen.

## 9. Data model sketch

Indicative; each slice finalizes its own migration under `backend/AGENTS.md`.

- `Stem.audioFeatures` on `original` rows (no schema change).
- `AgentSignal.action` gains `pledge`, `collect`, `remix_published`, `follow`,
  `less_of_this` (string column, no schema change).
- `CrateRequest` (user, text or reference track, parsed filters, created at),
  `Crate` (owner, name, filters, watch settings), `CrateItem` (crate, track,
  position, locked), `CrateQuote` (crate, lines, total, expiry, status).
- `DemandSignal` aggregates (artist, track, city, kind, window, count), written
  only above the audience threshold.

## 10. Business-model conformance

- **ADR-BM-4:** artists receive at least 85% of every crate purchase (10%
  platform) and of every pay-per-play (15% platform); no pool, no recoupment,
  no minimum thresholds; pay-per-play is pre-funded and user-centric; no
  listener is paid for taste; popularity and demand are never payout inputs.
- **ADR-BM-5:** AI content is labeled and kept off human-artist surfaces and
  sessions unless requested.
- **ADR-BM-3:** no unmetered generation remains in listening sessions.
- **ADR-BM-6:** the Crate Digger and Scene Scout serve phase 2 lines; the
  Session DJ's paid features wait for the Listener Pro gate; `crate.build`
  waits for phase 5.
- Fees and prices are unchanged; `docs/rfc/business-model.md` stays
  canonical. Its Listener Pro feature description ("the AI DJ agent is the
  killer feature", "stem preview in the player") is reconciled when ADR-TE-3
  is accepted.

## 11. Rollout

Mapped to milestones in the
[Taste Engine milestone plan](../roadmap/2026-10-taste-engine-milestones.md):

1. Refocus the AI DJ: stop autonomous buying, remove the dormant generation
   paths, Sonic Radar as journal, policy stage assertions, freeze.
2. Audio-aware foundations: full-mix measurement and backfill, measured
   features in ranking, real embeddings (#1452), resonance metrics (#1455).
3. Crate Digger v1.
4. Scene Scout v1.
5. Later: Session DJ mixing and pay-per-play, taste passport export,
   collaborative filtering (#1453), `crate.build`.

## 12. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| Small catalog: crates and sessions come up short | Honest coverage; gaps feed Scene Scout |
| Wrong tempo or key on some tracks | Confidence thresholds; DJs can correct a value, corrections are stored |
| Few listeners: Scene Scout and collaborative filtering weak | Crate Digger first (catalog and features only); "not enough listening yet" states |
| Mixing too heavy on mobile | Server pre-render with the same DSP |
| Batched purchase edge cases (approvals, partial failure) | Simulate the user operation before asking for the signature; per-line receipts |
| Demand data identifying a listener | Aggregates only, audience threshold |

Open questions for the owner:

- Does "AI DJ" stay the brand for the listener face, or become "Session DJ"?
- Export free to attract DJs, or behind `crate.pro`?
- Default exploration share: 20% proposed.
