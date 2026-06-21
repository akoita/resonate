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
access while preserving existing private drafts. Queue-backed jobs (D3) are
shipped: long-running provider calls run in BullMQ, the studio polls pending
jobs, and retries are explicit. Stem-mix rendering (#1189) is shipped: the
arranged stems render server-side into a real draft with no AI involved.
In-Resonate publishing (backlog E2,
[#1196](https://github.com/akoita/resonate/issues/1196)) is shipped: an owner
can publish a completed draft as a catalog remix release via
`POST /remix/projects/:id/publish`. Publishing re-checks eligibility
server-side at publish time (a consent flip or quarantine between draft and
publish blocks it) and enforces the policy's `allowedActions.publish_resonate`;
it creates a `type: "remix"` release with one track carrying machine-readable
lineage (source track/release/stem IDs, remix project ID, provider, mode,
`grounding`, AI-disclosure flag, policy version), records the published release
on the project, and locks the project against further edits/generation. The
release page renders the source attribution and the honest AI-provenance label.
Export/download (license-gated) and License-NFT/ancestry minting (E3) remain
planned; the MVP epic is
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
  - `remix.published` — successful in-Resonate publish; `projectId`,
    `releaseId`, `mode`.
  - `remix.studio_action_unavailable` — click on a gated publish control or a
    locked export control; `projectId`, `action`, stable `reasonCode`
    (publish gates: `publish_needs_completed_draft` | `publish_dirty` |
    `publish_eligibility_loading` | `publish_not_allowed`; export:
    `export_rights_required`).
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
- Honest draft provenance labels (#1181/#1207/#1209): the studio draft panel states,
  per draft, exactly what of the source audio shaped it — rendered drafts
  "contain the source audio itself", stem-plus-AI drafts say the licensed stems
  stay in the draft with AI-generated layers mixed on top, audio-conditioned
  drafts say the AI draft was conditioned on stem audio while staying
  draft-quality, feature-conditioned drafts name the measured tempo/key and
  state the model "does not hear the source audio", and prompt-only drafts say
  they are "not derived from the source audio".
  Legacy drafts without grounding metadata show no claim rather than a
  guessed one. Remix CTA copy was reviewed and makes no AI-derivation
  claims ("Remix" refers to the licensed remix workflow).
- Feature-conditioned prompts (#1182 slice 3): prompted-mode generation
  derives tempo/key hints from the unmuted source stems' measured features
  (#1184) — highest-confidence beat track and key estimate win; muted stems
  are excluded. Explicit user constraints always take precedence; derived
  hints fill the gaps and the Lyria prompt says they were measured from the
  source stems. Every generation now records honest `grounding` provenance
  in `generationMetadata` (#1181/#1207/#1209): `stem_audio` (rendered from
  the licensed stems), `stem_plus_ai` (licensed stem backbone plus generated
  layers), `audio_conditioned` (AI provider conditioned on arranged stem
  audio), `feature_conditioned` (prompt guided by measured tempo/key), or
  `prompt_only` (nothing from the source audio shaped the output, e.g. stems
  ingested before #1184 carry no features yet).
- Stem mix rendering (#1189, slice 2 of #1182): `stem_mix` projects render
  the saved arrangement (per-stem gain/mute) into one MP3 server-side with
  ffmpeg — zero AI, zero vendor cost, so the render path sits outside the
  `REMIX_GENERATION_ENABLED` master gate (which gates paid generation). It
  reuses the queue-backed generation pipeline end to end: same enqueue
  endpoint, metadata lifecycle, stale-retry escape, draft-audio stream, and
  studio polling, recorded as provider `stem-mix-render` with
  `estimatedCostUsd: 0`. The studio Generate button becomes "Render mix" in
  stem-mix mode (no prompt required; unsaved edits still block so the render
  matches what was saved). The output draft literally contains the licensed
  stem audio — the first stem-grounded draft and the artifact publish/export
  (backlog E/F) will consume. The #1210 quality foundation applies the
  versioned `remix-render-policy/v1` after preserving relative per-stem gains:
  -14 LUFS target, 11 LU loudness range, -1.5 dBTP ceiling, stereo 48 kHz MP3
  at 320 kbps. Completed drafts persist the complete arrangement and render
  settings in `sourceArrangement` and `renderMetadata`, so the final artifact
  is reproducible and auditable. `stem_plus_ai` now renders source stems and
  the generated layer in one ffmpeg graph, avoiding an intermediate MP3 and a
  second lossy encode. Encrypted source stems now render
  ([#1214](https://github.com/akoita/resonate/issues/1214)): the generation
  worker re-verifies project ownership and current eligibility, then the shared
  mixer decrypts each authorized encrypted stem in memory through a strict
  fail-closed boundary (`EncryptionService.decryptForRender`) into its unique,
  unconditionally-cleaned temp dir. Plaintext is never cached, uploaded, logged,
  or returned individually, and ciphertext is never passed to ffmpeg or a
  provider. See [Encrypted Stem Rendering](#encrypted-stem-rendering-1214) below
  for the key-access, audit, and revocation details.
- Stem audio feature extraction (#1184, slice 1 of #1182): the demucs
  worker measures tempo (BPM + bounded confidence heuristic), beat anchors
  (`beatCount`, `firstBeatSec`), key (Krumhansl chroma template matching),
  RMS energy, and onset density per separated stem (`workers/demucs/
  audio_features.py`, librosa, schema `stem-audio-features/v1`). Features
  ride the `stems`-sibling `stemFeatures` map on Pub/Sub results and the
  legacy HTTP response, are sanitized at the backend boundary (schema check,
  BPM clamped to 30-300, malformed payloads dropped with a warning), persist
  on `Stem.audioFeatures` (nullable JSON), and are exposed on remix project
  stem reads. A `POST /analyze` worker endpoint (same inbound auth posture
  as `/separate`: deployment-level protection) supports backfill and
  isolated testing. Extraction failure for one stem never fails separation.
  Stems separated before this slice are backfillable: admin-only
  `POST /admin/stems/backfill-audio-features` (batch-bounded `limit`,
  re-run until `remaining` is 0) sends stored stem audio to the worker's
  `/analyze` and persists sanitized features — after which their next
  generation upgrades from `prompt_only` to `feature_conditioned`
  grounding. Encrypted stems are excluded. Chords/structure are v2.
- UI (#1175): the Library → Stems tab is a real entry point for owned
  stems — stem titles link to `/stem/[tokenId]` (with a matching "View stem
  page" row action), and each row renders the eligibility-backed `RemixCta`
  chip (stem-scoped, license-required state hidden since the stem page is
  the buy surface). The collection API (`GET /api/metadata/collection/:address`)
  exposes the source `trackId` to drive it. Unminted stems render without a
  link.
- Artist-owner access (#1174, policy `2026-06-12.v4`): the user who owns the
  source artist profile counts as remix-licensed for their own material — no
  self-purchase required, so owners see `Remix` instead of `Get remix
  license`. Ownership satisfies **only** the license requirement: content
  status, rights route, per-mint remixability, and the artist's own disabled
  consent still deny. The eligibility response and `remix.project_created`
  events carry `creatorOwner` so cockpit demand signals exclude artists
  remixing themselves.
- Eligibility policy v3 (#1145/#1169, superseded by v4 above): track-default requests
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

- API (#896/#1167, shipped behind config): `POST /remix/projects/:id/generate` —
  owner-only, re-runs eligibility before generating, requires a prompt for
  prompted modes (and strips prompts for stem mix), checks constraint bounds
  before enqueue, rejects duplicate active jobs, and returns immediately with
  `generationMetadata.status = pending`. Explicit `retry=true` replaces a
  completed or failed job; legacy `force=true` is still accepted as a
  compatibility alias and should not be used by new clients. The BullMQ worker
  calls the configured provider and records terminal `completed` or `failed`
  metadata on the project. Events emitted from the backend lifecycle are
  `remix.generation_started`, `remix.generation_completed`, and
  `remix.generation_failed`, all carrying the generation job id. Provider
  failures are normalized into the project metadata using the existing
  `provider_disabled`/`provider_unavailable`/`invalid_input`/
  `provider_rejected` codes. The default binding is a stub provider gated by
  `REMIX_GENERATION_ENABLED` (see `docs/deployment/environment.md`); the
  input's policy context types `voiceLikenessAllowed` as literal `false`.
- API (#1165): `GET /remix/projects/:id/draft-audio` — owner-scoped,
  JWT-authenticated stream for generated draft playback. The endpoint reads
  `generationMetadata.output.outputUri` through the storage provider and
  returns 404 when no playable draft exists. It does not expose raw storage
  URIs or create a download/export path.
- API (#1196, backlog E2): `POST /remix/projects/:id/publish` — owner-only,
  publishes a completed draft as a catalog remix release. Re-runs
  `checkEligibility` at publish time (consent flips and quarantines between
  draft and publish block it) and enforces `allowedActions.publish_resonate`
  on top of `allowed`; only completed drafts publish (409 otherwise).
  Publishing is conflict-safe — a conditional `status='draft'` claim plus a
  unique `publishedReleaseId` make a double publish unable to create two
  releases. The created `type: "remix"` release has one track whose audio is a
  catalog-owned copy of the draft output (served by existing catalog
  streaming, no new raw-URI surface), with lineage metadata: source
  track/release/stem IDs, remix project ID, provider, mode, `grounding`,
  `aiGenerated` (`grounding !== "stem_audio"`, #1164), and policy version.
  Published projects reject PATCH edits and generation while staying readable.
  Emits `remix.published` (artistId-attributed for the cockpit, #1121;
  bridge-whitelisted in the same change). `GET /remix/releases/...` is served
  by the catalog; `getRelease` returns a focused `remix` provenance summary
  for `type: "remix"` releases.

- Generation provider (#1162/#1209, backlog D2): `LyriaRemixGenerationProvider`
  reuses the catalog Lyria stack behind the provider boundary, selected via
  `REMIX_GENERATION_PROVIDER_KIND=lyria` with `REMIX_GENERATION_ENABLED` as
  the master gate. Prompt-based variation/extension only — stem_mix is
  rejected with `invalid_input` (it is rendered by the stem-mix path). For
  prompted modes, Lyria output is treated as one additive generated layer and
  the final draft is rendered by mixing that layer over the saved source-stem
  arrangement (`grounding: stem_plus_ai`, provider
  `stem-plus-ai-layered-render`). `generationMetadata` keeps both the final
  render output and `generatedLayers` metadata for the layer provider/job,
  prompt, constraints, URI, MIME type, SynthID, seed, and sample rate. Endpoint
  constraints are bounds-checked (duration ∈ {30,60,120,180}, bpm 40–220, key
  pattern) before any provider work. The studio Draft status panel has a
  Generate/Regenerate button for prompted modes with honest disabled reasons
  and, since #1165, playback for stored draft output. Since #1167, the Draft
  status panel shows queued job state, polls until terminal state, displays
  normalized failure copy, and only exposes the play control once a completed
  job records output metadata.
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
- API: `POST /remix/projects/:id/export` (license-gated download; the export
  button keeps its honest disabled state).
- Protocol: License-NFT / AncestryTracker minting from published lineage (E3 —
  #1196 persists the lineage data only).

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
  publish/export with reasons), honest grounding copy including
  `audio_conditioned`, and the page shell's signed-out/loading states.

Remaining for later slices:

- Playwright test for the studio happy path with observable audio controls;
- provider-failure tests for normalized generation errors (#896).

### Audio-conditioned generation (#1182 slices 4–5) — spike result

The adopt-gate for true audio conditioning (#1193) is complete:

- **Gate 2 (license):** GO — see
  [Stable Audio 3 License Review](../rfc/stable-audio-3-license-review.md).
- **Gate 1 (quality):** **CONDITIONAL GO** — see
  [Stable Audio 3 Spike Findings](../rfc/stable-audio-3-spike-findings.md).
  Conditioning `stabilityai/stable-audio-3-medium` on a real stem **preserves
  source identity** and **steers on text** (recommended `steps=25`,
  `cfg_scale≈7`, `init_noise_level≈0.2`), but output is **draft-quality, not
  master-quality** (the *medium* model's autoencoder fidelity ceiling).

Status of slices 4–5: **partial — backend and honest product surface landed
behind default-off flags; environment enablement and fidelity follow-ups remain.**

- **Slice 4 (#1206, this slice):** the `audio-conditioned` provider
  (`REMIX_GENERATION_PROVIDER_KIND=audio-conditioned`) mixes the project's
  unmuted stems (shared `StemAudioMixer`, reused from stem-mix render so the
  encrypted-stem decrypt-for-render boundary is shared, #1214) and sends that
  audio + the prompt to a
  self-hosted Stable Audio 3 worker (`workers/stable-audio/`, scale-to-zero
  Cloud Run GPU). Defaults match the spike (`cfg≈7`, `init_noise_level≈0.2`,
  `steps=25`). Behind `REMIX_GENERATION_ENABLED`, default off — not yet
  user-visible.
- **Slice 5 (#1207):** the honest `audio_conditioned` grounding kind is wired
  through generation metadata, publish provenance, analytics events, Remix
  Studio draft-status copy, and published remix release provenance. The label
  says the model was conditioned on stem audio while making clear the result is
  an AI draft at draft quality.
- **Slice 6 (#1209):** the stronger default AI-remix shape is `stem_plus_ai`:
  prompted Lyria output is recorded as an additive generated layer, then mixed
  over the arranged licensed stems with the shared ffmpeg mixer. The final
  draft keeps the source stem audio and carries generated-layer provenance,
  while still disclosing AI because generated layers are present.
- **Quality foundation (#1210):** deterministic and layered final renders use
  the same versioned loudness/headroom policy, persist full arrangement and
  render metadata, and normalize storage failures without exposing provider
  details. Fade, trim, loop, effects, and release-grade mastering remain
  explicitly out of scope. Encrypted rendering shipped in #1214 (see below).

Keeps audio-conditioned Stable Audio full regeneration (#1206/#1207) as an
experimental draft-quality path and stem-mix renders (#1189) as the zero-AI
mode; release-grade claims stay deferred until the fidelity follow-ups
(for example, validating the best supported self-hosted model variant and the
stereo-output fix) are done. Stable Audio 3 Large is API-only, not a supported
`workers/stable-audio` model.

### Encrypted Stem Rendering (#1214)

Status: **implemented.** Deterministic `stem_mix`, `stem_plus_ai` layered, and
audio-conditioned renders can use eligible encrypted source stems without ever
exposing plaintext through persistent storage, public APIs, logs, or provider
error messages.

How it works:

- **Worker-time authorization.** `RemixProjectService.processGenerationJob`
  re-verifies project ownership and current remix eligibility
  (`RemixEligibilityService.checkEligibility`) immediately before any render
  path runs. The request-time check at enqueue is not trusted, because consent,
  quarantine, licensing, content status, and project state can change while a
  job is queued. A revoked, quarantined, consent-disabled, unlicensed, or
  rights-blocked source fails **before** any stem is decrypted.
- **Render grant.** When the re-check passes, the worker builds an in-process
  `StemRenderAuthorization` (`userId`, `remixProjectId`, the set of re-confirmed
  `authorizedStemIds`) and threads it through the renderers into the shared
  `StemAudioMixer`. The grant is built in the worker, never read from the queue
  payload, and never carries key material.
- **Strict decrypt boundary.** For each authorized encrypted stem the mixer
  calls `EncryptionService.decryptForRender`, which decrypts the loaded
  ciphertext **in memory only**. It never writes to the on-disk decrypted cache
  and never falls back to returning the raw buffer: a stem flagged
  `isEncrypted` with missing/invalid metadata, a missing internal key, denied
  access, or corrupt ciphertext fails closed, so ciphertext can never reach
  ffmpeg or a generation provider. Decrypted plaintext lives only in the mixer's
  unique OS temp dir, which is removed unconditionally in a `finally` block on
  every success and failure path. Individual decrypted stems are never uploaded.

Key access & deployment:

- Decryption reuses the existing AES provider's internal-service bypass
  (SBPR-004) under a narrowly named `remix-render-authorized` purpose. It
  requires `INTERNAL_SERVICE_KEY` to be set in **every** environment — there is
  no non-production fallback for this purpose (unlike marketplace preview). If
  `INTERNAL_SERVICE_KEY` is unset, encrypted renders fail closed.
- Required env vars (already used by encryption): `ENCRYPTION_SECRET` (or
  `JWT_SECRET` fallback) for AES key derivation, `INTERNAL_SERVICE_KEY` for the
  internal render grant. No new secret is introduced.
- Key rotation/revocation: AES keys derive per-content from
  `ENCRYPTION_SECRET` + the stem's `keyId`. Rotating `ENCRYPTION_SECRET`
  invalidates decryption of previously encrypted stems (they fail closed as
  `decryption_failed`), so rotate in lockstep with re-encryption. Revoking a
  source's remix rights (consent flip, quarantine, DMCA, license expiry) is
  enforced by the worker-time eligibility re-check and blocks decryption on the
  next render attempt.

Audit & incident response:

- Two compact security/audit domain events are emitted (not wired into product
  analytics): `remix.encrypted_render_authorized` (a render decrypted N
  encrypted stems for an owned, eligible project) and
  `remix.encrypted_render_denied` (a render with encrypted stems was rejected
  at the worker-time re-check). Both carry only project/creator/source IDs, the
  internal purpose, outcome, and encrypted-stem count — never stem bytes,
  encryption metadata, keys, storage URIs, prompts, or provider error bodies.
- On suspected key compromise: unset/rotate `INTERNAL_SERVICE_KEY` to disable
  all internal render decryption immediately (renders fail closed), then rotate
  `ENCRYPTION_SECRET` and re-encrypt affected stems. The audit events above
  bound the blast radius (which projects/sources decrypted encrypted stems and
  when).

Code & tests:

- `backend/src/modules/encryption/encryption.service.ts`
  (`decryptForRender`, `RenderDecryptionError`),
  `backend/src/modules/encryption/providers/aes_encryption_provider.ts`
  (`remix-render-authorized` purpose),
  `backend/src/modules/remix/stem-audio-mixer.ts` (decrypt boundary + cleanup),
  `backend/src/modules/remix/remix-project.service.ts` (worker-time re-check +
  audit events).
- Tests: `backend/src/tests/encryption-render-decrypt.spec.ts` (strict
  decryption unit tests incl. no-cache + fail-closed),
  `backend/src/tests/remix-stem-audio-mixer.integration.spec.ts` (authorization
  gate, decrypt failure mapping, mixed/muted arrangements, cleanup, ffmpeg-gated
  decrypt+mix e2e), `backend/src/tests/remix.integration.spec.ts` (worker-time
  denial never reaches the render/decrypt boundary).

## References

- RFC: [Remix Studio](../rfc/remix-studio.md)
- RFC: [AI Derivative Rights Policy](../rfc/ai-derivative-rights-policy.md)
- RFC: [Remix And Contributor Credential Boundaries](../rfc/remix-contributor-credential-boundaries.md)
- Backlog: [Remix Studio Backlog](remix_studio_backlog.md)
- Licensing: [Licensing Architecture](../rfc/licensing-architecture.md)
- Rights: [Rights Verification Strategy](../rfc/rights-verification-strategy.md)
- Generation: [AI Music Generation](ai_music_generation.md)
