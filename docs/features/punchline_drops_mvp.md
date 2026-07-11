---
title: "Phase 1: Punchline Drops MVP"
status: in-progress
owner: "@akoita"
depends_on:
  - artist_upload_flow_mvp
  - licensing_pricing_model
  - rights-verification-strategy
---

# Phase 1: Punchline Drops MVP

> **Status:** `in-progress`. The backend (Sprint 7, #479–#482, #485) and the
> artist UI (#483–#484) are shipped — an artist can build + publish a drop and
> fans can discover, play, and collect free moments right on release pages (#486) and browse everything they own in the Library's Moments tab (#487). Paid collects (#1462) and analytics (#489) are still
> pending. The [Implementation Status](#implementation-status-sprint-7) section
> below is the practical, current-state reference for what works today and how
> to exercise it. The rest of this page is the product design/RFC intent that
> the slices implement toward.

## Implementation Status (Sprint 7)

**Naming (operator decision 2026-07-11):** the umbrella product is **"Drops"**;
**"Punchline"** is the first drop *kind*, shown as a per-drop chip in the UI.
Surfaces (home shelf #1479, collect module, builder, hero buttons) use the
umbrella name so new kinds (#1476: Crescendo, Hook, Solo…) need no renaming;
internal code keeps the `Punchline*` names (no churn). The brand name itself
may be revisited later.

Drops let an artist turn a track's golden moments into scarce, non-commercial
fan collectibles — starting with the Punchline kind (vocal-stem punchlines).
This section tracks what is actually built.

### Slice status

| Slice | Issue | Status | What it shipped |
| --- | --- | --- | --- |
| Persistence models | [#479](https://github.com/akoita/resonate/issues/479) | ✅ done | `PunchlineDrop` / `PunchlineMoment` / `PunchlineCollectible` / `PunchlineUnlock` Prisma models. |
| Eligibility + rights gate | [#480](https://github.com/akoita/resonate/issues/480) | ✅ done | `checkEligibility(trackId)` — explainable allow/deny on ownership, published release, vocals stem, content safety, and rights route. |
| Clip extraction | [#481](https://github.com/akoita/resonate/issues/481) | ✅ done | Server-side ffmpeg trim + re-encode of a `[startMs,endMs)` range from the `vocals` stem into a stored MP3. |
| Draft + publish APIs | [#482](https://github.com/akoita/resonate/issues/482) | ✅ done | Owner-scoped draft lifecycle, moment validation, and publish (re-gate → extract clips → persist → event). This slice. |
| Vocal clip selection + preview UI | [#483](https://github.com/akoita/resonate/issues/483) | ✅ done | Owner-only release-page panel: pick a vocals-stem track, see explainable eligibility, drag a `[startMs,endMs]` clip range, and preview exactly that range in-browser. Eligibility now also returns the server's `clipBoundsMs` so the client never hardcodes them. |
| Artist drop builder | [#484](https://github.com/akoita/resonate/issues/484) | ✅ done | Full drop builder on the release page: create/resume a draft, moment editor (clip range + title/lyric/artwork/edition/price) with a live collectible-card preview, publish behind a review dialog with the verbatim non-commercial rights warning. Owner draft resume via `GET /punchline/me/track-drops`. |
| Purchase + ownership grant | [#485](https://github.com/akoita/resonate/issues/485) | ✅ done (free_claim rail) | Race-safe collect endpoint: DB-enforced edition scarcity + one-per-fan cap, `owned` grant with payment provenance, sold-out handling, set-completion unlock hook + events, queryable inventory API. Paid collects return `payment_rail_pending` until the x402 rail generalizes beyond stems ([#1462](https://github.com/akoita/resonate/issues/1462)). |
| Track-page "collect moments" module | [#486](https://github.com/akoita/resonate/issues/486) | ✅ done | Fan-facing "Collect moments" section on the release page: lyric-first collectible cards with clip playback, live "N of M left"/sold-out scarcity, per-set progress, and the Collect CTA (free moments collect end-to-end; paid show an honest "Coming soon" until [#1462](https://github.com/akoita/resonate/issues/1462); signed-out visitors get a working sign-in CTA). |
| Collector inventory view | [#487](https://github.com/akoita/resonate/issues/487) | ✅ done | "🎤 Moments" tab in the Library: owned moments grouped by drop with set progress ("you own N of M" / "Set complete"), edition number, acquisition date, clip playback, and a link back to the release. Deep-linkable via `/library?tab=moments`. |
| Complete-set unlock rewards | [#488](https://github.com/akoita/resonate/issues/488) | ✅ done | Artist attaches an optional set bonus (bonus vocal clip + note, extracted at publish with the #481 primitive); completing the set grants it **exactly once** (DB-unique `PunchlineUnlockGrant`), emits `punchline.unlock_granted`, and reveals it in the collect module + Moments tab. Reward content is gated: public payloads carry existence only. |
| Analytics events + artist metrics | [#489](https://github.com/akoita/resonate/issues/489) | ✅ done | Full funnel instrumentation: the 4 domain events registered + bridged into the analytics fact store, 4 client funnel events (`drop_viewed` → `preview_played` → `collect_started` → `collect_completed`) through the product-analytics rail, and an owner metrics endpoint + builder strip (views/previews/collected/conversion/sets completed, per drop and per moment). |

Epic: [#490](https://github.com/akoita/resonate/issues/490). Sprint plan:
[Vision Sprint 7 — Punchline Drops](../sprints/2026-07-10-vision-sprint-7-punchline-drops.md).

### Rights posture

Every drop and moment is minted under a single, deliberately restrictive rights
class: `NON_COMMERCIAL_COLLECTIBLE`. The UI-safe summary rendered verbatim on a
collectible card is:

> Personal collectible for playback and profile display only — no commercial
> use, no remix or sampling rights, and no transfer of copyright or master
> ownership.

Only verified/trusted catalogs are eligible (the gate defers to the shared
upload-rights routing engine). A collectible is **utility, not yield** — it
grants access and display, never income or a revenue share (ADR-BM-4).
Ownership is an off-chain DB grant by design in Phase 1; the staged path to
optional on-chain claims (ERC-1155 editions) and its hard triggers are recorded
in [#1467](https://github.com/akoita/resonate/issues/1467). The
artist keeps 85%+ of every transaction; the marketplace 10% take-rate is reused
from the existing rails and is wired with the paid rail
([#1462](https://github.com/akoita/resonate/issues/1462)) — the shipped #485
slice grants free moments only, so no fee applies yet.

### Backend API surface (implemented)

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/punchline/eligibility?trackId=` | JWT | Explainable allow/deny for creating a drop on a track (#480). Response also carries `clipBoundsMs: { minMs, maxMs }` — the server-resolved, env-tunable clip-length bounds the selection UI reads so it never hardcodes them (#483). |
| `POST` | `/punchline/drops` | JWT (owner) | Create a draft drop on an owned, eligible track. |
| `PATCH` | `/punchline/drops/:dropId` | JWT (owner) | Update a draft drop's title/description. |
| `POST` | `/punchline/drops/:dropId/moments` | JWT (owner) | Add a collectible moment to a draft. |
| `PATCH` | `/punchline/drops/:dropId/moments/:momentId` | JWT (owner) | Edit a moment on a draft. |
| `DELETE` | `/punchline/drops/:dropId/moments/:momentId` | JWT (owner) | Remove a moment from a draft. |
| `POST` | `/punchline/drops/:dropId/publish` | JWT (owner) | Re-run the gate, extract each clip, persist, emit the event. |
| `GET` | `/punchline/me/track-drops?trackId=` | JWT (owner) | The caller's drops on a track, any status, newest first — powers the builder's draft resume + published summaries (#484). |
| `POST` | `/punchline/moments/:momentId/collect` | JWT | Collect one edition of a published moment (#485). Free moments grant immediately (`free_claim`); paid moments return `payment_rail_pending` ([#1462](https://github.com/akoita/resonate/issues/1462)). Codes: `moment_not_found`, `drop_not_published`, `sold_out`, `already_collected`, `payment_rail_pending`, `collect_failed`. |
| `GET` | `/punchline/me/collectibles` | JWT | The caller's owned collectibles with moment/drop/track context — the inventory read (#485/#487). |
| `PUT` | `/punchline/drops/:dropId/unlock` | JWT (owner, draft) | Create/replace the drop's single `complete_set` bonus: clip range (same bounds as moments) + optional note ≤500 chars (#488). |
| `DELETE` | `/punchline/drops/:dropId/unlock` | JWT (owner, draft) | Remove the set bonus. |
| `GET` | `/punchline/me/unlocks` | JWT | The caller's granted set rewards, revealed, with drop/track context (#488). |
| `GET` | `/punchline/me/drops/:dropId/metrics` | JWT (owner) | Funnel metrics for one drop (#489): views → previews → collect starts (analytics facts) joined with collected editions + set completions (DB truth), per drop and per moment; server-computed conversion. |
| `GET` | `/punchline/drops/:dropId` | Optional JWT | Drop detail; published drops are public, drafts only for the owner. |
| `GET` | `/punchline/tracks/:trackId/drops` | Public | Published drops for a track (`{ items, meta:{count,limit} }`). |

Ownership/eligibility rules enforced server-side: only the track's artist can
create; only draft drops can be mutated; create **and** publish both run the
#480 gate; moment ranges are validated against the same clip-length bounds the
extractor enforces (so publish can't fail on a range the draft accepted); at
most 20 moments per drop.

### Artist UI (so far)

The first artist-facing surface ships on the release page (#483). When the
signed-in owner views their own release, a **Punchline Drops** panel appears for
any track that has a processed `vocals` stem:

- pick a track (auto-selected when only one qualifies), which runs the #480
  eligibility check and renders it explainably — the rights summary plus the
  clip selector when eligible, or the human-readable `reasons[]` list when not;
- select a `[startMs, endMs]` range on a draggable timeline over the vocals
  stem (pointer + touch + keyboard-accessible `role="slider"` handles), with
  live, human-phrased validation that mirrors the backend clip-length bounds so
  any accepted range is publishable;
- preview **exactly** that range in the browser — one `HTMLAudioElement` seeked
  to the selection, using the existing unauthenticated stem-preview endpoint
  (`GET /catalog/stems/:stemId/preview`, which decrypts server-side and supports
  Range seeking); no new backend preview endpoint was added.

The **drop builder** (#484) completes the flow in the same panel. From the
eligibility overview the artist creates a drop (or resumes the newest draft —
drafts survive reloads via the owner-scoped `GET /punchline/me/track-drops`):

- drop title/description with an explicit Save;
- a **moment editor** composing the #483 clip selector per moment plus title
  and lyric (live character counters), optional artwork URL (http(s)/ipfs, live
  thumbnail), edition size ("Limited edition" is the only MVP edition model),
  and a price entered in dollars and stored as integer cents (`0` renders
  "Free to claim"; no suggested price — canonical pricing is a pending operator
  decision);
- a live **collectible-card preview** rendered from the editor fields (artwork,
  lyric, duration badge, edition, price, rights chip) — what fans will see;
- a moment list with edit/remove (ConfirmDialog-confirmed) while the drop is a
  draft;
- **Publish** behind a review dialog (a purpose-built modal following
  ConfirmDialog styling): moment count, total editions, per-moment one-liners,
  the **verbatim `NON_COMMERCIAL_COLLECTIBLE` rights warning**, an honest note
  that set-unlock rewards arrive later (#488), and an "Extracting clips…"
  loading state. Failures (re-gate `track_not_eligible` reasons, per-moment
  clip-extraction errors) surface inline and the drop stays an editable draft.

All builder validation mirrors the backend limits exactly (shared helpers in
`punchlineDropHelpers.ts`), so anything the UI accepts is publishable.

### Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `PUNCHLINE_CLIP_MIN_MS` | `2000` | Minimum moment/clip length. |
| `PUNCHLINE_CLIP_MAX_MS` | `15000` | Maximum moment/clip length (keeps a collectible a punchline, not a song). |

### Events

- `punchline.drop_published` (v1) — emitted on publish with
  `{ dropId, trackId, artistId, momentCount, totalEditions }` (identifiers +
  aggregate counts only; no lyrics, artwork, clip bytes, or pricing). The full
  product-analytics taxonomy is #489.
- `punchline.moment_collected` (v1) — emitted on every successful collect with
  identifiers, the edition number, and payment provenance
  (`pricePaidCents`, `paymentRail`).
- `punchline.set_completed` (v1) — emitted when a collector now owns every
  moment in a drop.
- `punchline.unlock_granted` (v1) — the complete-set reward was granted (#488),
  exactly once per collector per unlock (DB-enforced); identifiers only, never
  the reward content.
- All four domain events are registered in the analytics taxonomy and bridged
  into the fact store (#489). Client funnel events `punchline.drop_viewed`,
  `punchline.preview_played`, `punchline.collect_started`, and
  `punchline.collect_completed` flow through the product-analytics rail
  (allowlisted + declared; pseudonymous tier); the `punchline` event family is
  registered in the warehouse export matrix.

### Services, code, and tests

- Services: `backend/src/modules/punchline/punchline-eligibility.service.ts`,
  `punchline-clip.service.ts`, `punchline-drop.service.ts`,
  `punchline-collect.service.ts` (#485: race-safe edition allocation, free_claim
  rail, set-completion hook).
- Controller: `backend/src/modules/punchline/punchline.controller.ts`.
- Event: `backend/src/events/event_types.ts` (`PunchlineDropPublishedEvent`).
- Artist UI (#483 + #484): `web/src/components/punchline/` —
  `PunchlineDropsPanel.tsx` (release-page owner panel + view state machine),
  `PunchlineDropBuilder.tsx` (draft builder), `PunchlineMomentEditor.tsx`,
  `PunchlineCollectibleCard.tsx` (live preview + published card),
  `PunchlinePublishReviewDialog.tsx` (publish review + rights warning),
  `PunchlineClipSelector.tsx` (reusable clip selector + preview),
  `punchlineDropHelpers.ts` (pure validation/price/view helpers),
  `PunchlineCollectModule.tsx` + `punchlineCollectHelpers.ts` (#486 fan module),
  `PunchlineInventory.tsx` (#487 Library Moments tab),
  `web/src/styles/punchline.css`; punchline API client in `web/src/lib/api.ts`;
  wired into `web/src/app/release/[id]/page.tsx`. User Guide article
  `punchline-drops` in `web/src/lib/help/content.ts`.
- Tests: `backend/src/tests/punchline-eligibility.integration.spec.ts`,
  `punchline-clip.integration.spec.ts`, `punchline-drops.integration.spec.ts`,
  `punchline-collect.integration.spec.ts` (#485: incl. a concurrent-collect race
  proving editions can never oversell);
  frontend `web/src/components/punchline/PunchlineClipSelector.test.tsx`,
  `PunchlineDropsPanel.test.tsx`, and `punchlineDropHelpers.test.tsx`.
  Run backend: `npm run test:integration -- --testPathPattern='punchline'`
  (the publish/clip render cases require ffmpeg on PATH; CI installs it for the
  backend-integration job). Run frontend: `npx vitest run src/components/punchline`.

### Business-model note

Revenue line (3) marketplace take-rate. Phase per ADR-BM-6: MVP/experiment.
Canonical fee/split numbers live in `docs/rfc/business-model.md`; the 10%
primary-sale take-rate is reused from existing marketplace rails and is wired at
purchase in #485. Concrete collectible pricing is left to operator input and is
reconciled there rather than hardcoded in code.

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
