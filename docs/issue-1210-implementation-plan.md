# Issue 1210 Implementation Plan

Status: implemented on `feat/1210-deterministic-remix-quality`.

## Goal

Turn the deterministic `stem_mix` path into the reproducible, high-fidelity
foundation shared by zero-AI stem renders and `stem_plus_ai` layered drafts.
The rendered result should preserve the user's relative stem gains while
preventing clipping and recording enough policy and arrangement data to audit
or reproduce the output.

## Current-State Findings

- `StemAudioMixer` is already shared by `stem_mix`, audio-conditioned input,
  and `stem_plus_ai` rendering.
- The current ffmpeg graph applies per-input gain and then uses
  `amix:normalize=0`; multiple loud stems can therefore clip.
- `stem_plus_ai` records `sourceArrangement`, but `stem_mix` does not yet
  persist the same full arrangement snapshot or render policy.
- Encrypted stems fail closed with a non-retryable `invalid_input`, but the
  missing decrypt-for-render capability needs dedicated durable tracking and
  clearer product documentation. Follow-up: #1214.
- The pre-existing-stem feature backfill mentioned in #1210 already ships as
  `POST /admin/stems/backfill-audio-features`; no new backfill implementation
  is needed here.

## Proposed Product Contract

1. Preserve each unmuted stem's saved relative gain.
2. Apply one centralized, versioned render policy after summing inputs:
   loudness normalization plus true-peak limiting/headroom before encoding.
3. Use the same policy for deterministic and layered final renders so adding
   an AI layer does not bypass the quality foundation.
4. Persist the complete source arrangement and exact render-policy metadata
   with every completed final render.
5. Continue failing closed for encrypted stems until an authenticated
   server-side decrypt path exists; expose an actionable, honest error.

The loudness target, true-peak ceiling, output codec, bitrate, and policy
version should be named centralized product-policy constants. They should not
vary silently by environment, because that would make identical arrangements
render differently. Any future tuning must increment the policy version.

## Implementation Slices

### 1. Versioned audio render policy

- Add a typed render-policy value beside `StemAudioMixer`.
- Update `buildStemMixFfmpegArgs` to keep per-input gain, sum the inputs, then
  apply loudness normalization and a true-peak-safe ceiling before MP3 output.
- Reuse the exact graph from `mixUnmutedStems` and `mixAudioBuffers`.
- Keep ffmpeg execution argument-array based; never interpolate stem-derived
  values into a shell command.

### 2. Reproducible render metadata

- Extend the renderer result contract with final-render metadata containing:
  policy/schema version, output codec/bitrate, loudness target, true-peak
  ceiling, input count, and active stem count.
- Have `FfmpegStemMixRenderer` return the complete source arrangement,
  including muted stems and saved gains.
- Persist the metadata in `generationMetadata` for both `stem_audio` and
  `stem_plus_ai` completion paths without changing historical draft reads.
- Keep generated-layer metadata separate from source arrangement and final
  render metadata.

### 3. Failure and deferral behavior

- Keep all-muted and missing-audio failures non-destructive and actionable.
- Normalize local-path rejection, missing local data, and storage download
  failure without leaking filesystem paths or provider internals.
- Create and link a dedicated follow-up issue for encrypted-stem
  decrypt-for-render support; #1210 will retain the fail-closed behavior.
- Confirm that local bytes, contained local files, and storage-provider
  downloads follow the same validation and render path.

### 4. Product copy and documentation

- Position deterministic stem rendering as the high-fidelity baseline in the
  Studio and Remix Studio feature docs.
- Explain that final renders use normalized headroom while retaining relative
  stem gain choices.
- Document the encrypted-stem limitation and link its follow-up issue.
- Update `docs/features/README.md`, `docs/features/remix_studio.md`, and the
  Remix Studio backlog in the same branch.

## Explicit Deferrals

- Fade, trim, loop, effect inserts, and automation controls. They expand the
  arrangement model and need their own product/API design rather than being
  smuggled into a mastering-quality slice.
- Release-grade mastering claims. This policy targets safe, predictable draft
  playback, not professional mastering.
- Encrypted-stem decryption itself; this requires a separately reviewed trust,
  key-access, and temporary-file lifecycle design.
- Section/inpaint editing (#1211).

## Validation

- Unit tests for the exact versioned ffmpeg filter graph, finite-gain fallback,
  empty input rejection, and shared policy use.
- ffmpeg smoke tests, when ffmpeg is available, for playable output and peak
  containment across representative one-, two-, and multi-input mixes.
- Renderer tests proving `sourceArrangement` and final render metadata are
  returned for deterministic and layered renders.
- Backend integration tests proving completed generation metadata persists the
  arrangement snapshot, render policy, grounding, and output metadata.
- Integration coverage for encrypted, missing, local, and storage-backed stem
  failure/deferral behavior using the real Prisma Testcontainer path.
- Frontend tests for the high-fidelity baseline and encrypted-stem error copy
  if copy changes affect rendered states.
- Focused backend and frontend lint/tests, followed by the `/finish-issue`
  security and change-impact checks before commit or PR publication.

## Change-Impact Review

- **Product/UX:** copy and error states change; no new arrangement controls.
- **API/client contract:** additive generation metadata only; legacy drafts
  remain readable.
- **Analytics/events:** existing lifecycle events remain sufficient; do not add
  high-cardinality render details to event payloads.
- **Privacy/permissions:** arrangement metadata stays owner-scoped until the
  existing publication path deliberately exposes approved provenance.
- **Deployment/configuration:** no environment-specific render tuning or new
  secret is introduced.
- **Documentation:** feature catalog, Remix Studio page, and backlog update in
  this branch.

## Implemented Result

- `remix-render-policy/v1` centralizes -14 LUFS, 11 LU LRA, -1.5 dBTP,
  stereo 48 kHz MP3 at 320 kbps.
- `stem_mix` and `stem_plus_ai` completed metadata now include the full
  `sourceArrangement` and versioned `renderMetadata`.
- `stem_plus_ai` loads the arranged stems and generated layer into one final
  ffmpeg graph, removing the former intermediate MP3 and second lossy encode.
- Missing stored audio remains a non-retryable input error; storage outages
  become retryable `provider_unavailable` errors without leaking bucket names,
  paths, signed URLs, or provider messages.
- Encrypted stems remain fail-closed with actionable copy. The authenticated
  decrypt-for-render boundary is durably tracked in #1214.
- Fade, trim, loop, effect inserts, automation, and release-grade mastering
  remain intentionally deferred.

## Verification Completed

- Backend TypeScript lint/typecheck.
- Frontend ESLint, with only pre-existing unrelated warnings.
- Renderer and layered-renderer Jest suites.
- Remix Studio Vitest suite: 48 tests.
- Testcontainers integration suites for remix metadata and stem audio loading:
  46 tests.
- Dockerized ffmpeg smoke render of an intentionally hot two-input mix;
  decoded `max_volume` measured at -13.3 dB with no clipping.
