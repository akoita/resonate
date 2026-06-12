---
title: "Build vs Buy: Stem-Grounded Remix Generation"
status: draft
issues:
  - "https://github.com/akoita/resonate/issues/1182"
related:
  - "https://github.com/akoita/resonate/issues/1181"
  - docs/features/remix_studio.md
date: 2026-06-12
---

# Build vs Buy: Stem-Grounded Remix Generation

## Why this study

Remix Studio generation (D2 #1162 + D3 #1167) is prompt-only: the licensed
stem audio never reaches the model. The stems gate *rights*, not *sound* —
"add piano to the stem" produces a track unrelated to the stem. #1181 fixes
the labeling; #1182 asks how to make the stems actually shape the output.

This study evaluates whether to build custom audio processing or adopt an
existing tool/service, per capability. The answer is different for each of
the three capabilities involved, so they are evaluated separately:

1. **Audio analysis** — extract BPM, key, chords, structure from stems
2. **Grounded generation** — produce new audio conditioned on the stems
3. **Rendering/mixing** — combine stems and generated layers into one file

Verification level: vendor claims below come from public docs/announcements
as of 2026-06-12 and have **not** been validated hands-on yet. Each adopt
recommendation includes a validation spike before commitment.

## 1. Audio analysis (BPM / key / chords / structure)

### Buy candidates

| Service | What it offers | Concerns |
| --- | --- | --- |
| [Cyanite.ai](https://api-docs.cyanite.ai/docs/audio-analysis-v6-classifier/) | BPM, key, mood, genre classifiers via API | Per-track cost; sends licensed audio to a third party |
| [klang.io](https://klang.io/api/) | Beat/downbeat timing, BPM, meter, chord progressions | Same third-party-audio concern |
| [Soundcharts Audio Features API](https://soundcharts.com/en/audio-features-api) | BPM, key, time signature, mood | Catalog-oriented; same concern |

### Build option

`librosa` (or `essentia`) inside the existing demucs worker
(`workers/demucs/`, already a Python/torch service that holds the stem
audio): tempo, key/chroma, onset and beat grids, spectral features. Chord
estimation is achievable with chroma + template matching or `madmom`-class
models. No new infrastructure, no audio leaves our boundary.

### Verdict: **build** (commodity)

BPM/key/beat-grid extraction is solved, library-grade functionality. We
already operate the right service for it, the marginal cost is zero, and
keeping licensed audio inside our storage boundary is a real advantage for a
rights-first platform. Paid analysis APIs make sense for catalogs you do not
host; we host the stems.

## 2. Grounded generation (the core decision)

### Option 2a — Stable Audio 3 (Stability AI), self-hosted — **frontrunner**

[Announced 2026-05-20](https://stability.ai/news-updates/meet-stable-audio-3-the-model-family-built-for-artistic-experimentation-with-open-weight-models):
open-weight Small/Medium variants on
[Hugging Face](https://huggingface.co/stabilityai/stable-audio-3-medium),
with the capabilities prompt-only Lyria lacks:

- **audio input**: inpainting and "continuation of short recordings";
  coverage reports audio-to-audio / style transfer with a reference track
  ([review](https://chatforest.com/reviews/stability-ai-stable-audio-3-open-weight-music-sfx-generation/),
  [the-decoder](https://the-decoder.com/stability-ai-launches-stable-audio-3-0-with-up-to-six-minute-tracks-and-open-weights/))
  — exactly the variation/extension semantics Remix Studio promises;
- **fully licensed training data** (AudioSparx licensed + Freesound CC,
  third-party-verified removal of copyrighted material) — directly aligned
  with the AI Music Integrity positioning (#1164) in a way Suno/Udio
  (active training-data lawsuits) can never be;
- **fast**: sub-2s generation on an H200, "a few seconds" on an M4 laptop;
  Medium needs a CUDA GPU (8GB+ VRAM baseline, Flash Attention 2) — the
  same class of hardware as the demucs GPU variant we already have a
  Dockerfile for (`workers/demucs/Dockerfile.gpu`).

**Critical gate — license**: outputs are owned/commercializable under the
Stability AI Community License, but **self-hosting for commercial
applications requires a separate license agreement with Stability AI**, and
organizations over $1M annual revenue need enterprise licensing
([Stability license](https://stability.ai/license),
[byteiota guide](https://byteiota.com/stable-audio-3-developer-guide/)).
The T5Gemma text encoder also carries Gemma Terms of Use. Legal review of
both is a hard prerequisite — cost unknown until we ask.

### Option 2b — Hosted generation APIs with audio upload (Suno, Udio)

[Suno](https://suno.com/) accepts uploaded audio (6–60s clips) to extend or
cover. Disqualifying for our use case:

- **rights regime is hostile to a marketplace**: under the current terms
  Suno remains the "author" and grants users a license; remixes of other
  users' outputs are restricted to personal, non-commercial use
  ([terms analysis](https://medium.com/@J.S.Matkowski/suno-music-in-2026-what-creators-actually-own-what-they-only-license-and-why-the-lawsuits-still-7f7c3c455c0e),
  [commercial-rights guide](https://dynamoi.com/learn/ai-music-distribution/suno-commercial-rights-explained)).
  Resonate's product *is* commercial remix licensing — we cannot build it
  on outputs we do not control;
- no official public developer API — the widely used endpoints are
  third-party wrappers ([example](https://docs.sunoapi.org/)), an
  unacceptable supply-chain and ToS risk;
- uploading artists' licensed stems to a vendor fighting training-data
  lawsuits is a trust own-goal, and Suno blocks copyrighted uploads anyway.

### Option 2c — Stay on Vertex AI Lyria

Lyria 3 / Lyria 3 Pro accept text plus **images/PDFs** as references — still
no audio input
([Vertex docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/music/overview),
[Lyria 3 Pro prompting guide](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-lyria-3-pro)).
Until Google ships audio conditioning, Lyria can only ever be
feature-conditioned via prompt text (#1182 option A). Keep it as the
prompt-only provider; re-evaluate when audio input lands.

### Option 2d — MusicGen-melody (Meta), self-hosted

Accepts a melody/audio reference. Rejected: weights are **CC-BY-NC**
(non-commercial), the model is a 2023 generation behind Stable Audio 3 in
quality, and its training-data provenance is weaker than Stability's
licensed-data story.

### Verdict: **buy/adopt — Stable Audio 3 Medium, self-hosted, behind the existing provider boundary**

`REMIX_GENERATION_PROVIDER_KIND` was built for exactly this swap. A new
`stable-audio` provider kind plugs into the same queue, metadata, and error
contract shipped in #1167. Gated on:

1. **Validation spike**: run Medium on a GPU instance against real stems —
   confirm the audio-conditioning quality matches the marketing before any
   license conversation (1–2 days, throwaway code).
2. **License review**: Stability self-hosting/enterprise terms + Gemma
   encoder terms.

If either gate fails, the fallback is option A (feature-conditioned prompts
into Lyria) + the rendering pipeline below, which together already deliver
an honest, stem-containing remix — just without AI-generated *derivation*.

## 3. Rendering / mixing (stems + generated layers → draft file)

Gain staging, mute, mixdown, loudness normalization, encode: this is
`ffmpeg` (or Spotify's `pedalboard` for filter chains) — decades-old
commodity DSP, no vendor adds value here. A render worker also makes
`stem_mix` mode real **with zero AI involvement** and produces the artifact
publish/export (backlog E/F) needs.

### Verdict: **build** (commodity)

## Recommended path (updates #1182 sequencing)

| Step | What | Build/Buy |
| --- | --- | --- |
| 1 | Feature extraction in demucs worker (BPM/key/beats per stem, persisted) | Build |
| 2 | Render worker: mix arranged stems → draft file (`stem_mix` becomes real; E/F artifact) | Build |
| 3 | Inject extracted features into Lyria prompts (interim honesty upgrade) | Build (small) |
| 4 | Stable Audio 3 spike: quality validation on real stems + license review | Adopt-gate |
| 5 | `stable-audio` provider kind: audio-conditioned variation/extension, plus AI complementary layers blended in the render | Adopt |

Steps 1–3 are unconditional — they are needed under every generation
outcome and carry no licensing risk. Step 5 is the only "buy" commitment,
and it is reversible behind the provider boundary.

## Sources

- [Stability AI — Stable Audio 3 announcement](https://stability.ai/news-updates/meet-stable-audio-3-the-model-family-built-for-artistic-experimentation-with-open-weight-models)
- [Hugging Face — stable-audio-3-medium model card](https://huggingface.co/stabilityai/stable-audio-3-medium)
- [byteiota — Stable Audio 3 developer guide](https://byteiota.com/stable-audio-3-developer-guide/)
- [the-decoder — Stable Audio 3 launch coverage](https://the-decoder.com/stability-ai-launches-stable-audio-3-0-with-up-to-six-minute-tracks-and-open-weights/)
- [Google Cloud — Lyria overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/music/overview) and [Lyria 3 Pro prompting guide](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-lyria-3-pro)
- [Suno terms analysis (Matkowski, 2026)](https://medium.com/@J.S.Matkowski/suno-music-in-2026-what-creators-actually-own-what-they-only-license-and-why-the-lawsuits-still-7f7c3c455c0e) and [Dynamoi commercial-rights guide](https://dynamoi.com/learn/ai-music-distribution/suno-commercial-rights-explained)
- [Cyanite.ai API docs](https://api-docs.cyanite.ai/docs/audio-analysis-v6-classifier/), [klang.io API](https://klang.io/api/), [Soundcharts Audio Features API](https://soundcharts.com/en/audio-features-api)
