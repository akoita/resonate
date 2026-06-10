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
([#896](https://github.com/akoita/resonate/issues/896)) with a config-gated
stub provider (`REMIX_GENERATION_ENABLED`, default off) — generation is not
user-visible yet. The first real provider with a studio Generate button
(backlog D2), queue-backed jobs (D3), and audio preview (C3) remain planned;
the MVP epic is [#891](https://github.com/akoita/resonate/issues/891).

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
  `source_not_opted_in`, `stem_not_remixable`, `license_required`),
  `policyVersion`, per-stem remixability/license state. Designed for the three
  CTA states: enabled, license required, disabled with reason.
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
- Events: `remix.project_created`, `remix.policy_rejected`,
  `remix.license_required` (governed analytics bridge mappings included).
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
  prompt for signed-out users.
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

## Planned Surfaces

- UI: marketplace listing card remix affordances beyond the existing
  `Remixable` badge (deliberately excluded from #894 to avoid per-card
  eligibility fan-out).
- UI: Web Audio stem preview in the studio (backlog C3).
- UI: studio Generate button — ships with the first real provider (backlog
  D2) so the action never appears before it can work.
- API: `POST /remix/projects/:id/publish`.
- API: `POST /remix/projects/:id/export`.
- Events: `remix.generation_completed` (with queued jobs, backlog D3),
  `remix.published`.

## Product Rules

- Source release must not be blocked or quarantined.
- Source route must allow marketplace/licensing use.
- Artist or rightsholder must opt in to remix creation.
- User must own or purchase a valid remix license before AI generation.
- AI-generated derivatives follow the same royalty obligations as human remixes.
- Draft, publish, export, and monetize are separate rights.
- Artist voice/likeness is disabled until explicit consent exists.
- Public remixer/contributor credentials require publication, rights-safe
  attribution, and explicit profile/verifier display consent.

## Verification

Implemented today:

- `backend/src/tests/remix-eligibility.policy.spec.ts` — pure policy unit
  tests for blocked, quarantined, dmca-removed, limited-monitoring, unknown,
  standard, trusted, opt-out, non-remixable-mint, missing-license, and
  already-licensed cases (`npm run test`).
- `backend/src/tests/remix.integration.spec.ts` — Testcontainers Postgres
  coverage for eligibility against real rights/mint/purchase/x402 rows,
  durable project create/read/update, restart durability, ownership
  enforcement, and policy denial events (`npm run test:integration`).
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

- Playwright test for the studio happy path (once audio preview/C3 gives it
  observable behavior worth driving end to end);
- provider-failure tests for normalized generation errors (#896).

## References

- RFC: [Remix Studio](../rfc/remix-studio.md)
- RFC: [AI Derivative Rights Policy](../rfc/ai-derivative-rights-policy.md)
- RFC: [Remix And Contributor Credential Boundaries](../rfc/remix-contributor-credential-boundaries.md)
- Backlog: [Remix Studio Backlog](remix_studio_backlog.md)
- Licensing: [Licensing Architecture](../rfc/licensing-architecture.md)
- Rights: [Rights Verification Strategy](../rfc/rights-verification-strategy.md)
- Generation: [AI Music Generation](ai_music_generation.md)
