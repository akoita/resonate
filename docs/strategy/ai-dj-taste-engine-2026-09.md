---
title: "AI DJ Rethink and Taste Engine — September 2026"
status: proposed
owner: "@akoita"
created: "2026-09-30"
source_context:
  - docs/strategy/business-model-review-2026-07.md
  - docs/strategy/business-model-phase0-decisions.md
  - docs/rfc/business-model.md
  - docs/rfc/discovery-intelligence.md
  - docs/features/agent_taste_intelligence.md
  - docs/strategy/next_generation_music_platform_analysis.md
  - docs/strategy/agent_mediated_playback.md
related:
  - docs/strategy/taste-engine-decisions.md
  - docs/rfc/taste-engine.md
  - docs/roadmap/2026-10-taste-engine-milestones.md
---

# AI DJ Rethink and Taste Engine — September 2026

> **TL;DR** — The AI DJ was built to prove that an agent can read listening
> analytics and autonomously buy stems through ERC-4337 or x402. It proved the
> technology, but no listener or professional has a reason to hand an AI a
> budget to buy stems for them. The agent should stop buying on people's
> behalf and become what turns taste into consequence: **one taste engine with
> three faces** — a Session DJ for listeners, a Crate Digger for DJs and
> producers, and a Scene Scout for artists. It only spends on a quote a human
> has seen, with one bounded exception: pay-per-play from the Listener Pro
> pre-funded wallet. The recommendation framework weights taste by real
> commitment (purchases, Shows pledges, remixes), lets listeners see and own
> their profile, and never sells ranking.

Decisions: [Taste Engine Decisions (ADR-TE-1…6)](taste-engine-decisions.md).
Design: [RFC: Taste Engine](../rfc/taste-engine.md).
Sequencing: [Taste Engine milestone plan](../roadmap/2026-10-taste-engine-milestones.md).

---

## 1. Findings: a fine machine with no job

Today's AI DJ mixes three roles with different customers: a session curator,
an autonomous stem buyer, and a "mixer" that generates transitions. Only the
first serves a listener, and it already shares its ranking with Home.

| Component | Verified state (2026-09-30) | Verdict |
| --- | --- | --- |
| Shared Home + DJ ranking (`DiscoveryRankingService`, #1448) | Shipped; the DJ selector is not yet routed through it (#1456) | Keep — the foundation |
| `AgentSignal` learning loop (accept 1, skip −1, complete 1.5, save 3, replay 2, playlist add 3, purchase 5) | Shipped, full implicit signals (#1449) | Keep; extend with commitment signals |
| Taste memory controls (hide, downrank, reset, #1009) | Shipped in `/settings` | Basis of the listener-owned profile |
| Measured audio features (BPM, key, energy, onset density, #1184) | Measured on **separated stems only** (`workers/demucs/main.py`); ranking still uses metadata-inferred features (`agent_audio_feature.service.ts`, `source: metadata_inferred`) | Untapped; full-mix measurement is new work |
| Embeddings | 16-dim hashed placeholder (#1452 open) | Replace |
| Negotiator + ERC-4337 purchase + session keys + USDC caps | Shipped; buys stems without a human request | Redirect to a quoted cart |
| `AgentMixerService`: Lyria-generated transitions and fills | Shipped | Remove — unbilled GPU cost, no real mixing |
| Orchestrator generates AI tracks when the catalog is sparse (`SPARSE_CATALOG_THRESHOLD = 3`) | Shipped | Remove — contradicts ADR-BM-5.3 |
| Sonic Radar ("every track your DJ found, negotiated, and secured") | Shipped; a log of per-track personal licenses bought by the agent | Reframe as a discovery journal |
| ERC-8004 identity/reputation, on-chain curator agents | Slices shipped | Technical showcase — freeze |

**Why autonomous buying does not hold up.** A listener does not want to own
stems; they want to listen and support. A DJ wants to choose what they pay
for. Nobody has a reason to hand an AI a budget to buy for them, and every
"surprise" purchase erodes the trust Resonate sells.

**Two inconsistencies to fix regardless.** The orchestrator inserts fully
AI-generated tracks into sessions that promote artists, while ADR-BM-5.3
excludes that content from human-artist promotional surfaces. And each Lyria
transition costs money (about $0.06 per 30 seconds of generated audio, the
internal estimate) without being billed, which ADR-BM-3 forbids ("never
unmetered access"). Both are removed (ADR-TE-4).

**Why stems are not the listener headline.** Stems were a strong technical
learning subject early on. For listeners they add little: listeners want the
right music and a smooth flow; separation artifacts would be audible on a
professional-quality stream; and the value of stems sits with the DJs and
producers who license them. Stems therefore belong to the Crate Digger, Remix
Studio and licensing, not to the listener DJ (ADR-TE-3).

## 2. Constraints that frame the proposal

The proposal follows the accepted decisions and reopens none.

| Source | What it imposes here |
| --- | --- |
| Positioning ([business model review](business-model-review-2026-07.md)) | "Streaming is the storefront, ownership and participation are the products." No catalog-breadth race against Spotify. |
| ADR-BM-4 | Listener payouts pre-funded and user-centric only; never platform-paid listener rewards; no yield products; artist ≥ 85%. |
| ADR-BM-5 | AI declared and labeled; fully-AI content excluded from human-artist promotional surfaces. |
| ADR-BM-6 | Shows → Artist Pro + marketplace take-rate (Oct–Dec 2026) → Listener Pro (Q1 2027, gate of 500–1,000 genuine WAU) → B2B and agents. |
| ADR-BM-3 | Every AI generation is billed in credits, never unmetered. |
| [Discovery Intelligence RFC](../rfc/discovery-intelligence.md) (#1447) | Deterministic fallback always works; no online warehouse scans; categorical explanations. Open: #1450, #1452, #1453, #1455, #1456. |
| [Agent-mediated playback](agent_mediated_playback.md) (#1007) | External agents never start sound without an owner-authorized session; agent plays are marked. |
| [Next-generation platform analysis](next_generation_music_platform_analysis.md) | "Every listen should have a next meaningful action"; no recommender that hides why it acts; the artist cockpit proposes actions (#1121). |

Consequence of ADR-BM-4: a "tastemaker" status for listeners can only be
recognition and utility (badge, early access, an artist-granted perk), never
money paid by Resonate.

## 3. Competition (researched 2026-09-30)

Conversational recommendations and an editable taste profile became the norm
in 2026; doing them no longer differentiates, not doing them disqualifies.
Nobody connects taste, rights, and money flowing from listener to artist.

| Player | What it does | What it lacks |
| --- | --- | --- |
| [Spotify AI DJ](https://www.androidcentral.com/apps-software/spotify/spotify-ai-dj-takes-requests-in-a-new-way-on-android-with-personal-prompts) | Voice and text requests; three personalized prompts by time of day (Oct 2025) | Chains whole tracks without real mixing; no consequence for the artist beyond the pro-rata pool |
| [Spotify Taste Profile](https://techbriefly.com/2026/09/24/spotify-ai-taste-profile-premium-users/) | Adjust recommendations by prompt; exclude what you play but don't want recommended (Sept 24, 2026, US Premium) | Not portable, not explainable per track; no weight for real commitment |
| [Amazon Music Alexa+](https://www.ecoustics.com/news/amazon-music-alexa-plus/) | Conversational search, playlists refined in dialogue, questions about samples and scenes (July 23, 2026) | Conversation over a catalog, not over rights |
| [SoundCloud First Fans](https://sonosuite.com/blog/ai-powered-first-fans-revolutionizes-fan-engagement-on-soundcloud) | AI finds the listeners most likely to love a new artist | Plays still paid from the pool; the artist doesn't learn where fans are or what to do next |
| [SoundCloud direct sales](https://www.musicbusinessworldwide.com/soundcloud-starts-letting-artists-sell-downloads-direct-from-their-profiles-and-says-its-taking-zero-commission/) | Download sales from the profile, zero commission (beta Aug 26, 2026) | No stems or licenses; direct threat to "commerce next to discovery" |
| [Beatport / Beatsource](https://www.digitaldjtips.com/best-music-streaming-services/) | DJ streaming $10.99–$34.99/month, offline capped at 1,000 tracks, stems on some tracks | No remix rights, no license proof, filter search rather than intent |
| [Bandcamp](https://resources.onestowatch.com/best-discover-new-music-bandcamp/) | Discovery through fans' collections | No AI, no sessions, no stems |

**Four angles nobody holds:**

1. **Real mixing, not playlist chaining** — beat- and key-matched sessions on
   measured track features.
2. **Search by intent and by right** — "what my set needs, that I can legally
   remix, under $20" exists nowhere.
3. **Commitment-weighted taste** — purchases, pledges and published remixes
   are signals only a commerce platform has.
4. **No ranking for sale** — Spotify's Discovery Mode trades lower royalties
   for visibility (cited from memory; verify before external use). Resonate
   can promise the opposite in writing (ADR-TE-2).

## 4. Proposal: one taste engine, three faces

The agent is no longer a separate product with its own wallet and dashboard.
It is the intelligence layer that makes each surface useful, and its financial
autonomy is limited to what a person explicitly pre-authorized (ADR-TE-1).

| Face | For whom | What it does | ADR-BM-6 line |
| --- | --- | --- | --- |
| **Session DJ** (the rebuilt AI DJ) | Listeners | Sessions curated for an intent, mixed on measured tempo, key and energy, explained, with one next action after each discovery | 4, Listener Pro (Q1 2027) |
| **Crate Digger** | DJs, producers | Builds a crate from a request, quotes a cart, buys with one signature, exports to rekordbox/Serato | 3, marketplace take-rate (phase 2) |
| **Scene Scout** | Artists | Reads real demand and proposes the next action: Shows campaign, drop, holder benefit, stem pricing | 2, Artist Pro (phase 2) |

### 4.1 Session DJ (listeners)

- **Real mixing on the full track**: tempo-synced crossfades and EQ blends,
  executed by the deterministic DSP already shipped in Remix Studio
  (`remix-fx`, `remix-structure`). No AI generation, no GPU cost.
- **Session arc**: an intent ("energy build for a 40-minute run") becomes an
  energy curve, not a list.
- **Discovery on purpose**: a familiar ↔ unknown slider drives the exploration
  share, with at least one new verified human artist per session.
- **Next action, never forced**: after a track that truly connected, one card
  offers follow, save, join the artist's room, back the Shows campaign in your
  city, or collect a moment.
- **Money that follows listening** (Listener Pro): each play settles from the
  pre-funded budget to the artist played (≥ 85%), with a readable monthly
  statement.

**Sonic Radar becomes the discovery journal.** It stops being a log of
per-track purchases and shows the tracks that resonated (played in full, then
replayed or saved within 7 days), grouped by session, with a categorical reason
and one next action per artist; with Listener Pro it adds the "where your money
went" statement. Its headline number becomes resonant discoveries, not "total
spent" (ADR-TE-5). For DJs, purchases live in the Crate Digger's crate history.

### 4.2 Crate Digger (DJs and producers)

- Request in plain language or by reference track, turned into **visible
  filters**: BPM, key and Camelot compatibility, energy, available stems
  (acapella, drums), license type, maximum price, verified human artist.
- A **crate ordered for a set**, with a preview of each transition and the
  stem quality score (the curator work in #322 finds its real use here).
- **Quote, then buy with one signature**: a priced cart with the rights
  obtained per line, then a batched purchase through the existing smart
  account; receipts and license proofs kept.
- **Export** to rekordbox and Serato for tracks whose license allows it.
- **Bounded watching** (opt-in): alerts, and optional auto-buy under a cap with
  the existing session keys.
- Later, the same capability as an MCP tool `crate.build` returning a quote
  (line 5).

### 4.3 Scene Scout (artists)

- **Qualified demand**: repeat full plays, saves and purchases by city, in
  aggregates with minimum-audience thresholds, never listener identities.
- **A next action** in the cockpit (#1121): open a Shows campaign in that city,
  create a holder benefit, adjust the price of a stem DJs keep asking for,
  launch a remix challenge.
- **First listeners**: each new verified-artist release gets a slot in the
  exploration share for listeners whose taste fits, then a reception summary.
- **What pros ask for**: stems DJs searched for and did not find.

### 4.4 For the operator

- Each face strengthens a revenue line already decided; no new line.
- Unbilled Lyria generations in the DJ disappear.
- No surprise purchases, so no agent-related disputes or refunds.
- A simple public story: "your taste pays your artists, and nobody can buy
  their place in your recommendations."

## 5. Recommendation and taste framework

Specified in [RFC: Taste Engine](../rfc/taste-engine.md). In short: five taste
layers whose weight grows with commitment (commitment > declared > behavioral >
context > scene), a ranking objective of **resonance** rather than listening
time, six public recommendation rules (ADR-TE-2), and a listener-owned taste
passport (ADR-TE-5).

## 6. Economics and compliance

No new revenue line and no new price.

| Face | ADR-BM-6 line and phase | Money flow | ADR-BM-4 |
| --- | --- | --- | --- |
| Crate Digger | 3, take-rate 10%, phase 2; advanced features in Artist Pro (line 2) | DJ → artist for a license; 10% platform | Voluntary, quoted; artist ≥ 85% |
| Scene Scout | 2, Artist Pro, phase 2 | Artist subscription; conversions into Shows (6%) and marketplace (10%) | No flow to listeners; thresholded aggregates |
| Session DJ | 4, Listener Pro, phase 4 (Q1 2027 gate); limited free version earlier for acquisition | Pre-funded listener budget → artists played; 15% on micro-spend | Pre-funded, user-centric, no pool, no subsidy |
| Taste framework | Vision-neutral infrastructure | None | Popularity is never a payout input |
| MCP `crate.build` | 5, B2B and agents, last | External agent → artist via x402 | Same quote, same receipt |

Deliberately removed: filler AI tracks (ADR-BM-5), free Lyria transitions
(ADR-BM-3), and any paid tastemaker status (ADR-BM-4.3).

Artist Pro and Listener Pro billing do not exist yet; pro features ship behind
entitlement seams, free for now, following the Remix Studio Pro mode pattern
(#1903).

## 7. Reuse of what exists

| Existing | New role |
| --- | --- |
| `DiscoveryRankingService`, `AgentSignal`, taste memory controls | Foundation of the taste framework for all three faces |
| Stem audio feature extractor (#1184), `remix-fx` / `remix-structure` DSP | Full-mix measurement; Session DJ mixing; Crate Digger filters |
| Negotiator, ERC-4337 purchase, session keys, USDC caps | Crate Digger quoted cart, bounded watching, pay-per-play |
| Stem quality ratings (#322) | Quality filter in crates |
| Cohorts, popularity (#1451), quality dashboard (#982) | Scene Scout demand data |
| Playback intents (#1007), MCP server, x402 | External agents |
| Lyria transitions, AI filler tracks, ERC-8004 reputation publishing | Frozen (ADR-TE-6) |

## 8. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| Few listeners: Scene Scout and collaborative filtering stay weak | Start with the Crate Digger (catalog + audio features only); Scene Scout says "not enough listening yet" |
| Catalog too small for a precise crate | Honest "3 of 8 found", and the gap feeds Scene Scout as demand |
| Audio feature errors | Use stored confidences, let DJs correct, key-match only above a threshold |
| Live mixing heavy on mobile | Pre-render transitions server-side with the same deterministic DSP |
| Demand data fine enough to identify someone | `DISCOVERY_MIN_AUDIENCE` thresholds, aggregates only |
| SoundCloud at zero commission | Compete on stems, licenses and the discovery that leads to them, not download price |

Open questions for the owner:

- Does "AI DJ" stay the brand for the listener face?
- Should rekordbox/Serato export be free to attract DJs, or Artist Pro only?
- "Professional audio streaming platform" is read here as *a platform built
  for music professionals*, consistent with the positioning. A shift toward
  competing on consumer streaming would reopen ADR-BM-6.
