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
RUN pip install "git+https://github.com/Stability-AI/stable-audio-3.git"
RUN pip install flash-attn --no-build-isolation

COPY cloud_spike.py /app/cloud_spike.py
CMD ["python", "cloud_spike.py"]
