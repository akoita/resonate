# Stable Audio 3 — quality-spike runbook (#1193, gate 1)

> **Throwaway evaluation, not production.** This directory exists to answer one
> question on a GPU and then be deleted (or graduated into a real provider).
> Findings go into `docs/rfc/` per #1193; the code does not.

The license gate (gate 2) is settled in
[`docs/rfc/stable-audio-3-license-review.md`](../../docs/rfc/stable-audio-3-license-review.md)
(**GO** for a pre-revenue self-hosted adoption, two pre-launch obligations
tracked). This runbook is the other gate: does the model actually produce
**variations/extensions of a specific licensed stem**, fast enough and small
enough to self-host?

> **Gate 1 has been run — result: CONDITIONAL GO.** Findings, the recommended
> default settings (`steps=25`, `cfg_scale≈7`, `init_noise_level≈0.2`), the
> engineering profile, and the prioritized "what to improve next" list live in
> [`docs/rfc/stable-audio-3-spike-findings.md`](../../docs/rfc/stable-audio-3-spike-findings.md).
> The Cloud Run GPU harness below is what produced them and is kept for resume.

## Cloud Run GPU harness (`cloud_spike.py` + `Dockerfile`)

The spike actually ran as a Cloud Run **GPU job** on `resonate-staging-499404`,
not a local box — `cloud_spike.py` is that entrypoint and `Dockerfile` builds
its image. It is **fully env-driven**, so tuning is a ~5-minute, no-rebuild loop:

| Env var | Default | Meaning |
| --- | --- | --- |
| `SPIKE_PROMPT` | "darker halftime…" | the requested change |
| `SPIKE_NOISE` | `0.3,0.5,0.7,0.9` | csv `init_noise_level` sweep (low = faithful) |
| `SPIKE_STEPS` | `8` | diffusion steps (8 = turbo, 25–50 = quality) |
| `SPIKE_CFG` | `1.0` | prompt strength (≈7 is the sweet spot) |
| `SPIKE_DURATION` | `30` | clip seconds |
| `STEM_GCS_URI` | _(unset → synthetic stem)_ | `gs://…` real stem to condition on |
| `OUTPUT_BUCKET` | _(required)_ | where clips + `metrics.json` land |
| `HF_TOKEN` | _(secret)_ | HF token for the gated model |

```bash
# Tuning run (no rebuild — env only):
gcloud beta run jobs update stable-audio-spike \
  --project=resonate-staging-499404 --region=europe-west1 \
  --update-env-vars="^@^SPIKE_PROMPT=add a heavy techno kick@SPIKE_NOISE=0.15,0.2,0.3@SPIKE_STEPS=25@SPIKE_CFG=7"
gcloud beta run jobs execute stable-audio-spike --wait \
  --project=resonate-staging-499404 --region=europe-west1
```

First-time infra: build the image (`gcloud builds submit`), then create the job
with `--gpu=1 --gpu-type=nvidia-l4 --no-gpu-zonal-redundancy --memory=32Gi
--cpu=8` (**16Gi OOMs** on model load), a `hf-token` Secret Manager secret, and
`storage.objectAdmin` for the compute SA on the output bucket. The HF account
must have accepted the gated model license. **Rotate the HF token after use.**

## One-click: Colab notebook

The fastest path is the self-contained notebook **`stable_audio_3_spike_colab.ipynb`**
in this directory — open it in Colab (or any Jupyter on an Ampere+ GPU), set an
L4/A100 runtime, paste your HF token, Run-all, listen, score. No repo clone or
GitHub auth needed; the harness logic is inlined. The CLI steps below are the
equivalent for a raw VM.

## The question the spike answers

A pass = a draft that **stays recognizable as the source stem** while applying
the prompt. A fail = a fresh unrelated track (which is what prompt-only Lyria
already gives us — no reason to adopt for that). `init_noise_level` is the
knob: low values preserve the source, high values drift away. We're looking
for a usable band.

## Prerequisites

- **GPU**: a CUDA card with ≥8 GB VRAM (the model needs ~6.5 GB at 120s; a
  spot L4/T4, or a consumer RTX 3060/4060, is plenty). CUDA 12.x.
- **Hugging Face access**: accept the model terms on the
  [`stabilityai/stable-audio-3-medium`](https://huggingface.co/stabilityai/stable-audio-3-medium)
  page, then `export HF_TOKEN=...` (gated download).
- A **real stem** to condition on. Pull one from staging so the test reflects
  our actual audio (see below).

## Setup

```bash
# On the GPU box, in a fresh venv/conda env:
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install git+https://github.com/Stability-AI/stable-audio-3.git
huggingface-cli login   # or rely on HF_TOKEN
```

## Get a real stem to condition on

Any licensed stem works; using a staging stem keeps the test honest. The
catalog blob endpoint serves stem audio:

```bash
# Replace with a real stem id from staging.
curl -s "$STAGING_API/catalog/stems/<stemId>/blob" -o source-stem.mp3
```

(Or copy a local `backend/uploads/stems/<...>.mp3` from a dev run.)

## Run

```bash
python run_spike.py \
  --stem source-stem.mp3 \
  --prompt "darker halftime variation, keep the groove" \
  --noise-levels 0.3 0.5 0.7 0.9 \
  --duration 30
# -> outputs/noise_0.30.wav ... noise_0.90.wav + outputs/metrics.json
```

Run it a second time in an **extension** framing
(`--prompt "extend this section, develop it further" --noise-levels 0.5 0.7 0.9`)
to cover both Remix Studio prompted modes.

> The harness is written against Stability's documented inference API. Two
> spots in `run_spike.py` are marked to reconcile against the installed
> package (how the reference audio is loaded, and the `generate()` return
> shape on save) — a 2-minute fix at run time if the package differs.

## Evaluation rubric (the human part)

For each `noise_*.wav`, score 1–5:

1. **Source identity** — can you still hear the original stem in it? (the
   whole point; below ~3 it's not a remix of *this* audio)
2. **Prompt adherence** — did the requested change actually happen?
3. **Musical quality** — coherent, not garbled/artefacty?
4. **Usability as a draft** — would a creator accept this as a starting point?

Find the `init_noise_level` band where 1 and 2 are both ≥3 (identity preserved
*and* prompt applied). If no band satisfies both → audio conditioning doesn't
deliver for our use case → **reject**, stay on feature-conditioned Lyria
(#1192) + stem-mix renders (#1189).

Capture from `metrics.json`: model load time, per-generation latency, peak
VRAM. These size the eventual deployment (Cloud Run GPU vs. dedicated VM).

## Write up & tear down

1. Commit a findings note to `docs/rfc/stable-audio-3-spike-findings.md`:
   the usable `init_noise_level` band (or "none"), latency/VRAM numbers, a
   go/no-go on adoption, and the recommended deployment shape.
2. Update #1182 (slices 4–5 unblocked with a concrete plan, or closed against
   the fallback) and #1193.
3. **Tear the GPU instance down.** This is throwaway by design — do not leave
   it running.
