---
title: "Phase 1: Punchline Drops Execution Plan"
status: draft
owner: "@akoita"
depends_on:
  - punchline_drops_mvp
  - artist_upload_flow_mvp
  - catalog_indexing_mvp
  - analytics_dashboard_v0
---

# Phase 1: Punchline Drops Execution Plan

## Goal

Translate the Punchline Drops MVP into issue-ready engineering work across backend, web, data, and go-to-market surfaces.

This plan assumes the product spec in [punchline_drops_mvp.md](./punchline_drops_mvp.md) is the source of truth.

## Delivery Strategy

Ship this feature in five sequential workstreams:

1. data model and rights gating,
2. clip generation and draft APIs,
3. artist creation UI,
4. collector purchase and inventory UI,
5. unlocks, analytics, and launch polish.

The recommended principle is:

> **Keep v1 backend-first and rights-safe. Do not block launch on a new collectible contract unless portability is required immediately.**

## Workstream 1: Data Model & Rights Gating

### Objective

Create the minimum persistent model for punchline drops while ensuring only eligible tracks can publish them.

### Tasks

1. Add Prisma models for:
   - `PunchlineDrop`
   - `PunchlineMoment`
   - `PunchlineCollectible`
   - `PunchlineUnlock`
2. Add track eligibility service:
   - requires published track,
   - requires available `vocals` stem,
   - blocks disputed or quarantined tracks,
   - blocks unverified or low-trust catalogs where required.
3. Add shared rights label for collectible moments:
   - `NON_COMMERCIAL_COLLECTIBLE`
   - UI-safe summary for frontend rendering.
4. Define status transitions:
   - drop: `draft` → `published` → `archived`
   - collectible inventory grant: `pending` → `owned` → `revoked` if needed later.

### Acceptance Criteria

- Backend can persist draft drops and moments.
- Eligibility checks prevent creation for ineligible tracks.
- Rights summary is available via API for all published moments.

### Suggested Issue Titles

- `feat: add punchline drop prisma models`
- `feat: enforce punchline drop track eligibility and rights gating`

## Workstream 2: Clip Generation & Draft APIs

### Objective

Allow artists to extract short collectible clips from the vocal stem and manage draft drop state through stable APIs.

### Tasks

1. Implement clip extraction service:
   - input: `trackId`, `startMs`, `endMs`,
   - source: `vocals` stem URI,
   - output: clipped MP3 asset in configured storage.
2. Add validation rules:
   - max clip length 15 seconds,
   - min clip length 3 seconds,
   - only one source stem type in v1: `vocals`,
   - clip range must stay within asset duration.
3. Add APIs:
   - create drop,
   - add moment,
   - update metadata,
   - publish drop,
   - get drop detail,
   - list track drops.
4. Ensure publish flow validates:
   - title present,
   - lyric text present,
   - price and edition valid,
   - rights gate passes at publish time.

### Acceptance Criteria

- Artist can create a draft drop and at least one clipped moment.
- Clip extraction stores a stable preview/playback asset.
- Publish fails with clear validation errors when required fields are missing.

### Suggested Issue Titles

- `feat: add punchline clip extraction service for vocal stems`
- `feat: add punchline drop draft and publish APIs`

## Workstream 3: Artist Creation UI

### Objective

Enable artists to create, preview, and publish Punchline Drops from the track page.

### Tasks

1. Add `Create Punchline Drop` entry point to the artist-owned track page.
2. Build clip editor UI:
   - load vocal waveform,
   - mark start/end range,
   - preview clip audio.
3. Build drop builder form:
   - title,
   - lyric text,
   - artist note,
   - artwork,
   - edition type,
   - max supply,
   - price,
   - optional unlock.
4. Add publish review step:
   - non-commercial rights warning,
   - summary card preview,
   - validation error handling.

### Acceptance Criteria

- Artist can create a full draft without leaving the track workflow.
- Artist can preview the collectible card before publish.
- Publish state and validation errors are understandable without inspecting logs.

### Suggested Issue Titles

- `feat(web): add artist punchline drop builder to release page`
- `feat(web): add vocal clip selection and preview for punchline moments`

## Workstream 4: Collector Purchase & Inventory UI

### Objective

Make published moments discoverable, collectible, and visible on collector profiles.

### Tasks

1. Add `Collect Moments` module on track pages.
2. Build collectible card UI:
   - rarity,
   - lyric-first layout,
   - artist note,
   - edition remaining,
   - preview CTA,
   - collect CTA.
3. Implement collect flow:
   - wallet or existing purchase rail,
   - ownership grant,
   - optimistic UI refresh where safe.
4. Add inventory surface:
   - collector profile,
   - wallet-linked inventory section,
   - set progress display.

### Acceptance Criteria

- Fans can preview and collect a published moment from the track page.
- Collected moments appear in an inventory view.
- Sold-out state and edition counts render correctly.

### Suggested Issue Titles

- `feat(web): add track page collect moments section`
- `feat: implement punchline collectible purchase and ownership grant`
- `feat(web): add punchline inventory to collector profile`

## Workstream 5: Unlocks, Analytics & Launch Polish

### Objective

Add enough progression and measurement to learn whether the feature has product-market pull.

### Tasks

1. Implement one unlock type:
   - `complete_set`
2. Support one reward grant path initially:
   - bonus audio asset,
   - or presale access token/flag.
3. Track analytics events:
   - drop viewed,
   - moment preview played,
   - collect started,
   - collect completed,
   - set completed.
4. Add artist analytics page or dashboard card:
   - views,
   - previews,
   - conversion,
   - total sales,
   - top moments.
5. Add social sharing support:
   - metadata for lyric-card previews,
   - public-friendly drop page or track deep link.

### Acceptance Criteria

- Set completion grants the configured reward.
- Artist can see per-moment conversion performance.
- Product team can measure funnel performance from view to collect.

### Suggested Issue Titles

- `feat: add punchline set unlock rewards`
- `feat: track punchline drop analytics events and dashboard metrics`
- `feat(web): add shareable punchline drop metadata and landing states`

## Contract Strategy

### Recommendation

Do not make a new collectible contract a blocker for Phase 1.

Phase 1 should use backend ownership records unless one of these becomes mandatory:

- wallet-portable ownership from day one,
- secondary trading in v1,
- composable on-chain badge logic in v1.

### Optional Contract Follow-Up

If portability becomes a requirement, add a Phase 2 contract workstream:

1. mint one ERC-1155 class per `PunchlineMoment`,
2. attach collectible metadata URI,
3. map purchase flow to mint,
4. keep non-commercial rights language embedded in metadata.

Suggested follow-up issue title:

- `feat(contracts): add ERC-1155 punchline collectible primitive`

## Testing Plan

### Backend

- unit tests for eligibility and validation rules,
- integration tests for draft creation, moment creation, and publish,
- integration tests for blocked publish on quarantined/disputed tracks,
- integration tests for collect flow and set unlock completion.

### Frontend

- component tests for collectible cards and draft builder validation,
- flow tests for artist publish journey,
- flow tests for collector purchase and inventory rendering.

### Manual QA

1. Upload track and wait for stem separation.
2. Create a punchline drop from the `vocals` stem.
3. Publish drop with a limited edition moment.
4. Collect the moment from another wallet/session.
5. Verify inventory and unlock behavior.

## Suggested Issue Order

Recommended issue creation / sprint order:

1. `feat: add punchline drop prisma models`
2. `feat: enforce punchline drop track eligibility and rights gating`
3. `feat: add punchline clip extraction service for vocal stems`
4. `feat: add punchline drop draft and publish APIs`
5. `feat(web): add vocal clip selection and preview for punchline moments`
6. `feat(web): add artist punchline drop builder to release page`
7. `feat: implement punchline collectible purchase and ownership grant`
8. `feat(web): add track page collect moments section`
9. `feat(web): add punchline inventory to collector profile`
10. `feat: add punchline set unlock rewards`
11. `feat: track punchline drop analytics events and dashboard metrics`

## Dependencies & Risks

### Dependencies

- existing stem separation pipeline must reliably produce `vocals`,
- release pages must expose artist ownership state,
- rights verification signals must be queryable at publish time,
- storage service must support derived clip asset writes.

### Primary Risks

- waveform editing UX may take longer than expected,
- legal copy may be too vague unless rights language is standardized,
- clip generation latency may feel poor without background processing,
- collector value may underperform if artist notes and perks are optional.

## Fastest Viable Delivery Slice

If the team needs a smaller first release, ship this reduced slice:

1. backend ownership model only,
2. one moment per track,
3. fixed limited-edition pricing only,
4. no unlocks,
5. no public inventory page,
6. analytics events only, no dashboard.

That version still tests the core hypothesis:

> **Will fans collect artist-approved vocal moments when the presentation, scarcity, and story are strong enough?**
