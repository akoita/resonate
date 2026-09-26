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
Export/download ([#1323](https://github.com/akoita/resonate/issues/1307)) is
shipped and **commercial-license-gated**: an owner can download a completed
draft via `POST /remix/projects/:id/export` only when they hold a **commercial**
license on the selected source stems (the tier that grants off-platform/
monetized use; Personal ⊂ Remix ⊂ Commercial). Export re-checks eligibility
server-side and enforces the policy's `allowedActions.export` on top of
`allowed`, mirroring publish. License-NFT/ancestry minting (E3) remains planned;
the MVP epic is [#891](https://github.com/akoita/resonate/issues/891).

The **creation→commerce bridge** ([#1413](https://github.com/akoita/resonate/issues/1413))
closes the **create → own → sell** loop: a published remix's `master` stem can be
minted and listed on the existing marketplace as an ownership product, growing
artist take-home (the sprint's north star). No new contract is required — the
StemNFT contract already treats remixes as first-class (`parentIds`, `remixable`,
per-token EIP-2981 royalties) and the standard mint-and-list pipeline is generic
over any authorized stem. Three things make it rights-clean and usable:

- **Sell-rights gate.** Minting a remix master for sale requires the eligibility
  engine's `export` action (a **commercial** license on every source stem, or
  owning the source artist) — enforced at **mint authorization**
  (`code: "remix_sell_rights_required"`), closing the prior gap where only the
  rights *route* was checked. Selling a remix built from remix-tier-only licenses
  is refused.
- **The bridge CTA.** The studio's published banner shows a rights-gated
  **"List this remix for sale"** action (enabled only when the project's
  `commerce.sellable` is true; an honest disabled state names the reason
  otherwise — no dead button). It deep-links to the release page's **NFT
  Marketplace** section, which runs the existing **Protect Release** (on-chain
  attestation) → **Mint & List** flow. Attestation is the load-bearing
  prerequisite (the mint authorizer requires an on-chain ContentProtection
  attestation); attest-only is sufficient to list, since an unstaked release has
  an uncapped listing-price cap.
- **Royalties.** The remix master mints with the standard single EIP-2981
  receiver = the **remix creator**. Recursive royalty flow-through to the
  original source artist(s) — the "recursive remix royalties" vision — is
  **deferred to E3 (License-NFT / ancestry, RFC #310)** because multi-parent
  splits need a splits contract that is not yet built; tracked on
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
  `draft`/`archived` status, per-stem role/gain/mute/arrangement controls,
  and the variation AI target (#1882): `aiTarget` is
  `{ kind: "whole" | "add_layer" | "replace_stem", stemId }` or `null`
  (= whole track). A `stemId` is allowed only for `replace_stem`, must be
  a project stem, and may be null while no stem is picked yet;
  `{ kind: "whole" }` is stored as null. Project reads return `aiTarget`.
  `POST /remix/projects/:id/generate` falls back to the saved target when
  the request carries no `stemTransform` in variation mode (`add_layer`, or
  `replace_stem` with a stem; a stem-less `replace_stem` returns 400 "Pick the
  stem to replace first"). The derived transform runs through the same
  validation as an explicit one, and an explicit `stemTransform` always wins.
- API (deprecated): `POST /remix/create` and `GET /remix/:remixId` — legacy
  in-memory experiment kept for compatibility until #894+.
- Data: `RemixProject` and `RemixProjectStem` Prisma models with creator,
  source track, stems, license context, prompt, mode, generation metadata,
  attribution, and export-policy placeholders.
- Events: `remix.project_created` (carries the source release's `artistId`
  for artist-cockpit attribution, #1121), `remix.policy_rejected`,
  `remix.license_required`, `remix.published`, `remix.exported` (#1323;
  successful commercial-gated export), and `artist.remix_consent_updated`
  (governed analytics bridge mappings included; the artist-consent bridge
  payload explicitly includes `artistId`).
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
    Since #1879 the studio autosaves, so this fires once per debounced
    autosave (roughly per editing pause), not per explicit Save click.
  - `remix.published` — successful in-Resonate publish; `projectId`,
    `releaseId`, `mode`.
  - `remix.studio_action_unavailable` — click on a gated publish control or a
    locked export control; `projectId`, `action`, stable `reasonCode`
    (publish gates: `publish_needs_completed_draft` | `publish_dirty` |
    `publish_eligibility_loading` | `publish_not_allowed`; export gates:
    `export_needs_completed_draft` | `export_dirty` |
    `export_eligibility_loading` | `export_rights_required`).
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
  marketplace card titles and release-page minted-stem chips.
- Per-tier purchase (#1304): each **listed** tier in the license-tiers panel
  carries a **Buy** button that opens the buy modal pre-set to that tier's
  listing, so a non-owner can buy the **Remix** (or Commercial) license
  directly — the remix-tier purchase then flips eligibility and unlocks the
  studio, and a **commercial**-tier purchase additionally unlocks export/
  download (#1323). Buy buttons are hidden for a seller viewing their own
  listing. The
  artist already chooses the tier when listing (`ListStemModal` →
  `LicenseTypeSelector`); the backend listing/purchase/eligibility wiring was
  already complete, so this was the final frontend gap. Catalog
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
- Full-session hydration (#1312, P0 of epic #1311): project creation
  auto-adds every **individually eligible** sibling stem of the source track —
  explicit selection unmuted, hydrated siblings muted; non-remixable mints,
  unlicensed stems, and full-mix `original`/`master` types are never
  volunteered — so a stem-page entry opens a full desk instead of a
  one-channel session. Draft reads include `availableStems` (the source
  track's remaining stems with per-stem license/remixable state and minted
  `tokenId`), rendered as the studio's "Also on this track" panel: licensed
  siblings join via `PATCH /remix/projects/:id` `addStemIds` (strict per-stem
  eligibility re-check; published projects stay locked), unlicensed ones link
  to `/stem/[tokenId]` for the remix-tier purchase (#1141/#1306). Measured
  tempo/key from `audioFeatures` (#1184) is shown once per project (see the
  studio audio correctness bullet below; this replaced the per-stem chips of
  #1318), and the stems panel explains that hydrated
  siblings start muted. The stem-scoped
  Remix CTA reuses any draft **containing** the requested stems (containment,
  not exact-set, so hydrated supersets don't mint duplicate projects). The
  `remix.project_created` event still carries the explicit selection only.
  Tests: `backend/src/tests/remix-session-hydration.integration.spec.ts`,
  `web/src/components/remix/RemixStudioEditor.test.tsx`.
- Section-grid arrangement (#1314, P1 of epic #1311): the studio gains an
  **Arrangement** grid — stems switch on/off per section, which is what makes
  the mix change over time. Sections are **8 bars**, derived deterministically
  from the stems' measured features (#1184): highest-confidence tempo +
  first-beat anchor; tracks without a measured tempo fall back to honest
  **16-second time sections**; nothing gridworthy → no grid. The derivation is
  served on project reads (`sectionGrid`) so the studio, PATCH validation, and
  the render worker share one source of truth. Per-stem masks persist in the
  existing `RemixProjectStem.arrangement` JSON (`remix-stem-arrangement/v1`;
  `null` = always on, no migration). Renders gate each stem with a generated
  ffmpeg volume envelope (~50 ms edge fades) inside the same graph — uniform
  across `stem_mix`, the `stem_plus_ai` stem bed, and the audio-conditioned
  conditioning mix; a fully-active stem renders byte-identically to before,
  and an all-off mask counts as muted. The WebAudio preview schedules the same
  spans on a dedicated per-stem section gain node (cell edits apply on the
  next preview start). Masks authored against a stale grid fail open to
  fully-active rather than gating at wrong boundaries.
  Tests: `backend/src/tests/remix-arrangement.spec.ts`,
  `backend/src/tests/remix-arrangement.integration.spec.ts`,
  `web/src/lib/remixArrangement.test.ts`.
- Per-stem AI transforms (#1316, P2 of epic #1311): variation-mode generation
  gains an **AI target** — *whole track* (unchanged default), *add a layer*
  (one new additive part conditioned on the full arrangement), or *replace a
  stem* (an isolated role-scoped part conditioned on the **bed** — every stem
  except the target — so the generated layer takes the target's place instead
  of doubling it). `POST /remix/projects/:id/generate` accepts
  `stemTransform { kind: replace_stem | add_layer, stemId? }`, strictly
  validated (variation only; target must be a project stem; replacing the only
  unmuted stem is rejected — the bed cannot be empty). The transform's honest
  lead instruction replaces the generic variation framing in the Lyria and
  audio-conditioned prompts while measured tempo/key hints still apply; the
  bed drives provider conditioning, the layered render, and the decrypt
  authorization set; arrangement gating (#1314) applies to the bed unchanged.
  Grounding is untouched (`stem_plus_ai` for the layered path,
  `audio_conditioned` for conditioned regeneration); `generationMetadata` and
  publish lineage record the transform (kind + stem id/label), and the studio
  Draft panel describes it plainly ("AI drums replacement…", "New AI layer…").
  Tests: `backend/src/tests/remix-stem-transform.spec.ts`,
  `backend/src/tests/remix-stem-transform.integration.spec.ts`,
  `web/src/components/remix/RemixStudioEditor.test.tsx`.
- Draft versions, honest cost, preview honesty (#1320, P3 of epic #1311):
  regenerating no longer orphans the previous draft — the completed output is
  archived into `generationMetadata.previousDrafts` (newest first, capped at
  3, no schema change; stored outputs are never deleted so archived URIs stay
  streamable, and the history survives failed regenerations).
  `GET /remix/projects/:id/draft-audio?jobId=` streams an archived version
  (owner-scoped, 404 for unknown ids); the studio Draft panel lists versions
  with play controls for A/B listening (switching versions mid-play swaps the
  transport). Recorded `estimatedCostUsd` now renders on the completed status
  line, next to Regenerate ("Last run ~$0.12"), and on each archived version —
  recorded numbers only, no pre-spend guesses; $0 stem-mix renders stay
  unlabelled. The stems panel states the preview-vs-render loudness gap
  ("unmastered … final renders are loudness-normalized"). Publish still uses
  the current draft only; archived versions never publish.
  Tests: `backend/src/tests/remix-draft-versions.spec.ts`,
  `backend/src/tests/remix-draft-versions.integration.spec.ts`,
  `web/src/components/remix/RemixStudioEditor.test.tsx`.
- Studio audio correctness (phase 0 of the studio ergonomics pass):
  - **Full-mix reference, not a channel.** A track-default entry (the
    release-page Remix button) used to add the full-mix `original`/`master`
    stem unmuted next to the separated stems, which doubled every part in
    previews and renders. Project creation now stores full-mix stems **muted**
    whenever the selection also has separated stems. A lone full mix (a track
    with no separated stems) stays a normal unmuted channel. The studio treats
    such a full-mix stem as a **reference**: it is hidden from the mixer and
    arrangement rows while muted, and a "Compare with original" toggle plays it
    alone at unity for A/B listening. Legacy projects that still have it
    unmuted show a doubling warning with a one-click "Use as reference only"
    fix, saved through the normal Save flow. The fix is never applied silently.
  - **One musical summary.** Per-stem tempo/key chips contradicted each other
    (a vocal tempo artifact next to the grid tempo, a "key" on drums). The
    header now shows one project-level chip: the section-grid tempo (bar grids
    only) and a confidence-weighted key vote that excludes drums and
    percussion.
  - **Preview master bus.** The WebAudio preview now runs through a limiter
    with a small level meter that flags limiting, so summing many stems no
    longer clips. Final renders still use the loudness policy above.
  - **Cached preview audio.** Stems are downloaded and decoded once per studio
    session and reused on every Play; a failed load retries on the next Play.
  - **One audio source at a time.** Starting a studio preview or draft pauses
    the site player, and starting the site player stops studio audio.
  Tests: `backend/src/tests/remix-session-hydration.integration.spec.ts`,
  `web/src/lib/remixAudioPreview.test.ts`,
  `web/src/components/remix/RemixStudioEditor.test.tsx`.
- Session lanes and transport (phase 1 of the studio ergonomics pass,
  [#1879](https://github.com/akoita/resonate/issues/1879)): the separate
  Stems list and Arrangement grid merged into one **Session** view with one
  row per stem. Each row has a channel strip (mute, solo, gain) and a
  time-proportional lane: a waveform drawn from the decoded preview audio,
  with the section cells on top. Cells toggle by click or drag-to-paint, and
  each row has all-on/all-off. Column labels are bar numbers (a short first
  section reads "Pickup") for bar grids and `m:ss` for time grids.
  - **Transport.** A sticky transport replaces the separate preview and
    draft players. It has play/stop, a moving playhead and clock, click-to-seek,
    and loop-a-section (click a column header). A source switch picks the
    live **Arrangement**, the current **Draft** (or an archived version from
    the draft panel), or the untouched **Original** reference. Mixer and cell
    edits apply to the running preview immediately; section envelopes are
    re-scheduled from the playhead.
  - **Preload.** Stems are downloaded and decoded when the studio opens, so
    waveforms appear and the first Play starts without a wait.
  - **Autosave.** Edits save automatically about a second after the last
    change, and the Save button is gone. Edits made during a save are kept and
    saved next. A failed save shows a Retry control and pauses autosave until
    the next edit. Leaving the page with unsaved edits asks for confirmation.
    Generate, Publish and Export wait out the brief "Saving your latest
    changes…" state instead of asking the user to save.
    `remix.studio_saved` now fires per successful autosave.
  - **Keyboard.** Space plays/stops, M/S mute/solo the focused row, Esc
    clears the loop.
  Tests: `web/src/lib/remixAudioPreview.test.ts`,
  `web/src/lib/remixWaveform.test.ts`,
  `web/src/components/remix/useRemixTransport.test.ts`,
  `web/src/components/remix/RemixSessionLanes.test.tsx`,
  `web/src/components/remix/RemixTransportBar.test.tsx`,
  `web/src/components/remix/RemixStudioEditor.test.tsx`,
  `web/tests/remix-studio.authenticated.spec.ts` (Playwright, mocked API).
- Create panel and draft cards (phase 2 of the studio ergonomics pass,
  #1879): the Remix mode, Draft status, and Save/Publish/Export footer
  sections are replaced by a two-column layout. On wide screens the left
  column holds the Session with **Drafts** directly under it, and the right
  column holds **Create** as a compact sticky panel capped at the viewport
  height. Small screens stack Session, then Create, then Drafts.
  - **Create** has a two-way switch.
    - **Mix stems** is the free `stem_mix` render. It offers one-click
      arrangements that rewrite mutes and section masks (autosaved):
      Acapella, Instrumental, Drums & bass, and Breakdown → drop. Each is shown
      only when the session has the stems it needs, and full-mix references
      are always kept muted.
    - **Add AI** is one flat list of intents that replaces the mode selector
      plus the AI-target selector: Reimagine the track (variation, whole), Add
      a new part (variation, add layer), Replace a stem (variation, replace;
      with a stem picker), and Extend the track (extension). It carries the
      prompt presets and prompt, a one-row credit meter showing the balance
      and the existing price ("$0.10 per 30 s"; no pre-spend estimate; the
      empty note says AI drafts need credits and never implies Mix stems
      does), and the provider attribution badge. Each intent is one compact
      line, and only the selected intent's description is shown.
    - One primary button keeps the existing gating and labels.
  - **Drafts** has a current-draft card and compact version cards.
    - The current-draft card shows its status (queued / failed with retry via
      Create / completed / no output) and a short provenance chip. The chips
      are "Your stems only", "Your stems + AI layer", "AI · heard your stems",
      "AI · tempo/key matched" and "AI · prompt only", with the full honest
      grounding text under "How this draft was made".
    - The card also shows the transform note, the recorded cost, the
      completion time, a mini waveform, and play.
    - Publish and Export live on the current draft, with the same gating and
      locked-click analytics.
    - Version cards show the same waveform, provenance and play, for A/B.
    - Job IDs and the policy version are no longer shown to users. They stay
      in generation metadata and publish lineage.
  - Draft waveforms are decoded from the draft audio. The current draft loads
    when the studio opens; archived versions load on their first play. One
    download serves both playback and the waveform.
  The chosen AI intent, including the stem to replace, is saved with the
  project (#1882), so a project reopens on the intent it was left on.
  Tests: `web/src/lib/remixIntent.test.ts`, `web/src/lib/remixRecipes.test.ts`,
  `web/src/components/remix/RemixCreatePanel.test.tsx`,
  `web/src/components/remix/RemixDraftsPanel.test.tsx`,
  `web/src/components/remix/RemixStudioEditor.test.tsx`,
  `web/tests/remix-studio.authenticated.spec.ts`.
- Studio effects and vibe starters (#1897, slice S1 of epic
  [#1896](https://github.com/akoita/resonate/issues/1896) "Remix Studio for
  everyone"). The target user is a passionate listener with no
  sound-engineering skills, so the controls change the real stems
  deterministically instead of generating new audio.
  - **Recipe.** A versioned effects recipe (`remix-fx/v1`, stored as
    `RemixProject.effects`; null = untouched) holds a master section (speed
    0.75–1.25 varispeed, space, tone, warmth) and per-stem sections (space,
    echo, tone).
    - `PATCH /remix/projects/:id` validates it (bounds, project stems only),
      rounds values to 2 decimals, omits defaults, and stores an all-default
      recipe as null.
    - Project reads return it.
  - **One DSP contract, two engines.** Both the ffmpeg render and the
    WebAudio preview run the same signal order and math.
    - Per stem: varispeed → gain → section gate (in output time) →
      tone filter → 4-tap tempo-synced echo → dry plus a send to one shared
      reverb bus.
    - Master: tone → `tanh` warmth → the loudness policy.
    - The reverb is a deterministic, code-generated impulse response
      (seeded noise with a 60 dB decay over 2.8 s), so it has no licensing and
      is reproducible.
    - A committed parity fixture
      (`backend/src/modules/remix/remix-fx-v1.parity.json`) holds both
      implementations to the same numbers.
    - With no effects, the render graph is byte-identical to before.
  - **Speed is varispeed.** Pitch follows speed, which is the authentic
    "slowed + reverb" / "sped up" sound. Keep-pitch tempo and key shift are
    S1b (#1898).
  - **Controls.**
    - Create → Mix stems gains a **Vibe** section: one-click starters
      (Slowed + reverb, Sped up, Lo-fi, Dreamy, Club, and No effects to reset) and four
      plain-language master sliders (Speed, Space, Tone, Warmth).
    - Each stem row has an **FX** toggle for its own Space / Echo / Tone.
    - A vibe sets visible values the user can tweak.
    - Everything previews live and autosaves.
  - **Provenance.** Effects are not AI, so renders keep `stem_audio`
    grounding. `renderMetadata` and publish lineage record the recipe and
    `remix-fx-dsp/v1`.
- Structure blocks (#1899, slice S2 of epic #1896). Users can repeat, remove
  and reorder sections of the song, and fade any block in or out, to make an
  extended mix, a short edit, or a version that returns to a favourite part.
  - **Recipe.** `remix-structure/v1` is stored as `RemixProject.structure`
    (null = original order). It is an ordered list of the source grid's
    sections (1–96 blocks) with optional `fadeIn` / `fadeOut`.
    - The identity order without fades normalises to null.
    - Project reads return the structure and the derived `timeline`
      segments, so the client and server share one derivation, like
      `sectionGrid`.
  - **Masks are per block.** Stem on/off masks are indexed by timeline block,
    so toggling one copy of a repeated section doesn't change the other.
    - With no structure, blocks are the sections, so existing masks keep
      their meaning.
    - Structure edits carry their mask columns with them (repeat copies,
      remove drops, move moves) in the same PATCH.
    - The server validates mask length against the block count.
  - **Click-free joins.**
    - A 10 ms join fade applies only where the audio jumps: a
      non-consecutive section, a mid-song start, or an early end.
    - Consecutive blocks join seamlessly.
    - User fades apply to the whole mix across the block. A fade-out on the
      last block holds silence, so the reverb tail doesn't return.
  - **Same contract, two engines.**
    - The render compiles the structure per stem in source time (trim,
      concat and join fades) before the S1 effects chain, and applies the
      master fades before loudness.
    - The preview schedules one buffer source per block, so there are no
      audio copies.
    - The transport, lanes and loop run in timeline time.
    - A parity fixture
      (`backend/src/modules/remix/remix-structure-v1.parity.json`) holds both
      engines to the same timeline, join fades, gate intervals and fade
      ramps.
    - With no structure, the render graph is byte-identical.
  - **Controls.**
    - Each block header has a menu: Repeat, Remove, Move earlier, Move later,
      Fade in, Fade out. Clicking a header still loops that block.
    - Create → Mix stems adds one-click **Structure** options: Original
      length; **Extended mix** (drops the pickup, doubles the first full
      section and the last section, fades out); **Short edit** (about the
      first 60 %, fades out).
  - **Limits.** A structure can make the song at most twice as long as the
    original, up to 15 minutes.
    - The PATCH returns 400 past that.
    - The studio disables Repeat / Extended mix with the reason before the
      limit is reached.
    - A stored over-limit structure renders in the original order.
    - Renders use one ffmpeg input per block, which keeps memory bounded
      (the single-decode split held pending blocks in memory).
  - **Deferred.** Build-ups (a filter sweep plus a gain ramp) are a follow-up.
  - **Provenance.** Stays `stem_audio`. `renderMetadata` and publish lineage
    record the structure.
- API: token metadata (`GET /api/metadata/:chainId/:tokenId`) now includes
  catalog `stem_id`/`track_id`/`release_id` properties so token-keyed surfaces
  can resolve eligibility.

- API (#896/#1167, shipped behind config): `POST /remix/projects/:id/generate` —
  owner-only, re-runs eligibility before generating, requires a prompt for
  prompted modes (and strips prompts for stem mix), **screens the prompt for
  safety (#1343)** before any queue or credit debit, checks constraint bounds
  before enqueue, rejects duplicate active jobs, and returns immediately with
  `generationMetadata.status = pending`. Prompt-safety: the self-hosted
  generation path has no vendor filter, so `PromptModerationService` rejects
  unambiguous PUP-2–4 violations (illegal/malicious incl. safety-bypass,
  voice-impersonation of a real person, sexually explicit, and zero-tolerance
  minor-sexualization) with HTTP 422 `prompt_rejected` + a `remix.policy_rejected`
  event; precision-first so legitimate (even edgy) music prompts pass. Explicit `retry=true` replaces a
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
- API (#1323, backlog E export slice): `POST /remix/projects/:id/export` —
  owner-only, downloads a completed draft's final render as an attachment
  (`Content-Disposition: attachment`, sanitized filename derived from the
  project title, `.mp3`/`.wav` per the draft mime). Re-runs `checkEligibility`
  at export time (consent flips and quarantines block it) and enforces
  `allowedActions.export` on top of `allowed` (`403 export_not_allowed`
  otherwise); only completed drafts export (`409 draft_not_completed`). Export
  requires a **commercial** license on the source stems — proven server-side by
  a `StemPurchase` (`licenseType = commercial`) or listing-backed
  `X402Settlement` row matched to the caller's wallet, or by owning the source
  artist profile (#1174). Policy version bumped to `2026-07-03.v6`
  (`RemixStemPolicyInput.exportLicensed` → `allowedActions.export`). The render
  bytes reuse the existing draft-audio decrypt/read path (no new raw-URI
  surface). Emits `remix.exported` (artistId-less; carries projectId, creator,
  source, mode, grounding, aiGenerated, policy version; bridge-whitelisted for
  analytics).

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
  (attribution, stem controls, prompt gating by mode, unavailable publish and
  commercial-gated export with reasons), `describeExportAvailability` gating
  (#1323), honest grounding copy including `audio_conditioned`, and the page
  shell's signed-out/loading states.
- `backend/src/tests/remix-eligibility.policy.spec.ts` — includes v6 export
  cases (#1323): export granted for a commercial-licensed selection, withheld
  for a remix-only or partly-licensed explicit selection.
- `backend/src/tests/remix-export.integration.spec.ts` — Testcontainers
  Postgres coverage for `exportDraft` (#1323): commercial-license → 200 with a
  sanitized download filename and render bytes; remix-only → 403
  `export_not_allowed`; export-time consent-flip re-check; incomplete draft →
  409; non-owner → 403; `remix.exported` emission.

- `web/tests/remix-studio.authenticated.spec.ts` (#1879) — Playwright studio
  flow against a mocked remix API: lanes render channel stems only, a cell
  edit autosaves the arrangement PATCH, the transport plays through the real
  WebAudio engine with the level meter, a section loops and clears, and Space
  stops playback.

Remaining for later slices:

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
  user-visible. Because the inference worker scales to zero when idle, the
  first AI draft after an idle period can take about 4–5 minutes while the
  model loads; opening Remix Studio now pre-warms the worker, and subsequent
  drafts should usually return in seconds.
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

- **Attribution gate (#1342):** the [Stability AI Community
  License](https://stability.ai/license) §IV(a) requires a hosted service that
  uses the Stable Audio materials to prominently display **"Powered by Stability
  AI"**, make the license available to users, and keep the required NOTICE text
  (see the repo [`NOTICE`](../../NOTICE) file). Because the trigger is the
  *active provider*, the eligibility response carries a `generationAttribution`
  object **only while `REMIX_GENERATION_PROVIDER_KIND=audio-conditioned`** and
  generation is enabled (source of truth:
  `getActiveRemixGenerationAttribution()`); the studio renders the badge and
  Community License link in the Draft-status panel when present, and shows
  nothing for Lyria / `stem_plus_ai`, which carry no such notice. This closes
  the license-review pre-launch obligation #1 and gates flipping the provider to
  `audio-conditioned` for real users. The remaining operator obligation is
  registering with Stability AI for commercial use (§III, license review §D2) —
  no code, tracked on #1342.

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
- RFC: [Derived-Stem Separation Rights](../rfc/derived-stem-separation-rights.md)
  — policy gate for the on-demand separation slice of
  [#1311](https://github.com/akoita/resonate/issues/1311) (status: draft,
  awaiting owner sign-off; no separation code ships before acceptance)
- Backlog: [Remix Studio Backlog](remix_studio_backlog.md)
- Licensing: [Licensing Architecture](../rfc/licensing-architecture.md)
- Rights: [Rights Verification Strategy](../rfc/rights-verification-strategy.md)
- Generation: [AI Music Generation](ai_music_generation.md)
