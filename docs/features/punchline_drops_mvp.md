---
title: "Phase 1: Punchline Drops MVP"
status: draft
owner: "@akoita"
depends_on:
  - artist_upload_flow_mvp
  - licensing_pricing_model
  - rights-verification-strategy
---

# Phase 1: Punchline Drops MVP

## Goal

Ship an MVP that lets artists create scarce, artist-approved collectible moments from a track's vocal stem, then sell those moments to fans with clear non-commercial rights and optional holder perks.

The core product thesis is:

> **A punchline is not just a stem excerpt. It is a collectible cultural moment.**

This feature should strengthen Resonate's existing position as a stem-native platform rather than create a separate product category.

> [!NOTE]
> Rights handling for punchline clips must follow [Rights Verification & Copyright Enforcement Strategy](../rfc/rights-verification-strategy.md). The MVP should initially support artist-uploaded or otherwise verified catalogs only. Famous legacy catalogs, estates, or label-controlled works should be out of scope unless the rightsholder is verified.

## Why This Fits Resonate

Resonate already has the right primitives:

- full-track discovery,
- generated stems from Demucs,
- artist-owned catalog pages,
- licensing and collectible infrastructure,
- marketplace and payment rails.

Punchline Drops add a fan-facing monetization layer on top of the existing stem pipeline:

```text
Track upload → stem separation → vocal stem excerpts → collectible moments → fan ownership → unlocks / upgrades
```

For rap, spoken word, and bar-heavy genres, this creates a product fans already understand emotionally:

- owning a legendary line,
- collecting a full verse set,
- unlocking rare content from an artist they support,
- signaling taste and early fandom.

## Product Definition

### Working Name

`Punchline Drops`

Alternative names for testing:

- `Collectible Moments`
- `Bar Drops`
- `Legendary Lines`

### What Is Being Sold

A Punchline Drop is a short clip, usually 5-15 seconds, extracted from an artist-approved vocal stem and packaged with metadata that makes it collectible.

Each collectible moment should include:

- short audio clip sourced from the vocal stem,
- title or moment name,
- lyric text or subtitle,
- artwork or lyric-card visual,
- artist note explaining the significance of the line,
- edition and pricing metadata,
- optional holder benefits.

### What The Buyer Gets

Default MVP rights:

- personal collection and playback,
- profile display and social showcasing,
- access to holder rewards and gated experiences,
- no commercial rights,
- no remix rights,
- no copyright ownership transfer.

This should be framed as a collectible membership-style asset, not as a default commercial license.

## MVP Scope

### In Scope

1. Artists can create collectible moments from the vocal stem of an uploaded track.
2. Artists can publish moments with a title, lyric text, artwork, edition size, and price.
3. Fans can preview, collect, and display owned moments.
4. Artists can attach simple perks to ownership.
5. Collectors can complete sets to unlock a bonus reward.

### Out Of Scope

- automatic AI detection of "best punchlines",
- catalog ingestion from unverified third-party legacy catalogs,
- commercial licensing add-ons,
- auctions,
- advanced secondary market mechanics,
- derivative-rights negotiation,
- AI-generated imitations of famous artists,
- support for non-vocal moment extraction in v1.

## User Stories

### Artist

- As an artist, I want to select iconic vocal moments from my own track so I can monetize fan excitement around specific bars.
- As an artist, I want to add context and perks to each moment so fans feel they are collecting meaning, not just buying audio.
- As an artist, I want to see which moments convert best so I can plan future drops.

### Collector

- As a fan, I want to collect the most memorable line from a song I love so I can show support and signal fandom.
- As a fan, I want rarity and unlocks to make the collectible feel valuable.
- As a fan, I want to complete a set of moments to unlock something larger.

### Platform

- As Resonate, we want a fan product that monetizes stems without forcing every purchase into a creator-license workflow.
- As Resonate, we want to increase revenue per track and deepen artist-fan retention.

## Artist Flow

1. Artist uploads a track and waits for stem separation to complete.
2. Artist opens a new `Create Punchline Drop` flow from the track page.
3. System loads the `vocals` stem waveform.
4. Artist selects one or more clip ranges.
5. Artist enters:
   - title,
   - lyric text,
   - artist note,
   - artwork,
   - edition size,
   - price,
   - optional unlock rule.
6. Artist previews the collectible card.
7. Artist publishes the drop.

## Collector Flow

1. Fan lands on a track page.
2. Fan sees a `Collect Moments` section beneath playback and stem preview.
3. Fan previews a collectible clip and reads the lyric-card/story.
4. Fan purchases or mints the collectible.
5. Owned moments appear on the collector profile.
6. If the collector completes a set, the unlock reward is granted.

## Value Design

The collectible becomes valuable when all four of these are present:

| Value Layer | MVP Expression |
| --- | --- |
| Scarcity | Limited edition count or open edition with time cap |
| Status | Profile badge, ownership display, visible owner count |
| Story | Artist annotation explaining why the line matters |
| Utility | Holder-only perk or set completion unlock |

Without at least one of `story` or `utility`, the moment risks feeling like a clipped file instead of a premium fan object.

## Suggested Drop Types

| Type | Description | Example |
| --- | --- | --- |
| Common | Open or high-supply edition | Hook line, ad-lib, fan-favorite quote |
| Rare | Limited edition | Best line in verse 2, live-show staple lyric |
| Legendary | Very low supply / 1 of 1 | Signature bar tied to artist identity |
| Set Unlock | Reward for owning all moments in a release | Full vocal stem, alt take, unreleased freestyle |

## Pricing Strategy

Initial pricing should be simple and artist-guided.

Suggested ranges:

- common: 5-15 EUR equivalent,
- rare: 25-100 EUR equivalent,
- legendary: 250+ EUR equivalent or reserve-based,
- set unlock: not sold directly; earned through collection.

Revenue policy for MVP:

- primary sale fee: 10% platform fee,
- optional secondary fee later: 2.5-5%.

## Rights & Legal Guardrails

### Default Rights Posture

Punchline Drops should map to a new fan-collectible rights class that is more restrictive than Remix or Commercial usage.

Recommended MVP terms:

- non-exclusive,
- non-transferable or platform-transferable only,
- personal use only,
- no download right unless explicitly enabled,
- no public performance right,
- no remix or sampling right,
- no sublicensing,
- no implied ownership of copyright or master rights.

### Catalog Restrictions

MVP should only allow Punchline Drops when one of the following is true:

- uploader is the verified artist or rights holder,
- uploader is a trusted source account,
- uploader passed the platform's higher-confidence review path.

The MVP should explicitly block or defer:

- impersonation-prone catalogs,
- major legacy artists without rightsholder verification,
- exact-match quarantined uploads,
- unresolved disputes.

## Acceptance Criteria

- Artists can create a collectible moment from the `vocals` stem only.
- Artists can publish at least one moment per track with edition size and price.
- Fans can preview and collect published moments from the track page.
- Owned moments render on a collector profile page or wallet inventory view.
- Artists can configure one simple unlock rule: `collect all moments from this drop`.
- The system clearly labels the collectible as non-commercial.
- Quarantined, disputed, or unverified tracks cannot create Punchline Drops.

## Data Model

Suggested backend entities for MVP:

### `PunchlineDrop`

- `id`
- `trackId`
- `artistId`
- `title`
- `description`
- `status` (`draft`, `published`, `archived`)
- `coverImageUri`
- `unlockType` (`none`, `complete_set`)
- `unlockPayload`
- `createdAt`
- `publishedAt`

### `PunchlineMoment`

- `id`
- `dropId`
- `trackId`
- `stemType` (`vocals`)
- `startMs`
- `endMs`
- `title`
- `lyricText`
- `artistNote`
- `audioClipUri`
- `waveformPreviewUri` optional
- `editionType` (`open`, `limited`, `legendary`)
- `maxSupply`
- `priceAmount`
- `priceCurrency`
- `sortOrder`

### `PunchlineCollectible`

- `id`
- `momentId`
- `tokenId` optional for on-chain representation
- `ownerAddress`
- `acquiredAt`
- `transactionRef`
- `benefitsGranted`

### `PunchlineUnlock`

- `id`
- `dropId`
- `unlockType`
- `rewardType` (`audio`, `presale`, `discord_role`, `merch_access`)
- `rewardPayload`

## API Surface

Suggested REST endpoints:

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/punchline-drops` | Create draft drop |
| POST | `/api/punchline-drops/:id/moments` | Add moment to draft |
| PATCH | `/api/punchline-drops/:id` | Update drop metadata |
| POST | `/api/punchline-drops/:id/publish` | Publish drop |
| GET | `/api/punchline-drops/track/:trackId` | List published drops for a track |
| GET | `/api/punchline-drops/:id` | Get drop detail |
| POST | `/api/punchline-moments/:id/collect` | Purchase / mint collectible |
| GET | `/api/punchline-collectibles/me` | Collector inventory |
| GET | `/api/punchline-drops/:id/analytics` | Artist performance stats |

### Service Rules

- only track owners can create draft drops,
- only published tracks with an available `vocals` stem are eligible,
- rights-verification state must be checked before publish,
- the collect endpoint must evaluate unlock completion after purchase.

## Frontend Scope

### Artist UI

- track page button: `Create Punchline Drop`
- clip selection modal for the vocal stem waveform
- draft builder for title, lyric text, price, edition, note, and perk
- publish confirmation with rights warning

### Fan UI

- `Collect Moments` section on the track page
- collectible cards with lyric-first presentation
- detail modal or page for preview and purchase
- collector inventory section on profile
- set completion progress indicator

### Design Notes

The UI should feel closer to collectible culture than utility software:

- lyric-card visual treatment,
- clear rarity labels,
- artist story front and center,
- completion framing for sets,
- mobile-friendly browsing and sharing.

## Smart Contract Options

MVP can ship with a backend-first ownership record if that reduces delivery time, but the preferred path is to reuse existing collectible primitives where feasible.

Two implementation paths:

### Path A: Backend-first MVP

- store collectible ownership in the application database,
- process payments through existing marketplace/payment infrastructure where possible,
- defer fully portable tokenization until usage is validated.

### Path B: On-chain collectible MVP

- mint a dedicated ERC-1155 token per punchline moment edition,
- treat ownership as wallet-native from day one,
- use contract metadata to point to lyric-card and clip assets.

Recommendation:

Start with **Path A** if speed is the priority, then migrate to `ERC-1155` once demand is proven and legal/UX framing is stable.

## Storage & Media Pipeline

Clip generation should reuse the existing post-separation asset pipeline:

1. source track is uploaded,
2. Demucs generates the `vocals` stem,
3. publishable clip ranges are extracted from the vocal stem,
4. clip audio is stored in the configured storage provider,
5. artwork and metadata are linked to the collectible record.

Operational limits for MVP:

- max clip length: 15 seconds,
- only MP3 output in MVP,
- one source stem type: `vocals`,
- server-side clipping to ensure consistency and anti-tampering.

## Analytics

Artist analytics for MVP:

- track listeners → moment viewers,
- moment preview plays,
- conversion rate per moment,
- total primary sales,
- completion rate for set unlocks,
- top collectors by purchase count.

These metrics should be sufficient to answer whether the feature creates:

- higher revenue per track,
- better artist retention,
- stronger collector repeat behavior.

## Marketing Strategy

Initial launch market:

- independent rap artists,
- bar-centric hip-hop communities,
- artists with strong Discord/X/Telegram fan clusters,
- scenes where identity and quotables matter.

Launch message:

> **Own the line everybody rewinds.**

Recommended launch motions:

- release-day punchline drop paired with a new single,
- fan vote on which bar becomes collectible next,
- complete-the-verse campaigns,
- collector leaderboard for early supporters,
- holder-only unlock for next release presale.

## Risks

| Risk | Why It Matters | Mitigation |
| --- | --- | --- |
| Weak perceived value | Audio clip alone may feel trivial | Require story and/or perk metadata at publish time |
| Rights risk | Misuse on disputed or legacy catalogs | Restrict MVP to verified catalogs and approved sources |
| UX complexity | Too many options could overwhelm artists | Limit edition and unlock settings in v1 |
| Low liquidity | Fans may not care about resale early | Optimize for fandom and access, not speculation |
| Brand confusion | Users may mistake collectible for license | Use explicit non-commercial rights language everywhere |

## Open Questions

- Should collectors be allowed to download the clip, or only stream it in-app?
- Should the first MVP support fiat checkout, wallet checkout, or both?
- Should set completion unlock the full vocal stem, or is that too close to creator licensing?
- Should moments be shareable publicly as preview cards without exposing full collectible utility?
- Should artist notes be optional, or required to preserve quality?

## Recommendation

Build Punchline Drops as a **fan collectible layer on top of stem infrastructure**, not as a new licensing product.

The best MVP is:

- vocal moments only,
- artist-curated only,
- verified catalogs only,
- simple primary sales only,
- utility and story included by design.

That gives Resonate a differentiated collector feature without diluting the platform's deeper licensing strategy.
