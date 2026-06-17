# Stable Audio 3 spike — Cloud Run GPU job image (#1193). Throwaway.
# Base matches the torch stable_audio_3 wants (2.7.1 / cu12.6), so flash-attn
# builds against the SAME torch ABI — the first build pinned an older torch and
# hit an undefined-symbol load error.
FROM pytorch/pytorch:2.7.1-cuda12.6-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install soundfile numpy huggingface_hub google-cloud-storage
# stable_audio_3 first so torch is final, THEN flash-attn builds against it.
# Pinned to the commit + flash-attn version this spike actually validated, so a
# resume run can't silently pull a drifted API or an ABI-incompatible wheel.
RUN pip install "git+https://github.com/Stability-AI/stable-audio-3.git@8b920425b033e4dea477991ca07dc8b1ef5784e1"
RUN pip install "flash-attn==2.8.3.post1" --no-build-isolation

COPY cloud_spike.py /app/cloud_spike.py
CMD ["python", "cloud_spike.py"]
