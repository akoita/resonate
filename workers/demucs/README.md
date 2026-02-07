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

| Variable | Default | Description |
|----------|---------|-------------|
| `OUTPUT_DIR` | `/outputs` | Directory for generated stems |
| `TORCHAUDIO_USE_BACKEND_DISPATCHER` | `1` | Enable torchaudio 2.x backend |

### Dockerfile.gpu Features

The GPU Dockerfile includes several compatibility fixes:

1. **DEBIAN_FRONTEND=noninteractive** - Prevents interactive prompts during build
2. **soundfile backend** - Provides audio I/O for torchaudio 2.x
3. **patch_demucs.py** - Fixes deprecated `encoding` parameter in `ta.save()`
4. **Model pre-caching** - Downloads htdemucs_6s model during build

## API Endpoints

### POST /separate/{release_id}/{track_id}
Separate audio file into stems.

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
Health check endpoint.

## Troubleshooting

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

| File | Description |
|------|-------------|
| `Dockerfile` | CPU-only build |
| `Dockerfile.gpu` | GPU-enabled build with CUDA 12.1 |
| `main.py` | FastAPI worker with progress reporting |
| `patch_demucs.py` | Fixes torchaudio 2.x compatibility |
| `requirements.txt` | Python dependencies |
