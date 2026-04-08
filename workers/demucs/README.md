# Demucs GPU Worker

AI-powered audio stem separation worker using Facebook's [Demucs](https://github.com/facebookresearch/demucs) model.

This directory is the source of truth for the Demucs worker image used in local development.
You should be able to build, run, inspect, rebuild, and troubleshoot the worker from this repo
without switching to `resonate-iac`.

## Overview

This worker separates audio files into 6 stems:

- **vocals** - Lead and backing vocals
- **drums** - Drum kit and percussion
- **bass** - Bass instruments
- **guitar** - Electric and acoustic guitars
- **piano** - Piano and keyboard instruments
- **other** - Everything else (synths, strings, etc.)

## Processing Modes

The worker supports two processing modes, controlled by `PROCESSING_MODE`:

| Mode     | Description                                                   | Use Case                          |
| -------- | ------------------------------------------------------------- | --------------------------------- |
| `http`   | Legacy HTTP endpoint — backend sends file, waits for response | Simple local dev without Pub/Sub  |
| `pubsub` | GCP Pub/Sub event-driven — worker pulls jobs from topic       | Local dev (emulator) & production |

In **pubsub mode**, the worker:

1. Subscribes to the `stem-separate` Pub/Sub topic (or emulator)
2. Downloads audio from GCS or the backend HTTP URI in the message
3. Runs Demucs separation + ffmpeg compression
4. Uploads stems to GCS (or local `/outputs` volume)
5. Publishes results to `stem-results` topic
6. POSTs real-time progress callbacks to `{callbackUrl}/ingestion/progress/{releaseId}/{trackId}`

> **Local dev:** Run `make dev-up` from the repo root to start Postgres, Redis, and the Pub/Sub
> emulator defined in [`docker/docker-compose.local.yml`](../../docker/docker-compose.local.yml).
> Then run the Demucs worker container directly from this repo using the commands below.

## Quick Start

If you just want the normal repo-local worker flow, from the repo root:

```bash
make dev-up
make worker-up
make worker-health
```

`make worker-up` auto-builds the CPU image if it does not exist yet.
Use the manual Docker commands below when you want finer control over image builds,
GPU mode, or direct container debugging.

### 1. Start local dependencies

From the repo root:

```bash
make dev-up
```

This starts:

- Postgres on `localhost:5432`
- Redis on `localhost:6379`
- Pub/Sub emulator on `localhost:8085`

`make dev-up` already calls `make pubsub-init` internally, so you normally do not need to run it
separately. Use `make pubsub-init` by itself only as a recovery step if the Pub/Sub emulator was
reset and lost the `stem-separate` / `stem-results` topics or subscriptions.

### 2. Backend env for Pub/Sub mode

The backend publishes jobs to the worker through Pub/Sub in local dev. Make sure
`backend/.env` includes:

```bash
PUBSUB_EMULATOR_HOST=localhost:8085
GCP_PROJECT_ID=resonate-local
STEM_PROCESSING_MODE=pubsub
DEMUCS_WORKER_URL=http://localhost:8000
```

Notes:

- `DEMUCS_WORKER_URL` is only used in legacy `sync` HTTP mode, but keeping it set is harmless.
- In pubsub mode, the backend-side worker integration already falls back to
  `http://host.docker.internal:3000` when `BACKEND_URL` is unset.
- That fallback is usually better for local dev than setting `BACKEND_URL` globally in
  `backend/.env`, because `BACKEND_URL` is also used in browser-facing URL generation.

### 3. Build the worker image locally

From the repo root, build the CPU image:

```bash
docker build \
  -f workers/demucs/Dockerfile \
  -t resonate-demucs:cpu \
  workers/demucs
```

For the GPU image:

```bash
docker build \
  -f workers/demucs/Dockerfile.gpu \
  -t resonate-demucs:gpu \
  workers/demucs
```

To force a clean rebuild when you suspect a stale or invalid image:

```bash
docker build --no-cache \
  -f workers/demucs/Dockerfile \
  -t resonate-demucs:cpu \
  workers/demucs
```

### 4. Run the worker locally

The worker is not part of `docker/docker-compose.local.yml`, so run it explicitly.

#### CPU mode

```bash
docker run --rm -d \
  --name resonate-demucs-local \
  -p 8000:8000 \
  --add-host=host.docker.internal:host-gateway \
  -e PROCESSING_MODE=pubsub \
  -e STORAGE_MODE=local \
  -e OUTPUT_DIR=/outputs \
  -e GCP_PROJECT_ID=resonate-local \
  -e PUBSUB_EMULATOR_HOST=host.docker.internal:8085 \
  -e PUBSUB_SUBSCRIPTION=stem-separate-worker \
  -e PUBSUB_RESULTS_TOPIC=stem-results \
  -e TORCHAUDIO_USE_BACKEND_DISPATCHER=1 \
  -v "$(pwd)/backend/uploads/stems:/outputs" \
  resonate-demucs:cpu
```

#### GPU mode

```bash
docker run --rm -d \
  --name resonate-demucs-local \
  --gpus all \
  -p 8000:8000 \
  --add-host=host.docker.internal:host-gateway \
  -e PROCESSING_MODE=pubsub \
  -e STORAGE_MODE=local \
  -e OUTPUT_DIR=/outputs \
  -e GCP_PROJECT_ID=resonate-local \
  -e PUBSUB_EMULATOR_HOST=host.docker.internal:8085 \
  -e PUBSUB_SUBSCRIPTION=stem-separate-worker \
  -e PUBSUB_RESULTS_TOPIC=stem-results \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,utility \
  -e TORCHAUDIO_USE_BACKEND_DISPATCHER=1 \
  -v "$(pwd)/backend/uploads/stems:/outputs" \
  resonate-demucs:gpu
```

### 5. Verify the worker

```bash
make worker-health
docker logs -f resonate-demucs-local
```

Expected health response:

```json
{
  "status": "ok",
  "storage_mode": "local",
  "processing_mode": "pubsub"
}
```

### 6. Optional HTTP smoke test

If you want to verify the image itself before involving Pub/Sub, run the worker in HTTP mode:

```bash
docker rm -f resonate-demucs-local 2>/dev/null || true

docker run --rm -d \
  --name resonate-demucs-local \
  -p 8000:8000 \
  -e PROCESSING_MODE=http \
  -e STORAGE_MODE=local \
  -e OUTPUT_DIR=/outputs \
  -e TORCHAUDIO_USE_BACKEND_DISPATCHER=1 \
  -v "$(pwd)/backend/uploads/stems:/outputs" \
  resonate-demucs:cpu
```

Then send a test file:

```bash
curl -X POST \
  -F "file=@/absolute/path/to/test-audio.mp3" \
  "http://localhost:8000/separate/rel_local_test/trk_local_test"
```

If this succeeds, the image is good and any remaining issue is usually Pub/Sub wiring,
backend callbacks, or stale containers rather than Demucs itself.

**Performance:**
| Hardware | 3-min song | Speedup |
|----------|------------|---------|
| CPU (8 cores) | ~10 min | 1x |
| NVIDIA RTX 3080 | ~45 sec | ~15x |
| NVIDIA RTX A2000 | ~30 sec | ~20x |

## GPU Requirements

1. **NVIDIA GPU** with CUDA 12.1+ support
2. **NVIDIA Container Toolkit** installed and configured

### Install NVIDIA Container Toolkit (Ubuntu/Debian)

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Verify GPU Access

```bash
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

## Configuration

### Environment Variables

| Variable                            | Default                | Description                                        |
| ----------------------------------- | ---------------------- | -------------------------------------------------- |
| `PROCESSING_MODE`                   | `pubsub`               | `http` (legacy) or `pubsub` (event-driven)         |
| `STORAGE_MODE`                      | `local`                | `local` (shared volume) or `gcs` (Cloud Storage)   |
| `GCS_BUCKET`                        |                        | GCS bucket for stem storage (required in gcs mode) |
| `OUTPUT_DIR`                        | `/outputs`             | Directory for generated stems (local mode)         |
| `GCP_PROJECT_ID`                    |                        | GCP project ID (required in pubsub mode)           |
| `PUBSUB_SUBSCRIPTION`               | `stem-separate-worker` | Pub/Sub subscription for job intake                |
| `PUBSUB_RESULTS_TOPIC`              | `stem-results`         | Pub/Sub topic for publishing results               |
| `PUBSUB_EMULATOR_HOST`              |                        | Pub/Sub emulator address for local dev             |
| `TORCHAUDIO_USE_BACKEND_DISPATCHER` | `1`                    | Enable torchaudio 2.x backend                      |

### Local Dev Topology

In repo-local development:

- The backend usually runs on the host at `http://localhost:3000`
- The web app usually runs on the host at `http://localhost:3001`
- The Pub/Sub emulator usually runs on the host at `localhost:8085`
- The Demucs worker usually runs in Docker at `http://localhost:8000`
- The worker writes separated MP3s to `/outputs`, which should be mounted to
  `backend/uploads/stems`

That is why the local worker flow relies on both:

- `--add-host=host.docker.internal:host-gateway`
- the backend fallback URL `http://host.docker.internal:3000` used by the Pub/Sub publisher

### Dockerfile.gpu Features

The GPU Dockerfile includes several compatibility fixes:

1. **DEBIAN_FRONTEND=noninteractive** - Prevents interactive prompts during build
2. **soundfile backend** - Provides audio I/O for torchaudio 2.x
3. **patch_demucs.py** - Fixes deprecated `encoding` parameter in `ta.save()`
4. **Model pre-caching** - Downloads htdemucs_6s model during build

## API Endpoints

### POST /separate/{release_id}/{track_id}

Separate audio file into stems (HTTP mode only).

**Request:** Multipart form with audio file
**Response:**

```json
{
  "status": "success",
  "release_id": "rel_xxx",
  "track_id": "trk_xxx",
  "stems": {
    "vocals": "rel_xxx/trk_xxx/vocals.mp3",
    "drums": "rel_xxx/trk_xxx/drums.mp3",
    "bass": "rel_xxx/trk_xxx/bass.mp3",
    "guitar": "rel_xxx/trk_xxx/guitar.mp3",
    "piano": "rel_xxx/trk_xxx/piano.mp3",
    "other": "rel_xxx/trk_xxx/other.mp3"
  }
}
```

### GET /health

Health check endpoint. Returns processing mode and storage mode.

## Pub/Sub Message Schema

### Input (stem-separate topic)

```json
{
  "jobId": "sep_rel_xxx_trk_yyy",
  "releaseId": "rel_xxx",
  "artistId": "art_zzz",
  "trackId": "trk_yyy",
  "originalStemUri": "gs://bucket/originals/...",
  "mimeType": "audio/mpeg"
}
```

### Output (stem-results topic)

```json
{
  "jobId": "sep_rel_xxx_trk_yyy",
  "releaseId": "rel_xxx",
  "trackId": "trk_yyy",
  "status": "completed",
  "stems": {
    "vocals": "https://storage.googleapis.com/bucket/stems/.../vocals.mp3",
    "drums": "https://storage.googleapis.com/bucket/stems/.../drums.mp3"
  }
}
```

## Troubleshooting

### Track stuck at "Separating..."

If the UI stays on "Separating..." and no stems appear, walk through this checklist:

1. Confirm the worker is healthy:

   ```bash
   make worker-health
   ```

2. Confirm the worker is actually running the expected local image:

   ```bash
   docker ps --filter name=resonate-demucs-local
   docker images | grep resonate-demucs
   docker inspect resonate-demucs-local --format '{{.Config.Image}}'
   ```

3. Check worker logs for Pub/Sub startup and job consumption:

   ```bash
   docker logs --tail=200 resonate-demucs-local
   ```

   You want to see log lines similar to:

   - `[PubSub] Starting consumer thread`
   - `[PubSub] Consumer listening`
   - `[PubSub] Received message: jobId=...`

4. Recreate Pub/Sub topics/subscriptions if the emulator state was reset:

   ```bash
   make pubsub-init
   ```

5. If the image may be stale, fully rebuild and restart it:

   ```bash
   docker rm -f resonate-demucs-local 2>/dev/null || true
   docker rmi resonate-demucs:cpu 2>/dev/null || true

   docker build --no-cache \
     -f workers/demucs/Dockerfile \
     -t resonate-demucs:cpu \
     workers/demucs
   ```

This is the most common root cause of the recurring "invalid worker image" problem:
the backend and emulator are healthy, but the worker container is either not running,
running an old image, or missing a dependency baked into a newer Docker layer.

### "No module named 'google'"

The PubSub consumer fails with `No module named 'google'` when the Docker image was built
from a cached layer that predates the addition of `google-cloud-pubsub` to `requirements.txt`.

**Symptoms:**

- Worker logs show: `[PubSub] Consumer failed (attempt N/30): No module named 'google'`
- Tracks stuck at "Separating..." with no progress percentage
- Health check still returns OK (the HTTP server runs fine, only the PubSub thread fails)

**Quick fix** (hotfix into the running container):

```bash
docker exec resonate-demucs-local pip install google-cloud-pubsub
docker restart resonate-demucs-local
```

**Permanent fix** (rebuild the image from this repo so deps are baked in):

```bash
docker rm -f resonate-demucs-local 2>/dev/null || true
docker build --no-cache \
  -f workers/demucs/Dockerfile \
  -t resonate-demucs:cpu \
  workers/demucs
```

> **Why this happens:** Docker caches the `pip install -r requirements.txt` layer by
> content hash. If `requirements.txt` was modified but the image was built before that
> change, the old cached layer (without the new package) is reused. Force a no-cache
> rebuild locally to refresh the image.

### "No audio I/O backend is available"

The soundfile package is required for torchaudio 2.x. Rebuild the container:

```bash
docker rm -f resonate-demucs-local 2>/dev/null || true
docker build --no-cache \
  -f workers/demucs/Dockerfile \
  -t resonate-demucs:cpu \
  workers/demucs
```

### "got an unexpected keyword argument 'encoding'"

The patch_demucs.py script fixes this. If you see this error, rebuild the container.

### GPU not detected

1. Verify NVIDIA drivers: `nvidia-smi`
2. Verify container toolkit: `docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi`
3. Re-run the worker with `--gpus all`
4. Confirm you built `workers/demucs/Dockerfile.gpu`, not the CPU Dockerfile

### Reset local worker state

When in doubt, this sequence gives you a clean local worker:

```bash
docker rm -f resonate-demucs-local 2>/dev/null || true
docker rmi resonate-demucs:cpu resonate-demucs:gpu 2>/dev/null || true
make dev-up
make pubsub-init
docker build --no-cache -f workers/demucs/Dockerfile -t resonate-demucs:cpu workers/demucs
```

### Build stuck during apt-get

The `DEBIAN_FRONTEND=noninteractive` env var should prevent this. If stuck, cancel and rebuild.

## Files

| File               | Description                                        |
| ------------------ | -------------------------------------------------- |
| `Dockerfile`       | CPU-only build                                     |
| `Dockerfile.gpu`   | GPU-enabled build with CUDA 12.1                   |
| `main.py`          | FastAPI + Pub/Sub consumer with progress reporting |
| `patch_demucs.py`  | Fixes torchaudio 2.x compatibility                 |
| `requirements.txt` | Python dependencies                                |
