"""Stable Audio 3 remix worker (#1182 slice 4).

A warm FastAPI GPU service that turns a conditioning stem mix + a prompt into a
recognizable-but-changed remix draft, using the model the #1193 adopt-gate
validated. The backend's AudioConditionedRemixGenerationProvider calls
`POST /generate`; deployment is scale-to-zero (Cloud Run), so the ~4-min cold
model load folds into the already-async generation queue (#1167).

Generation knobs come from the request (the backend sends the spike defaults:
cfg≈7 / init_noise_level≈0.2 / steps=25), so retuning needs no redeploy.
"""
import io
import logging
import os
import random
import tempfile
from contextlib import asynccontextmanager

import torch
import torchaudio
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("stable-audio-worker")

# Stable Audio 3 renders at 44.1 kHz; the autoencoder is stereo.
OUTPUT_SR = 44100
DEFAULT_MODEL = os.environ.get("STABLE_AUDIO_MODEL", "medium")
MAX_UPLOAD_BYTES = int(os.environ.get("WORKER_MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))

_MODELS: dict[str, object] = {}


def _load_model(name: str):
    """Load + cache a model by size. First call pays the cold-load cost."""
    if name in _MODELS:
        return _MODELS[name]
    from stable_audio_3 import StableAudioModel

    log.info("loading Stable Audio 3 model: %s", name)
    model = StableAudioModel.from_pretrained(name, device="cuda")
    _MODELS[name] = model
    log.info("model %s loaded", name)
    return model


@asynccontextmanager
async def lifespan(_: FastAPI):
    token = os.environ.get("HF_TOKEN")
    if token:
        from huggingface_hub import login

        login(token=token)
    # Warm the default model at startup so the first real request only pays
    # generation latency, not the load.
    try:
        _load_model(DEFAULT_MODEL)
    except Exception:  # noqa: BLE001 — surfaced via /health, not a crash loop
        log.exception("startup model load failed; will retry on first request")
    yield


app = FastAPI(title="Resonate Stable Audio 3 Worker", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "loadedModels": list(_MODELS.keys()),
    }


def _to_stereo(audio: torch.Tensor) -> torch.Tensor:
    """Normalize generate() output to a 2D [channels, samples] stereo tensor.

    Drops a leading batch dim, and up-mixes mono to stereo by duplication so a
    draft never plays back thinner than the source — the spike saw mono output
    on real stems (#1193 follow-up), so we never assume the channel count.
    """
    if audio.dim() == 3:
        audio = audio[0]
    if audio.dim() == 1:
        audio = audio.unsqueeze(0)
    if audio.size(0) == 1:
        audio = audio.repeat(2, 1)
    return audio


@app.post("/generate")
async def generate(
    file: UploadFile,
    prompt: str = Form(...),
    cfg_scale: float = Form(1.0),
    init_noise_level: float = Form(1.0),
    steps: int = Form(8),
    duration: float = Form(30),
    model: str = Form(DEFAULT_MODEL),
    seed: int | None = Form(None),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty conditioning audio.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Conditioning audio too large.")

    # torchaudio decodes mp3/wav via ffmpeg (installed in the image).
    with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
        tmp.write(raw)
        tmp.flush()
        try:
            wav, in_sr = torchaudio.load(tmp.name)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=400, detail=f"Could not decode conditioning audio: {exc}"
            ) from exc

    used_seed = seed if seed is not None else random.randint(1, 2**31 - 1)

    try:
        sa_model = _load_model(model)
    except Exception as exc:  # noqa: BLE001
        log.exception("model load failed")
        raise HTTPException(status_code=503, detail=f"Model load failed: {exc}") from exc

    try:
        audio = sa_model.generate(
            init_audio=(in_sr, wav),  # generate() wants (sample_rate, tensor)
            init_noise_level=init_noise_level,
            prompt=prompt,
            duration=duration,
            steps=steps,
            cfg_scale=cfg_scale,
            seed=used_seed,
        )
    except Exception as exc:  # noqa: BLE001
        # Generation faults (bad prompt/audio for the model) are the caller's
        # to act on; 422 maps to the backend's non-retryable provider_rejected.
        log.exception("generation failed")
        raise HTTPException(status_code=422, detail=f"Generation failed: {exc}") from exc

    tensor = _to_stereo(audio).detach().cpu().float()
    buffer = io.BytesIO()
    torchaudio.save(buffer, tensor, OUTPUT_SR, format="wav")
    return Response(
        content=buffer.getvalue(),
        media_type="audio/wav",
        headers={"X-Seed": str(used_seed), "X-Sample-Rate": str(OUTPUT_SR)},
    )


@app.exception_handler(HTTPException)
async def _http_exc(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
