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

### Dependency lock maintenance

`requirements.in` includes the SHA-256-bound Stable Audio source archive.
`requirements.lock` is resolved for the digest-pinned Python 3.11/Linux CUDA
base while `constraints-gpu.txt` preserves its preinstalled Torch/torchaudio
2.7.1 ABI. The two `flash-attn-cxx11abi-*.lock` files pin the official upstream
Torch 2.7 / CUDA 12 / CPython 3.11 wheels for both possible C++ ABIs by immutable
release URL and SHA-256. The Docker build reads Torch's actual ABI, installs only
the matching wheel, and imports the native extension as a build-time check. This
avoids compiling flash-attn from source on every clean Cloud Build while keeping
the dependency hash-enforced. `requirements-build.lock` installs the source
archive's hashed Hatchling build backend before the runtime graph.
Because every native dependency now comes from a verified wheel, the image uses
the digest-pinned PyTorch runtime base rather than its roughly 4 GB larger
compiler/development variant.

Refresh the runtime graph with `uv 0.11.24`:

```bash
cd workers/stable-audio
uv pip compile requirements-build.in \
  --python-version 3.11 --python-platform x86_64-manylinux_2_35 \
  --generate-hashes --no-emit-index-url \
  --output-file requirements-build.lock \
  --custom-compile-command 'uv pip compile requirements-build.in --python-version 3.11 --python-platform x86_64-manylinux_2_35 --generate-hashes --no-emit-index-url --output-file requirements-build.lock'
uv pip compile requirements.in \
  --python-version 3.11 --python-platform x86_64-manylinux_2_35 \
  --constraints constraints-gpu.txt --excludes constraints-gpu.txt \
  --generate-hashes --no-emit-index-url \
  --output-file requirements.lock \
  --custom-compile-command 'uv pip compile requirements.in --python-version 3.11 --python-platform x86_64-manylinux_2_35 --constraints constraints-gpu.txt --excludes constraints-gpu.txt --generate-hashes --no-emit-index-url --output-file requirements.lock'
```

For a flash-attn update, inspect the official GitHub release assets and select
the `cu12torch2.7`, `cp311`, `linux_x86_64` wheels for both C++ ABI values. Copy
GitHub's published SHA-256 digests into the URL fragment and pip hash in the two
lock files, then independently download and hash both exact assets. Do not fall
back to flash-attn's setup-time wheel guessing: it is not pip hash-enforced.

```bash
gh api repos/Dao-AILab/flash-attention/releases/tags/v2.8.3.post1 \
  --jq '.assets[] | select(.name | contains("cu12torch2.7")) | {name, digest, browser_download_url}'
docker build -t resonate-stable-audio:lock-test workers/stable-audio
python scripts/check-python-worker-locks.py
```

The lock is platform-specific. A host-side uv resolution alone is not GPU
validation; run the Docker build in the exact digest-pinned CUDA base and load
`flash_attn` before calling an update validated.

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
