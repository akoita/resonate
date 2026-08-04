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

### Dependency base image

Compiling flash-attn from CUDA source takes ~25 of the worker image's ~29-minute
build, and Cloud Build runs an uncached `docker build`, so that cost is paid on
every publish — including publishes where only `main.py` changed.

`Dockerfile.base` therefore holds every expensive, slow-changing layer (the
digest-pinned `pytorch/pytorch` base, apt packages, and the three hashed pip
installs including the flash-attn source build). It is published on its own by
[`.github/workflows/publish-stable-audio-base-image.yml`](../../.github/workflows/publish-stable-audio-base-image.yml)
and consumed by `Dockerfile` through a sha256 digest, so flash-attn only
recompiles when the dependency inputs change.

**Rollout status: phase 1 (base image published, worker not yet repinned).**
`Dockerfile` still builds everything itself, because the base image must exist
in Artifact Registry before anything can `FROM` its digest. Phase 2 is the
repin described below.

#### When a base rebuild is needed

Rebuild whenever any *base input* changes — that is exactly the `paths:` filter
of the publish workflow:

- `Dockerfile.base`
- `requirements-build.lock`, `requirements.lock`, `flash-attn.lock`
- `constraints-gpu.txt`
- the publish workflow itself

`main.py` is **not** a base input: application changes must never trigger a base
rebuild, which is the entire point of the split.

A push to `main` that touches one of those files rebuilds the base
automatically, but the worker keeps building against the previously pinned
digest until a human repins it. Treat the rebuild as *step one of two*.

#### Running the workflow

1. Actions -> **Publish Stable Audio Base Image** -> **Run workflow**.
2. Pick the `environment` (`staging` by default; it supplies `GCP_PROJECT_ID`
   and `GCP_REGION`). Leave `artifact_registry_repository` and `image_tag`
   empty unless you are deliberately targeting another repo or tag.
3. Wait for the build (~30 min; flash-attn dominates).
4. Read the job summary. Under **ACTION REQUIRED — pin this digest** it prints a
   ready-to-paste `FROM` block; the digest is also emitted as a job annotation.

The image is tagged `locks-<hash of the base inputs>` rather than by commit SHA:
the base is a pure function of those files, so an unchanged base re-lands on the
same tag instead of accumulating identical images, and the tag names the lock
set an image came from. Nothing consumes the tag — the worker consumes the
digest.

#### Phase 2 — repin the worker (manual, one PR)

After a base build, on a branch:

1. Copy the `FROM ...@sha256:...` line from the job summary.
2. Replace the `FROM` line at the top of `workers/stable-audio/Dockerfile` with
   it, and delete from that Dockerfile everything `Dockerfile.base` already
   does: the `ENV DEBIAN_FRONTEND`/`PIP_NO_CACHE_DIR` line, the `apt-get` step,
   the lock `COPY`, and both `pip install` steps. What stays is the `FROM`, the
   `WORKDIR /app`, `COPY main.py`, `ENV PORT`, and `CMD`.
3. Run `node scripts/check-docker-base-digests.mjs` (the `FROM` must carry a
   `sha256:` digest, and the same source must be pinned to the same digest
   everywhere) and `python3 scripts/check-python-worker-locks.py`. That second
   script asserts the hashed-install contract *in `Dockerfile`*; moving those
   installs to `Dockerfile.base` requires moving the corresponding
   `docker_contract` entry in the script to `workers/stable-audio/Dockerfile.base`
   in the same PR.
4. Validate the composed image before merging — a base image is invisible to the
   local `docker build .` unless it is pulled:

   ```bash
   gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev"
   docker build -t stable-audio-worker workers/stable-audio
   docker run --rm --gpus all stable-audio-worker python -c "import flash_attn; print(flash_attn.__version__)"
   ```

The base image lives in the deploy environment's Artifact Registry repo
(`resonate-staging` by default), while a Dockerfile `FROM` is a single fixed
string. Any other environment that builds this worker must therefore be able to
pull from that repo, or get its own copy of the base and its own pin. Setting
the GitHub Actions variable `STABLE_AUDIO_BASE_ARTIFACT_REGISTRY_REPOSITORY` (or
passing `artifact_registry_repository` on dispatch) publishes into a shared,
environment-independent repo instead, without a code change.

### Dependency lock maintenance

`requirements.in` includes the SHA-256-bound Stable Audio source archive.
`requirements.lock` is resolved for the digest-pinned Python 3.11/Linux CUDA
base while `constraints-gpu.txt` preserves its preinstalled Torch/torchaudio
2.7.1 ABI. `flash-attn.lock` is separate so its verified PyPI sdist builds
last, with build isolation disabled, against that final ABI.
`requirements-build.lock` installs the source archive's hashed Hatchling build
backend and flash-attn's declared setup tools first, so disabling PEP 517
isolation does not create a hidden download. The Docker build also sets
`FLASH_ATTENTION_FORCE_BUILD=TRUE`: without it, flash-attn's setup command tries
to fetch a guessed, unverified wheel from a GitHub release.

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

For a flash-attn update, obtain the sdist URL and digest from the PyPI JSON API,
download that exact URL, and compare `sha256sum` before changing
`flash-attn.lock`. Do not use pip's metadata preparation to obtain the sdist:
flash-attn imports Torch during setup and must be built in the CUDA base.

```bash
curl -fsSL https://pypi.org/pypi/flash-attn/2.8.3.post1/json
sha256sum flash_attn-2.8.3.post1.tar.gz
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
