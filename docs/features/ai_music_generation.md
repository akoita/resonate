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

## Request Validation And Ownership

Request bodies are class-validator DTOs (`generation.dto.ts`) enforced by the
backend-wide `ValidationPipe` (#1888, `backend/src/config/validation.ts`). A body
that violates a declared constraint is rejected with `400 Bad Request` before any
credit is debited or job enqueued:

- `POST /generation/create`: `prompt` required, at most 1000 characters;
  `negativePrompt` at most 500; `seed` an integer in `0..2147483647`;
  `durationSeconds` one of `30`, `60`, `120`, `180` (a JSON number, not a
  string), matching the durations the credit meter prices.
- `POST /generation/complementary`: `trackId` and `stemType` required.
- `PATCH /generation/:trackId/publish` (multipart): `title` and `artist`
  required, at most 100 characters; `genre` at most 50, `label` at most 100,
  `featuredArtists` at most 200. The `/create` UI applies matching input limits.

`artistId` on `POST /generation/create` is optional. When present it must be an
artist profile the caller owns (`hasArtistManagementAccess(..., "profile_owner")`)
or the request fails with `403` before any debit; when omitted, the job resolves
the caller's own artist profile. Internal agent flows call the service directly
and are not subject to this HTTP-boundary check.

## Realtime Generation Sessions

Interactive Lyria sessions use the Socket.IO transport and require an access
token in the connection `auth` payload. The backend derives the user identity
from the verified JWT subject and binds each opaque `rt_<UUID>` session to both
that user and the originating socket connection. Control, stop, and recording
operations are accepted only from that same connection; recorded audio is
delivered only to its owner.

Session ownership, audio buffers, and provider lifecycle state are process
local. Deployments with more than one backend instance therefore need sticky
routing for the lifetime of a realtime socket/session (or a future shared
session store and event transport).

## Verification

- Realtime ownership: `cd backend && npx jest --runInBand --no-cache src/modules/shared/events.gateway.spec.ts src/modules/generation/lyria_realtime.service.spec.ts`
- Backend: `cd backend && npm run test -- generation.error_normalization.spec.ts generation.controller.spec.ts`
- Integration: `cd backend && npm run test:integration -- generation.integration.spec.ts`
- Frontend: `cd web && npm run test:unit -- rightsOnboarding.test.ts`
