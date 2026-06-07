---
title: "Remix Studio"
status: planned
owner: "@akoita"
---

# Remix Studio

## Status

`planned`

Remix Studio is designed but not yet implemented. The current backend has a
small in-memory remix module for early event flow experiments; it is not a
durable product surface.

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

## Planned Surfaces

- UI: release detail remix CTA.
- UI: stem card or marketplace listing remix CTA.
- UI: `/remix/studio/:projectId`.
- API: `GET /remix/eligibility`.
- API: `POST /remix/projects`.
- API: `GET /remix/projects/:id`.
- API: `PATCH /remix/projects/:id`.
- API: `POST /remix/projects/:id/generate`.
- API: `POST /remix/projects/:id/publish`.
- API: `POST /remix/projects/:id/export`.
- Events: `remix.project_created`, `remix.generation_started`,
  `remix.generation_completed`, `remix.published`, `remix.policy_rejected`.

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

When implemented, verification should include:

- backend unit tests for eligibility policy;
- integration tests for project creation and generation state;
- rights-route tests for blocked/quarantined/limited sources;
- frontend tests for disabled/enabled remix CTAs;
- Playwright test for the studio happy path;
- event-ledger tests for remix lifecycle events;
- provider-failure tests for normalized generation errors.

## References

- RFC: [Remix Studio](../rfc/remix-studio.md)
- RFC: [AI Derivative Rights Policy](../rfc/ai-derivative-rights-policy.md)
- RFC: [Remix And Contributor Credential Boundaries](../rfc/remix-contributor-credential-boundaries.md)
- Backlog: [Remix Studio Backlog](remix_studio_backlog.md)
- Licensing: [Licensing Architecture](../rfc/licensing-architecture.md)
- Rights: [Rights Verification Strategy](../rfc/rights-verification-strategy.md)
- Generation: [AI Music Generation](ai_music_generation.md)
