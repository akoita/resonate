---
title: "Stable Audio 3 — Quality Spike Findings (gate 1, #1193)"
status: draft
issues:
  - "https://github.com/akoita/resonate/issues/1193"
related:
  - docs/rfc/stable-audio-3-license-review.md
  - docs/rfc/remix-audio-grounding-build-vs-buy.md
  - "https://github.com/akoita/resonate/issues/1182"
date: 2026-06-17
---

# Stable Audio 3 — Quality Spike Findings

> **Throwaway evaluation, graduated to a finding.** This is gate 1 of the
> #1193 adopt-gate (gate 2 = the [license review](stable-audio-3-license-review.md),
> already **GO**). It answers one question with real audio on a real GPU, then
> hands a resumable harness and a recommendation to whoever picks up #1182
> slices 4–5.

## Question

Can **`stabilityai/stable-audio-3-medium`**, conditioned on a real Resonate
stem, produce a draft that **stays recognizable as that stem** while applying a
**prompted change** — the capability prompt-only Lyria (#1192) fundamentally
cannot offer (it never sees the audio)? And is it cheap/fast enough to
self-host?

## TL;DR — Conditional GO

Audio conditioning **works** and is viable for **draft / idea generation** in
Remix Studio. It is **not** yet final-master quality.

- ✅ **Source identity is preserved** — at low `init_noise_level` the song is
  unmistakably recognizable (melody + tone). This proves the audio genuinely
  conditions the model; it is not prompt-only.
- ✅ **Text steering works and is controllable** — with an explicit prompt and
  raised `cfg_scale`, a requested change (e.g. an added techno kick) is audible
  **while the song stays recognizable**. The two coexist.
- ⚠️ **Fidelity is the soft spot** — even at its best the output sounds like a
  *slightly lower-quality* render of the source (instrumentation **and**
  vocals). This is the *medium* model's autoencoder ceiling; more diffusion
  steps do **not** fix it.

**Recommended default settings (from the sweep):** `steps=25`,
`cfg_scale≈7`, `init_noise_level≈0.2`. `cfg_scale=9` made the prompt louder but
**degraded the song** — 7 is the sweet spot. `cfg_scale=1` (the package default)
barely steers at all.

**Net:** adopt for *drafts*, label outputs honestly as AI drafts (not masters),
and revisit fidelity with a larger model / better autoencoder before promising
release-grade audio.

## Method

A single-purpose Cloud Run **GPU job** on `resonate-staging-499404` (region
`europe-west1`). The harness (`experiments/stable-audio-3-spike/cloud_spike.py`,
`Dockerfile`) is fully env-driven, so every tuning run after the first is a
**~5-minute, no-rebuild** `jobs update --update-env-vars` + `jobs execute`.

- **GPU:** 1× NVIDIA L4, `--no-gpu-zonal-redundancy` (jobs cannot use zonal
  redundancy), **32Gi memory** (16Gi OOM-kills while loading the T5Gemma text
  encoder).
- **Source stem:** a real uploaded original from
  `gs://resonate-stems-staging-499404/originals/`, copied into the spike-output
  bucket and passed via `STEM_GCS_URI`.
- **Knobs (all env vars):** `SPIKE_PROMPT`, `SPIKE_NOISE` (csv),
  `SPIKE_STEPS`, `SPIKE_CFG`, `SPIKE_DURATION`, `STEM_GCS_URI`.
- **Clips** delivered to the reviewer locally for blind-ish listening; scored on
  source identity, prompt adherence, musical quality, draft usability.

### Reconciled package API (real, introspected at runtime)

```text
StableAudioModel.from_pretrained(model_name, device=None, model_half=True)
model.generate(prompt, ..., steps=8, cfg_scale=1.0, seed=-1,
               init_audio: Tuple[int, torch.Tensor],   # (sample_rate, tensor)
               init_noise_level=1.0, ...)
```

- **`init_audio` is `(sample_rate, tensor)`** — the *opposite* order of
  `torchaudio.load()`'s `(tensor, sample_rate)`. Passing it the wrong way raises
  `'int' object has no attribute 'to'`.
- **`init_noise_level`** is the drift dial: **low = faithful**, **high =
  regenerate freely**. Default `1.0` ignores the init audio almost entirely.
- **`steps` defaults to 8** — a turbo/distilled setting tuned for speed, not
  fidelity.

## Results (the listening ladder)

| Run | Settings | Identity | Prompt change | Notes |
| --- | --- | --- | --- | --- |
| Low-noise sweep | `noise 0.05–0.30`, `steps 8` | **Strong** (near-copy at 0.05–0.10) | none (faithful) | proves conditioning; near-copies aren't "remixes" |
| Step bump | `noise 0.10–0.30`, `steps 25` | strong | none (subtle prompt) | quality a little cleaner, **still a lower-fi render** |
| Subtle prompt | "darker halftime", `cfg 1` | strong | **not audible** | weak prompt + default cfg → no steering |
| Obvious prompt | "techno kick", `cfg 5` | yes | **audible but weak** | change + identity coexist |
| Obvious prompt | "techno kick", `cfg 7` | yes | **stronger, song intact** | ← **sweet spot** |
| Obvious prompt | "techno kick", `cfg 9` | yes | strong | **song quality degrades** vs cfg 7 |

The decisive transition: the change and the identity **only coexist with an
explicit prompt at `cfg 5–7`**. The earlier "no audible change" was a
weak-prompt / default-cfg artifact, not a model limit.

## Engineering / deployment profile

| Metric | Value |
| --- | --- |
| GPU | NVIDIA L4 (fits T4 / consumer GPUs too) |
| Peak VRAM | **5.45 GB** |
| Cold model load | **~237–246 s** (download + T5Gemma + DiT + autoencoder) |
| Gen latency, 30 s clip | ~1.4 s @ 8 steps, **~3.3 s @ 25 steps** |
| Output | 44.1 kHz |

**Deployment shape:** the cost is the **~4-minute cold load**, not inference.
A production provider needs a **warm / min-instance GPU service** (like Demucs),
not per-request cold jobs. VRAM is tiny → cheap GPUs and room to batch.

## What can be improved (resume here)

Ordered by expected payoff for the open weakness (fidelity):

1. **Larger / higher-fidelity model.** The fidelity ceiling is the *medium*
   autoencoder. The single biggest lever is a bigger Stable Audio model (or a
   better audio autoencoder) — re-run the same harness against it. This is the
   gate to "release-grade", not just "draft-grade".
2. **Fix the mono output confound.** Real-stem outputs came back **mono**
   (synthetic ones were stereo); a thinner mono render unfairly hurt the quality
   read. Investigate the output-channel handling / `chunked_decode` / stereo
   path before re-judging fidelity — this alone may move the needle.
3. **Per-use-case CFG/noise presets.** "Subtle variation" vs "bold remix" want
   different `init_noise_level` + `cfg_scale`. Map a small preset grid and
   expose it as Studio modes rather than raw sliders.
4. **Negative prompts & `apg_scale`.** Untested. `negative_prompt` could
   suppress artifacts; `apg_scale` is an alternate guidance knob that may steer
   cleaner than raw CFG.
5. **Inpaint mode.** `generate()` exposes `inpaint_audio` / `inpaint_mask*` —
   region-locked edits (keep the verse, regenerate the drop) could be a stronger
   product fit than whole-clip conditioning. Entirely unexplored.
6. **Real stem variety + longer clips.** One full-mix stem was tested; sparse
   single-instrument stems likely reconstruct cleaner. Test the spread and
   durations beyond 30 s.

## Recommendation for #1182 slices 4–5

- **Adopt as a draft-generation provider**, gated behind the existing provider
  boundary, with outputs **labeled AI drafts** (extends the #1181 grounding
  labels — add an `audio_conditioned` grounding kind alongside
  `feature_conditioned` / `prompt_only`).
- **Do not** retire feature-conditioned Lyria (#1192) or stem-mix renders
  (#1189); audio conditioning is an *additional* mode, strongest where a creator
  wants "my track, but changed."
- **Defer the release-grade claim** until improvement #1 (larger model) and #2
  (stereo fix) are done.
- Honor the gate-2 pre-launch obligation: Gemma/T5Gemma acceptable-use
  flow-down before any production exposure.

## Reproduce / resume

The harness lives in `experiments/stable-audio-3-spike/` and is committed for
exactly this. One tuning run:

```bash
gcloud beta run jobs update stable-audio-spike \
  --project=resonate-staging-499404 --region=europe-west1 \
  --update-env-vars="^@^SPIKE_PROMPT=<prompt>@SPIKE_NOISE=0.15,0.2,0.3@SPIKE_STEPS=25@SPIKE_CFG=7"
gcloud beta run jobs execute stable-audio-spike --wait \
  --project=resonate-staging-499404 --region=europe-west1
# outputs -> gs://resonate-staging-499404-spike-out/<execution>/
```

First-time infra setup (image, `hf-token` secret, 32Gi job, bucket grants) is in
the directory README. The HF account must have **accepted the gated model
license** and the `hf-token` secret must hold a **valid, current** token.

### Teardown / hygiene (owed)

- The job bills only on execution, so it can be left in place for easy resume;
  the image + bucket are negligible storage.
- **Rotate the HF token** used during the spike (it was handled in plaintext)
  and refresh the `hf-token` secret if the job is kept.
- Spike output clips (`spike_outputs/`) are throwaway and are git-ignored.
