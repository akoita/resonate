---
title: "Implementation Plan: Remix Studio Audio Preview"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/1165"
related:
  - docs/features/remix_studio.md
  - docs/features/remix_studio_backlog.md
  - docs/issue-1145-implementation-plan.md
---

# Implementation Plan: #1165 Remix Studio Audio Preview

Branch: `feat/1165-studio-audio-preview`

Backlog C3 makes Remix Studio audible without changing the rights boundary:
users can preview their source-stem arrangement and, when generation metadata
contains an output URI, stream the private AI draft from the owner-scoped
project endpoint. There is still no download/export path in this slice.

## Slice 1 - Backend draft-audio stream

Add an owner-scoped endpoint:

- `GET /remix/projects/:id/draft-audio`
- JWT required, same ownership rule as `GET /remix/projects/:id`
- returns 404 when the project has no generated output URI
- streams the stored draft via the existing storage provider abstraction
- never exposes the raw storage URI in the response body

Implementation notes:

- Parse `generationMetadata.output.outputUri` defensively; unknown metadata
  shape should produce 404, not a server error.
- Keep the endpoint focused on generated draft playback only. Source stem
  previews continue to use the public preview endpoint:
  `GET /catalog/stems/:id/preview`.
- Set an audio content type when the storage provider does not already provide
  one; do not add a download disposition.

## Slice 2 - Web API helpers and typed generation metadata

Extend `web/src/lib/api.ts` with:

- a narrow `RemixGenerationMetadata` shape for the output URI/status fields the
  studio needs;
- `getRemixDraftAudioBlob(token, projectId)` using authenticated `fetch` and
  returning a `Blob`;
- no new environment variables; source stem previews continue to use
  `stemPreviewUrl(stemId)` from the canonical `API_BASE`.

## Slice 3 - Studio stem arrangement preview

Add a small client-only preview engine for `RemixStudioEditor`:

- play/stop transport in the Stems panel;
- fetch each project stem from `stemPreviewUrl(stemId)`;
- decode through `AudioContext`;
- route every source through a `GainNode`, applying persisted gain
  (`dB -> linear`), mute, and preview-only solo live while editing;
- clean up buffers, nodes, object URLs, and the audio context when stopped or
  when the component unmounts.

UX rules:

- The controls must make clear this is preview playback, not export.
- Muting and gain are still persisted only through Save.
- Solo remains preview-only and should stop being described as future-only once
  audio preview exists.
- Failed source preview fetches should show a recoverable toast/state and stop
  transport cleanly.

## Slice 4 - AI draft playback

Update the Draft status panel:

- when `generationMetadata.output.outputUri` exists, show a play/stop control
  for the generated draft;
- fetch the audio through `GET /remix/projects/:id/draft-audio` with the JWT,
  create a blob URL, and play it through an `<audio>` element or the shared
  preview utility;
- revoke blob URLs on replacement/unmount;
- show 404/no-draft and provider/storage failures as playback errors, not as
  generation errors.

The existing Generate/Regenerate behavior stays unchanged.

## Slice 5 - Tests

Backend:

- HTTP contract: route requires auth; non-owner gets 403; no draft returns
  404; owned project with output URI streams without exposing the URI.
- Service/unit coverage for defensive metadata parsing if the parsing helper is
  extracted.

Web:

- Pure helper tests for `dbToLinearGain`, generation metadata output parsing,
  and preview availability copy.
- Component tests for visible stem preview controls, AI draft playback controls,
  unavailable/no-draft states, and cleanup paths where practical.
- Mock `AudioContext`, `fetch`, `URL.createObjectURL`, and
  `URL.revokeObjectURL` in the Remix Studio test file.

## Docs

- `docs/features/remix_studio.md`: mark C3 shipped, document the
  owner-scoped draft stream endpoint, and replace "Playback arrives with audio
  preview" language.
- `docs/features/remix_studio_backlog.md`: mark C3 shipped and keep D3,
  publish/export, artist opt-in, and waveform/timeline editing out of scope.

## Commit plan

1. `feat(#1165): stream generated remix draft audio for project owners`
2. `feat(#1165): add studio stem arrangement preview playback`
3. `feat(#1165): add generated draft playback controls`
4. `docs(#1165): document Remix Studio audio preview`

## Verification

- Backend: `npm run lint`, remix HTTP/integration tests that cover the new
  endpoint.
- Web: `npx vitest run src/components/remix`, targeted API helper tests,
  eslint on changed files, `npm run build`.
- Manual: create/open a remix project, play a source stem arrangement, adjust
  gain/mute/solo during playback, generate or seed draft metadata, play the AI
  draft, and confirm no download/export affordance appears.
- Security scan: secrets/raw-SQL/hardcoded URL greps and `git diff --check`;
  append findings or "no findings" to `audit/security_best_practices_report.md`.
