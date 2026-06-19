# Issue 1209 Implementation Plan

## Goal

Make the primary AI-assisted Remix Studio path preserve the user's licensed,
arranged stems as the audible backbone while adding one or more AI-generated
layers on top.

## Product Contract

- The final draft contains the original arranged source stems.
- AI output is additive layer audio, not a regenerated replacement mix.
- Provenance distinguishes licensed source-stem audio from generated layers.
- Because generated layers are present, the final draft remains AI-labeled.
- Stable Audio 3 full regeneration from #1206/#1207 stays experimental and
  draft-quality; this slice should become the stronger product promise.

## Architecture Fit

Existing pieces to reuse:

- `StemAudioMixer` already loads and ffmpeg-mixes the project's unmuted stems
  with saved gain/mute state.
- `FfmpegStemMixRenderer` already uploads a final draft rendered from arranged
  stems.
- `RemixGenerationProvider` already normalizes provider errors and returns
  output metadata through the queue lifecycle.
- `RemixGenerationInput` already carries project arrangement, source feature
  hints, prompt, constraints, and rights provenance.

Likely new pieces:

- A layer-generation provider contract or provider result shape that can return
  generated layer metadata separately from the final draft output.
- A layered renderer that mixes arranged stems plus generated layer audio into
  one stored draft.
- A new grounding/provenance value such as `stem_plus_ai` for final drafts.

## Proposed Scope

1. Extend backend generation metadata to represent layered drafts:
   - `grounding: "stem_plus_ai"` or equivalent;
   - source arrangement snapshot: source stem IDs, gain/mute state, and feature
     hints used;
   - generated layer records: provider, prompt, constraints, job ID, output URI,
     MIME type, seed/sample rate when available;
   - final render output metadata.
2. Add a server-side layered generation path for variation/extension jobs:
   - generate additive layer audio from prompt + feature hints;
   - mix arranged source stems + generated layers with ffmpeg;
   - store the final draft through the existing queue lifecycle.
3. Keep provider failures normalized through existing
   `RemixGenerationProviderError` codes.
4. Update UI/product copy:
   - "your stems plus AI-generated layers";
   - not "the model regenerated your source";
   - disclose AI because layers are generated.
5. Update docs and feature catalog to describe this as the primary AI-assisted
   remix path, with audio-conditioned full regeneration remaining experimental.

## Suggested Slice Boundary

Keep the first implementation pragmatic:

- Generate exactly one additive layer per job.
- Use the existing configured AI provider if it can return audio, or add a
  small provider adapter that produces one layer artifact before the final mix.
- Do not add section/inpaint editing yet.
- Do not claim release-grade mastering.

## Validation

- Backend integration test: variation/extension job records `stem_plus_ai`
  metadata, generated layer metadata, final output metadata, and generation
  events.
- Backend failure test: layer-generation failure maps to existing normalized
  provider error events.
- Renderer/mixer unit or integration coverage: final layered draft contains the
  arranged stems plus layer input and does not replace the source mix.
- Publish integration test: published remix provenance preserves
  `stem_plus_ai`, source lineage, generated layer metadata, and
  `aiGenerated=true`.
- Frontend Vitest: Studio and release-page copy label layered drafts honestly.

## Explicit Deferrals

- Multiple simultaneous layers and layer-level controls.
- Section/inpaint editing (#1211).
- Release-grade mastering/loudness normalization.
- Shared-environment enablement and IaC changes unless this PR adds new runtime
  configuration.
