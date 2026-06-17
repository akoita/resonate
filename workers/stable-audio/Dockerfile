# Stable Audio 3 remix worker (#1182 slice 4) — warm FastAPI GPU service.
# Base matches the torch stable_audio_3 wants (2.7.1 / cu12.6) so flash-attn
# builds against the SAME torch ABI. Deps pinned to the versions the #1193
# adopt-gate validated.
FROM pytorch/pytorch:2.7.1-cuda12.6-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt
# stable_audio_3 first so torch is final, THEN flash-attn builds against it.
RUN pip install "git+https://github.com/Stability-AI/stable-audio-3.git@8b920425b033e4dea477991ca07dc8b1ef5784e1"
RUN pip install "flash-attn==2.8.3.post1" --no-build-isolation

COPY main.py /app/main.py

ENV PORT=8000
# Cloud Run sets $PORT; honor it for parity with the demucs worker.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
