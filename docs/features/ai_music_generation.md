---
title: "AI Music Generation"
status: implemented
owner: "@akoita"
---

# AI Music Generation

## Status

`implemented`

## Audience

Artists use this to generate Lyria-backed tracks from prompts, publish them to
their library, send them into Demucs processing, and inspect the resulting
release in the catalog. Developers and agents use the generation API as the
durable system-of-record for generated-track provenance.

## Value

Resonate creates the audio, stores the generated track metadata, and records
system provenance for the resulting release. AI-generated releases do not ask
the artist to submit manual proof-of-control evidence for marketplace rights:
the platform already knows the generation provider, prompt, job, timestamp, and
track origin.

AI-generated-work financial policy remains separate from creator
proof-of-control. The current implementation grants standard-escrow marketplace
access from system provenance, while future policy work can add dedicated
payout or licensing rules for AI works.

## How To Use

- UI: `/create`
- Generate a track from a prompt and duration.
- Use "Save to Library" to publish metadata and save the track.
- Use "Send to Demucs" to publish metadata and start stem processing.
- Open the release page to inspect rights status, provenance, stems, and
  marketplace readiness.

## Surfaces

- `POST /generation/create`
- `GET /generation/:jobId/status`
- `GET /generation/mine`
- `PATCH /generation/:trackId/publish`
- `Release.type = "ai_generated"`
- `Track.generationMetadata`
- System rights provenance:
  - `Release.rightsSourceType = "ai_generation"`
  - approved `ReleaseRightsUpgradeRequest` from `system:ai-generation`
  - `RightsEvidence.kind = "rights_metadata"`
  - `RightsEvidence.verificationStatus = "system_generated"`

## Verification

- Backend: `cd backend && npm run test -- generation.error_normalization.spec.ts generation.controller.spec.ts`
- Integration: `cd backend && npm run test:integration -- generation.integration.spec.ts`
- Frontend: `cd web && npm run test:unit -- rightsOnboarding.test.ts`
