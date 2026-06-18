# Issue 1207 Implementation Plan

## Goal

Wire the `audio_conditioned` grounding kind through Remix Studio so Stable
Audio 3 drafts are labeled honestly as AI drafts conditioned on stem audio.

## Scope

- Backend grounding selection recognizes prompted generation with
  `REMIX_GENERATION_PROVIDER_KIND=audio-conditioned` as `audio_conditioned`.
- Grounding validation accepts `audio_conditioned`.
- Generation started/completed/failed domain events carry `grounding` and
  `aiGenerated`.
- Published remix metadata keeps `aiGenerated=true` for `audio_conditioned`.
- Remix Studio and release-page copy label `audio_conditioned` as conditioned on
  stem audio, AI-generated, and draft-quality.
- Feature docs and catalog mention the partial/default-off audio-conditioned
  surface.

## Validation

- Backend unit/integration coverage for grounding selection, generation events,
  and publish `aiGenerated` behavior.
- Frontend Vitest coverage for `groundingDescription`.
- Run targeted backend and frontend tests plus type checks where practical.

## Explicit Deferrals

- Enabling the provider in shared environments and IaC remains outside this PR.
- Release-grade/master-quality claims remain blocked on fidelity follow-ups.
- Stem+AI layered drafts are tracked separately in #1209.
