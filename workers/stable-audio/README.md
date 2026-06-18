# Stable Audio 3 remix worker (#1182 slice 4)

A warm FastAPI GPU service that produces **audio-conditioned** remix drafts:
given a conditioning stem mix + a text prompt, it returns a variation/extension
that stays recognizable as the source. This is the production form of the
[#1193 adopt-gate spike](../../docs/rfc/stable-audio-3-spike-findings.md)
(**conditional GO**, draft-quality).

The backend's `AudioConditionedRemixGenerationProvider` mixes the project's
unmuted stems and calls this service; it is selected by
`REMIX_GENERATION_PROVIDER_KIND=audio-conditioned` and gated by
`REMIX_GENERATION_ENABLED`.

## API

### `POST /generate` (multipart)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `file` | file | — | conditioning audio (the mixed stems; mp3/wav) |
| `prompt` | string | — | the requested change |
| `cfg_scale` | float | `1.0` | prompt strength (backend sends ≈7) |
| `init_noise_level` | float | `1.0` | faithful↔free (backend sends ≈0.2) |
| `steps` | int | `8` | diffusion steps (backend sends 25) |
| `duration` | float | `30` | seconds |
| `model` | string | `medium` | model size |
| `seed` | int | random | deterministic when set |

Returns `audio/wav` with `X-Seed` and `X-Sample-Rate` (44100) headers.

### `GET /health`

`{ status, device, loadedModels }`.

## Deployment

Cloud Run GPU service (resonate-iac), L4, **`minScale=0`** (scale-to-zero — the
~4-min cold model load folds into the async generation queue #1167), `32Gi`
memory (16Gi OOMs loading the T5Gemma text encoder), `HF_TOKEN` from Secret
Manager (the HF account must have accepted the gated model license).

Image deps are pinned to the spike-validated versions
(`stable-audio-3@8b92042`, `flash-attn==2.8.3.post1`).

## Local

```bash
cd workers/stable-audio
docker build -t stable-audio-worker .
docker run --gpus all -p 8000:8000 -e HF_TOKEN=... stable-audio-worker
# then: curl -F file=@mix.mp3 -F prompt="add a techno kick" -F cfg_scale=7 \
#            -F init_noise_level=0.2 -F steps=25 http://localhost:8000/generate -o out.wav
```

## Known follow-up

The spike saw **mono output** on real stems; `_to_stereo()` up-mixes defensively
so drafts never play thinner than the source, but the root cause (why the model
returned mono for a stereo init) should be confirmed against this running
service and fixed at the source before any release-grade claim. See the findings
doc's improvement list and #1207.
