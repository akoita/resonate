---
title: "Remix Studio Backlog"
status: in-progress
owner: "@akoita"
---

# Remix Studio Backlog

## Goal

Deliver a rights-aware, AI-assisted remix workflow that demonstrates Resonate's
core differentiation: licensed creation, attribution, payment, and provenance in
one product surface.

Remix and contributor credentials are scoped in
[Remix And Contributor Credential Boundaries](../rfc/remix-contributor-credential-boundaries.md).
The first credential path is off-chain, publication-scoped attribution proof
after Remix Studio/catalog publication and rights approval; License NFT /
lineage integration comes later, and a standalone community-only contributor
token is explicitly out of scope.

## Workstream A: Product And Policy Foundation

### A1. Define artist opt-in settings

- Add source policy fields for remix eligibility.
- Support disabled, manual approval, and allowed-with-license states.
- Keep voice/likeness consent separate from stem remix consent.

Acceptance:

- Backend can answer whether a track or stem is artist-opted-in for remixing.
- Default policy is conservative and does not silently enable remixing for all
  uploads.

### A2. Implement remix eligibility service — shipped (#892)

- Check source rights route.
- Check source content status.
- Check `StemNftMint.remixable` when present.
- Check artist/source opt-in.
- Check user license or purchase state.
- Return explainable allow/deny reasons.

Acceptance:

- `GET /remix/eligibility` returns `allowed`, required license, allowed actions,
  and user-facing denial reasons.
- Unit tests cover blocked, quarantined, limited, standard, and trusted routes.

### A3. Define AI derivative policy versioning — partially shipped (#892/#893)

`REMIX_POLICY_VERSION` exists; eligibility responses, remix policy events, and
`RemixProject.policyVersion` record it. Generation metadata recording remains
for workstream D.

- Add policy version constant.
- Include policy version in generation metadata and remix events.
- Record policy context before provider execution.

Acceptance:

- Every generated remix draft can be traced to the policy version used when it
  was created.

## Workstream B: Durable Remix Projects

### B1. Replace in-memory remix records with Prisma models — shipped (#893)

- Add `RemixProject`.
- Add `RemixProjectStem`.
- Link projects to source track, source stems, creator, license/purchase, and
  generation job metadata.

Acceptance:

- Remix projects survive backend restarts.
- Tests prove project creation, retrieval, and edit persistence.

### B2. Add remix project API — shipped (#893)

- `POST /remix/projects`.
- `GET /remix/projects/:id`.
- `PATCH /remix/projects/:id`.
- Authenticated user ownership checks.

Acceptance:

- A user can create and edit a private remix project for an eligible source.
- Users cannot read or edit another user's private project.

### B3. Add remix lifecycle events — partially shipped (#892/#893)

- Emit `remix.project_created`.
- Emit `remix.policy_rejected` for blocked attempts.
- Extend event taxonomy and analytics ingestion.

Acceptance:

- Events are typed and covered by tests.
- Analytics can measure remix CTA -> project conversion.

## Workstream C: Remix Studio Frontend

### C1. Add release and stem Remix CTAs — shipped (#894)

- Show CTA only when eligibility endpoint returns a supported path.
- If license is missing, route to remix license purchase.
- If blocked, show concise reason in disabled state.

Acceptance:

- Release page and stem/listing surfaces show correct CTA states.
- Frontend tests cover allowed, license-required, and blocked states.

### C2. Build `/remix/studio/:projectId` — shipped (#895)

Solo is preview-only local state until the audio preview foundation (C3)
exists; mute and gain persist through the project API.

- Source track header.
- Rights and attribution badge.
- Stem list with mute, solo, and gain controls.
- Remix mode selector.
- Prompt box for AI variation/extension.
- Draft status panel.

Acceptance:

- A user can open a project, adjust stem settings, and persist edits.
- Layout works on desktop and mobile without overlapping controls.

### C3. Add audio preview foundation — shipped (#1165)

- Reuses existing public stem preview endpoints for source-stem arrangement
  playback.
- Adds Web Audio based stem gain/mute/solo preview in the studio.
- Adds owner-scoped generated draft playback through
  `GET /remix/projects/:id/draft-audio`.
- Keeps full-quality download gated by license/export policy.

Acceptance:

- Users can preview the source stem arrangement in the studio.
- Preview does not grant unauthorized export/download rights.

## Workstream D: AI Remix Generation

### D1. Add `RemixGenerationProvider` interface — shipped (#896)

Stub provider bound by default, gated by `REMIX_GENERATION_ENABLED`; D2/D3
add the first real provider and queue-backed jobs.

- Abstract provider calls behind a backend service.
- Include source IDs, policy context, license info, prompt, and constraints.
- Return provider job ID and cost metadata.

Acceptance:

- Remix Studio is not coupled directly to a single AI provider.
- Provider calls are mockable in unit and integration tests.

### D2. Add first AI draft provider — shipped (#1162)

Lyria-backed provider (`LyriaRemixGenerationProvider`) selected via
`REMIX_GENERATION_PROVIDER_KIND=lyria`, prompt-based variation/extension
only (stem_mix needs audio conditioning — deferred), synchronous in D2 with
output stored through the storage provider; studio Generate button included.

- Reuse the existing generation stack where appropriate.
- Support prompt-based variation or extension as the first shippable mode.
- Store provider, prompt, job, cost, and output metadata.

Acceptance:

- A user can generate an AI-assisted draft from an eligible remix project.
- Provider errors are normalized and visible in project state.

### D3. Queue remix generation jobs — shipped (#1167)

- BullMQ-backed background processing for remix draft generation.
- `POST /remix/projects/:id/generate` validates/rate-limits/claims a pending
  job and returns immediately.
- Worker emits generation started/completed/failed lifecycle events and records
  terminal `generationMetadata.status`.
- Duplicate active jobs for the same project are blocked by a conditional
  project update. Explicit `retry=true` replaces completed/failed jobs;
  legacy `force=true` is accepted only as a compatibility alias.

Acceptance:

- Long-running generation does not block the request/response path.
- Retry behavior is explicit and tested.

## Workstream E: Publish, Lineage, And Receipts

### E1. Save generated draft output

- Store output URI and metadata.
- Attach attribution.
- Mark project status as `draft_ready`.

Acceptance:

- Generated output can be previewed later from the same project.
- Source lineage is visible in project data.

### E2. Publish inside Resonate

- Create a catalog derivative or remix release when allowed.
- Attach source track/stem IDs.
- Surface attribution on release detail.
- Create publication-scoped attribution proof for opted-in public
  remixer/contributor recognition.

Acceptance:

- Published remix appears in catalog with source attribution.
- Publication is blocked when license terms do not allow it.
- Public credential proof is not created for private drafts, unpublished
  projects, disputed works, or rights-blocked sources.

### E3. Prepare License NFT and ancestry integration

- Map remix project fields to future License NFT metadata.
- Map published remix source stems to `AncestryTracker`.
- Prepare recursive royalty split inputs.
- Keep contributor credential protocol work tied to License NFT / lineage
  surfaces rather than a standalone community token.

Acceptance:

- The MVP data model contains enough information to mint license/lineage records
  later without reprocessing old projects.

### E4. Extend x402/MCP surfaces for remix tier

- Support remix-tier x402 purchase and receipt flows.
- Expose remixable catalog metadata to MCP/OpenAPI.
- Make receipts include license type and source-rights context.

Acceptance:

- Agents can discover remixable stems, quote remix rights, pay, and receive a
  machine-readable proof path.

## Workstream F: Artist And Operator Controls

### F1. Artist remix settings UI

- Release-level remix opt-in.
- AI-assisted remix opt-in.
- Export policy.
- Monetization policy placeholder.

Acceptance:

- Artists can choose which releases are remixable.
- Changes affect eligibility results immediately for new projects.

### F2. Artist remix analytics

- Track remix CTA clicks.
- Track remix license purchases.
- Track generated drafts and published remixes.
- Track revenue from derivative use.

Acceptance:

- Artist dashboard can show derivative engagement and revenue.

### F3. Operator review support

- Add remix project/source context to dispute review.
- Show source rights route, license proof, provider metadata, and output URI.

Acceptance:

- Operators can audit a published remix without manual database spelunking.

## Suggested Issue Breakdown

| Priority | Issue |
| --- | --- |
| P0 | Add Remix Studio RFC and AI derivative rights policy. |
| P0 | Add remix eligibility service and policy tests. |
| P0 | Add durable RemixProject Prisma models and API. |
| P1 | Add release/stem Remix CTA and license-required flow. |
| P1 | Build Remix Studio page with stem controls and project persistence. |
| P1 | Add RemixGenerationProvider and first prompt-based draft provider. |
| P1 | Queue remix generation jobs and lifecycle events. |
| P2 | Add in-platform publish flow with attribution and lineage. |
| P2 | Extend x402/MCP to support remix-tier purchases and receipts. |
| P2 | Add artist remix settings and analytics. |
| P3 | Integrate LicenseRegistry, AncestryTracker, and recursive royalties. |
| P3 | Explore exportable licenses and off-platform publishing. |
| P3 | Explore cover and voice/likeness modes after explicit consent design. |

## Engineering Value

This backlog is a useful product and architecture track because it exercises
several areas that matter to Resonate's long-term platform:

- product strategy from live market signals;
- rights-sensitive domain modeling;
- explainable policy engines;
- event-driven lifecycle design;
- queue-backed AI job orchestration;
- provider abstraction;
- Web Audio frontend engineering;
- x402/MCP machine-commerce design;
- provenance, auditability, and analytics.
