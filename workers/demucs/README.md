# Demucs GPU Worker

AI-powered audio stem separation worker using Facebook's [Demucs](https://github.com/facebookresearch/demucs) model.

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

> **Local dev:** Set `PUBSUB_EMULATOR_HOST=localhost:8085` and `GCP_PROJECT_ID=resonate-local`
> in the backend `.env`. The `docker-compose.yml` includes a `pubsub-emulator` service
> that provides a local Pub/Sub instance. The worker must have `google-cloud-pubsub`
> installed (see [Troubleshooting](#no-module-named-google) if this fails).

## Quick Start

### CPU Mode (Default)

```bash
docker compose up -d demucs-worker
```

### GPU Mode (Recommended)

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d demucs-worker
```

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

### "No module named 'google'"

The PubSub consumer fails with `No module named 'google'` when the Docker image was built
from a cached layer that predates the addition of `google-cloud-pubsub` to `requirements.txt`.

**Symptoms:**

- Worker logs show: `[PubSub] Consumer failed (attempt N/30): No module named 'google'`
- Tracks stuck at "Separating..." with no progress percentage
- Health check still returns OK (the HTTP server runs fine, only the PubSub thread fails)

**Quick fix** (hotfix into the running container):

```bash
docker exec resonate-demucs-worker-1 pip install google-cloud-pubsub
docker restart resonate-demucs-worker-1
```

**Permanent fix** (rebuild the image so deps are baked in):

```bash
make dev-up-build
# or: docker compose build demucs-worker && docker compose up -d demucs-worker
```

> **Why this happens:** Docker caches the `pip install -r requirements.txt` layer by
> content hash. If `requirements.txt` was modified but the image was built before that
> change, the old cached layer (without the new package) is reused. Use `--no-cache`
> or `make dev-up-build` to force a fresh install.

### "No audio I/O backend is available"

The soundfile package is required for torchaudio 2.x. Rebuild the container:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build demucs-worker
```

### "got an unexpected keyword argument 'encoding'"

The patch_demucs.py script fixes this. If you see this error, rebuild the container.

### GPU not detected

1. Verify NVIDIA drivers: `nvidia-smi`
2. Verify container toolkit: `docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi`
3. Check docker-compose.gpu.yml has `deploy.resources.reservations.devices`

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
