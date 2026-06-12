---
title: "Remix Studio"
status: partial
owner: "@akoita"
---

# Remix Studio

## Status

`partial`

The backend P0 slices are implemented
([#892](https://github.com/akoita/resonate/issues/892),
[#893](https://github.com/akoita/resonate/issues/893)): an explainable remix
eligibility policy surface and durable, owner-scoped remix project records with
authenticated APIs. Remix CTAs are live on release tracks and stem detail
pages ([#894](https://github.com/akoita/resonate/issues/894)), and
`/remix/studio/[projectId]` is now an editable studio
([#895](https://github.com/akoita/resonate/issues/895)): source attribution
and rights badge, stem mute/solo/gain controls, remix mode selector, prompt
box, draft status panel, persisted saves, and honest unavailable
publish/export states. The `RemixGenerationProvider` boundary and
`POST /remix/projects/:id/generate` are wired
([#896](https://github.com/akoita/resonate/issues/896)). The first real
provider with a studio Generate button (backlog D2) and the audio preview
foundation (C3) are shipped: users can preview the source-stem arrangement and
  play generated draft output inside the owner-scoped studio. Artist remix
consent controls (backlog A1) are shipped: artists can globally disable remix
access while preserving existing private drafts. Queue-backed jobs (D3),
publish/export, and manual approval states remain planned; the MVP epic is
[#891](https://github.com/akoita/resonate/issues/891).

The legacy in-memory remix module remains only as the deprecated
`POST /remix/create` compatibility shim and is slated for removal with the
frontend slices.

Remix and contributor credential boundaries are documented in
[Remix And Contributor Credential Boundaries](../rfc/remix-contributor-credential-boundaries.md).
Contributor recognition should start as off-chain, publication-scoped
attribution proof tied to Remix Studio, catalog publication, license state, and
artist/rightsholder approval. A standalone community-only contributor token is
not part of the plan.

## Audience

- Listeners and fans who want to create remixes from eligible tracks.
- Producers who want licensed source stems and AI-assisted draft generation.
- Artists who want controlled fan-remix participation.
- Backend, frontend, protocol, and agent developers building remix, licensing,
  generation, and payment flows.

## Value

Remix Studio turns Resonate's "listening becomes licensing" thesis into a
creative workflow. Users can remix only when the source work, artist policy, and
license state allow it. Artists get consent, attribution, compensation, and
lineage instead of untracked off-platform derivative use.

The product is intentionally narrower than "AI covers of any song." The first
version should focus on rights-gated stem remixes and AI-assisted draft
generation. Voice/likeness covers are a later feature that require explicit
consent and legal review.

## Planned User Flow

1. Open an eligible release, track, or stem.
2. Select `Remix`.
3. Buy or prove a remix license if required.
4. Open Remix Studio.
5. Select stems, remix mode, and prompt constraints.
6. Generate or edit a draft.
7. Save the private draft.
8. Publish inside Resonate only if the license terms allow it.
9. Export only if the license explicitly grants export rights.

## Implemented Surfaces

All implemented routes are JWT-authenticated; creator identity always comes
from the JWT, never the request body.

- API: `GET /remix/eligibility?trackId=...&stemIds=a,b` — explainable
  allow/deny response with `allowed`, `requiredLicense`, `allowedActions`,
  structured `reasons` (`source_blocked`, `source_quarantined`,
  `source_removed`, `source_under_monitoring`, `source_rights_unknown`,
  `source_not_opted_in`, `artist_remix_disabled`, `stem_not_remixable`,
  `license_required`),
  `policyVersion`, per-stem remixability/license state. Designed for the three
  CTA states: enabled, license required, disabled with reason.
- API: `GET /artists/:id/settings` and `PATCH /artists/:id/settings` —
  owner-only artist settings reads/updates. The authenticated user's artist
  profile is resolved server-side; the client cannot select a different artist
  by body payload.
- API: `POST /remix/projects` — eligibility-gated durable project creation;
  policy denials return 403 with the full eligibility payload.
- API: `GET /remix/projects` — owner-scoped project list.
- API: `GET /remix/projects/:id` — owner-only read (403 non-owner, 404 missing).
- API: `PATCH /remix/projects/:id` — owner-only edits for title, prompt,
  `draft`/`archived` status, and per-stem role/gain/mute/arrangement controls.
- API (deprecated): `POST /remix/create` and `GET /remix/:remixId` — legacy
  in-memory experiment kept for compatibility until #894+.
- Data: `RemixProject` and `RemixProjectStem` Prisma models with creator,
  source track, stems, license context, prompt, mode, generation metadata,
  attribution, and export-policy placeholders.
- Events: `remix.project_created` (carries the source release's `artistId`
  for artist-cockpit attribution, #1121), `remix.policy_rejected`,
  `remix.license_required`, and `artist.remix_consent_updated` (governed
  analytics bridge mappings included; the artist-consent bridge payload
  explicitly includes `artistId`).
- Product analytics (#1143), allow-listed in `POST /analytics/product/event`
  and emitted from the web client with compact id/state payloads only (no
  titles, prompts, or free-text reasons):
  - `remix.cta_impression` — RemixCta resolves a visible state; payload
    `trackId`, `stemIds`, `state` (`remix` | `license_required` | `blocked` |
    `signed_out`), `variant`, and `licensePathAvailable` for
    license-required states. Deduplicated per source + state per mount.
  - `remix.cta_clicked` — same payload plus `outcome`
    (`studio_opened` | `license_purchase` | `marketplace` | `login`).
  - `remix.studio_opened` — studio editor mount; `projectId`,
    `sourceTrackId`, `stemCount`, `mode`.
  - `remix.studio_saved` — successful project PATCH; `projectId`, `mode`.
  - `remix.studio_action_unavailable` — click on a locked publish/export
    control; `projectId`, `action`, stable `reasonCode`
    (`publish_not_available` | `export_rights_required`).
  - Limitation: the product-analytics endpoint is authenticated, so
    `signed_out` CTA states are only recorded once the user has a session
    elsewhere in the app; fully anonymous impressions are not captured.
- Policy inputs: track/release rights route, track content status,
  `StemNftMint.remixable`, conservative source opt-in hook, and remix license
  proof from `StemPurchase` (`licenseType = remix`) or listing-backed
  `X402Settlement` rows matched to the caller's wallet.

- UI (#894): per-track Remix CTA on the release detail page
  (`web/src/components/remix/RemixCta.tsx`) and a Remix Studio card on
  `/stem/[tokenId]`. CTA states come exclusively from the eligibility API:
  enabled (opens the most recent matching draft or creates one), license
  required (routes to the marketplace remix tier), disabled with the policy
  reason rendered keyboard-accessible via `aria-disabled`, or a sign-in
  prompt for signed-out users. The license-required path is satisfiable
  in-app since #1141: sellers can list remix-tier licenses from the stem
  page and batch mint-and-list flows, and buying one flips the CTA to
  enabled.
- Eligibility policy v3 (#1145/#1169, `2026-06-11.v3`): track-default requests
  (the release-page CTA, no stem filter) are a **partial allowance** — one
  licensed stem enables the track, non-remixable mints are excluded rather
  than blocking, and the created draft contains only licensed remixable
  stems. Explicit stem selections (project creation, generation, stem-scoped
  CTAs) still require every selected stem to be licensed and remixable.
  Artist-level `disabled` remix consent is a global revocation override and
  denies all source selections with `artist_remix_disabled`.
- Remix access surface (#1145): `/stem/[tokenId]` is the polished asset page
  — type-themed hero with artwork, attribution, audio preview, an action
  rail with Buy/Remix/List, and a license-tiers panel; reachable from
  marketplace card titles and release-page minted-stem chips. Catalog
  metadata fetches use the canonical `API_BASE` (a prior undocumented
  `NEXT_PUBLIC_BACKEND_URL` dependency silently removed the Remix card on
  deployed environments).
- UI (#895): `/remix/studio/[projectId]` — editable studio
  (`web/src/components/remix/RemixStudioEditor.tsx`): inline title editing,
  source attribution linking to the release, rights badge derived from the
  source rights route/content status, stem rows with persisted mute/gain and
  preview-only solo, remix mode selector (stem mix / variation / extension),
  prompt box for the prompted modes, draft status panel with an explicit
  no-generation-yet note, explicit Save with dirty tracking, and
  `aria-disabled` publish/export actions with honest license explanations.
- API (#895): project reads include a public `source` summary (track/release
  titles, artist credit, rights route, content status) and per-stem catalog
  `type`/`title`; `PATCH /remix/projects/:id` accepts validated `mode`
  updates.
- API: token metadata (`GET /api/metadata/:chainId/:tokenId`) now includes
  catalog `stem_id`/`track_id`/`release_id` properties so token-keyed surfaces
  can resolve eligibility.

- API (#896, shipped behind config): `POST /remix/projects/:id/generate` —
  owner-only, re-runs eligibility before generating, requires a prompt for
  prompted modes (and strips prompts for stem mix), rejects duplicate jobs
  without `force=true`, persists provider/job/cost/policy provenance on the
  project, and emits `remix.generation_started` / `remix.generation_failed`.
  Provider failures return the normalized `{ code, message, retryable }`
  contract (`provider_disabled`/`provider_unavailable` → 503,
  `invalid_input` → 400, `provider_rejected` → 422). The default binding is a
  stub provider gated by `REMIX_GENERATION_ENABLED` (see
  `docs/deployment/environment.md`); the input's policy context types
  `voiceLikenessAllowed` as literal `false`.
- API (#1165): `GET /remix/projects/:id/draft-audio` — owner-scoped,
  JWT-authenticated stream for generated draft playback. The endpoint reads
  `generationMetadata.output.outputUri` through the storage provider and
  returns 404 when no playable draft exists. It does not expose raw storage
  URIs or create a download/export path.

- Generation provider (#1162, backlog D2): `LyriaRemixGenerationProvider`
  reuses the catalog Lyria stack behind the provider boundary, selected via
  `REMIX_GENERATION_PROVIDER_KIND=lyria` with `REMIX_GENERATION_ENABLED` as
  the master gate. Prompt-based variation/extension only — stem_mix is
  rejected with `invalid_input` (needs audio conditioning). Output audio is
  stored through the storage provider under `remix-drafts/<projectId>/` and
  recorded on the project (`generationProvider`, `generationJobId`,
  `generationMetadata`: outputUri/synthId/seed/sampleRate/cost). Endpoint
  constraints are bounds-checked (duration ∈ {30,60,120,180}, bpm 40–220,
  key pattern) before any provider work. The studio Draft status panel has a
  Generate/Regenerate button for prompted modes with honest disabled
  reasons and, since #1165, playback for stored draft output.
- Prompt presets (#1177): curated, mode-specific chips above the prompt box
  (variation: Lo-fi chill / Club remix / Darker / Acoustic; extension:
  Build a drop / Add a bridge / Outro). Clicking fills the editable
  textarea with the full preset text — transparent templates, never hidden
  prompt augmentation; hidden in stem_mix like the prompt itself.
- UI (#1165): the studio Stems panel has a Web Audio preview transport that
  fetches existing public stem preview streams, starts the arrangement in sync,
  and applies persisted gain/mute plus preview-only solo live while editing.
  The Draft status panel can play generated AI draft audio through the
  owner-scoped `draft-audio` endpoint when provider metadata contains output.
- UI (#1169): `/settings` has an Artist / Remix Studio consent control for
  artist profiles. The copy states the server policy consequence directly:
  disabling blocks new remix projects and generation, does not delete existing
  private drafts, and keeps existing drafts editable.

## Planned Surfaces

- UI: marketplace listing card remix affordances beyond the existing
  `Remixable` badge (deliberately excluded from #894 to avoid per-card
  eligibility fan-out).
- API/UI: manual approval remix consent states remain deferred; the shipped
  A1 slice supports `allowed` and `disabled`.
- API: `POST /remix/projects/:id/publish`.
- API: `POST /remix/projects/:id/export`.
- Events: `remix.generation_completed` (with queued jobs, backlog D3),
  `remix.published`.

## Product Rules

- Source release must not be blocked or quarantined.
- Source route must allow marketplace/licensing use.
- Artist or rightsholder consent is two-layered: each stem still needs the
  existing `StemNftMint.remixable` affirmative consent, and the artist-level
  global setting defaults to `allowed`.
- Artist-level `disabled` consent is a global revocation override. While
  disabled, new remix projects and draft generation are denied server-side
  even when stems are otherwise remixable and licensed.
- Existing private drafts are not deleted when an artist disables remix access
  and can still be edited, but `generateDraft` re-runs eligibility and denies
  generation while disabled.
- User must own or purchase a valid remix license before AI generation.
- AI-generated derivatives follow the same royalty obligations as human remixes.
- Draft, publish, export, and monetize are separate rights.
- Artist voice/likeness is disabled until explicit consent exists.
- Public remixer/contributor credentials require publication, rights-safe
  attribution, and explicit profile/verifier display consent.
- Abuse limits (#1144): project creation and generation are throttled per
  user with sliding-window hourly ceilings (`REMIX_PROJECT_RATE_LIMIT`,
  default 20; `REMIX_GENERATION_RATE_LIMIT`, default 10) returning HTTP 429
  with an actionable message.
- Post-purchase settling (#1173): a wallet remix purchase is proven by the
  indexed `StemPurchase` row, which lags the transaction (minutes during
  indexer backfills). The stem page applies the purchase to its listings
  optimistically, polls eligibility on a backoff schedule (~8 minutes
  total), shows an honest "finalizing your remix access" notice, and never
  hides the remix CTA from an in-session purchaser.

## Verification

Implemented today:

- `backend/src/tests/remix-eligibility.policy.spec.ts` — pure policy unit
  tests for blocked, quarantined, dmca-removed, limited-monitoring, unknown,
  standard, trusted, opt-out, artist-disabled, non-remixable-mint,
  missing-license, and already-licensed cases (`npm run test`).
- `backend/src/tests/remix.integration.spec.ts` — Testcontainers Postgres
  coverage for eligibility against real rights/mint/purchase/x402 rows,
  default artist remix consent preserving existing eligibility,
  artist-disabled policy denial, durable project create/read/update, restart
  durability, ownership enforcement, generation re-check denial while artist
  remix consent is disabled, and policy denial events (`npm run
  test:integration`).
- `backend/src/tests/artist.integration.spec.ts` — Prisma-backed artist
  settings update plus `artist.remix_consent_updated` event emission.
- `backend/src/tests/artist.controller.http.spec.ts` — authenticated settings
  route contracts, route-scoped ownership, and 403 for another user's artist.
- `backend/src/tests/remix.controller.http.spec.ts` — HTTP contract: guards,
  routing, status codes, and JWT-not-body identity.
- `web/src/components/remix/RemixCta.test.tsx` — CTA state resolution,
  rendering for enabled, license-required, blocked (aria-disabled), hidden,
  and signed-out states, plus draft-reuse selection
  (`cd web && npx vitest run src/components/remix`).
- `web/src/components/remix/RemixStudioEditor.test.tsx` — minimal-patch
  building, gain clamping, rights badge derivation, editor rendering
  (attribution, stem controls, prompt gating by mode, unavailable
  publish/export with reasons), and the page shell's signed-out/loading
  states.

Remaining for later slices:

- Playwright test for the studio happy path with observable audio controls;
- provider-failure tests for normalized generation errors (#896).

## References

- RFC: [Remix Studio](../rfc/remix-studio.md)
- RFC: [AI Derivative Rights Policy](../rfc/ai-derivative-rights-policy.md)
- RFC: [Remix And Contributor Credential Boundaries](../rfc/remix-contributor-credential-boundaries.md)
- Backlog: [Remix Studio Backlog](remix_studio_backlog.md)
- Licensing: [Licensing Architecture](../rfc/licensing-architecture.md)
- Rights: [Rights Verification Strategy](../rfc/rights-verification-strategy.md)
- Generation: [AI Music Generation](ai_music_generation.md)
