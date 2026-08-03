# Stable Audio 3 remix worker (#1182 slice 4) — warm FastAPI GPU service.
# Base matches the torch stable_audio_3 wants (2.7.1 / cu12.6) so flash-attn
# builds against the SAME torch ABI. Deps pinned to the versions the #1193
# adopt-gate validated.
FROM pytorch/pytorch:2.7.1-cuda12.6-cudnn9-devel@sha256:639b8229ccfd8a3aa803cf49c33d6d6fe406750d79aaf723fe8c0eb1060d8cff

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-build.lock requirements.lock constraints-gpu.txt flash-attn.lock /app/
# requirements.lock includes the immutable stable-audio-3 archive. Exact
# constraints preserve the CUDA/Torch ABI supplied by the base image.
RUN python -m pip install --require-hashes -r requirements-build.lock \
    && python -m pip install --require-hashes --no-build-isolation \
        --constraint constraints-gpu.txt -r requirements.lock
# Build flash-attn last, against the final base-provided Torch ABI. FORCE_BUILD
# prevents its setup command from downloading an unverified GitHub wheel.
RUN FLASH_ATTENTION_FORCE_BUILD=TRUE \
    python -m pip install --require-hashes --no-build-isolation --no-deps \
        -r flash-attn.lock

COPY main.py /app/main.py

ENV PORT=8000
# Cloud Run sets $PORT; honor it for parity with the demucs worker.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
