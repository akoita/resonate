# Stable Audio 3 remix worker (#1182 slice 4) — warm FastAPI GPU service.
# Runtime base matches the torch stable_audio_3 wants (2.7.1 / cu12.6) without
# the 4 GB of compiler/development layers that the prebuilt flash-attn wheel no
# longer needs. The wheel is selected against this image's actual C++ ABI below.
FROM pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-build.lock requirements.lock constraints-gpu.txt \
    flash-attn-cxx11abi-false.lock flash-attn-cxx11abi-true.lock /app/
# requirements.lock includes the immutable stable-audio-3 archive. Exact
# constraints preserve the CUDA/Torch ABI supplied by the base image.
RUN python -m pip install --require-hashes -r requirements-build.lock \
    && python -m pip install --require-hashes --no-build-isolation \
        --constraint constraints-gpu.txt -r requirements.lock
# Install flash-attn last, selecting the upstream wheel that matches the final
# base-provided Torch ABI. Both possible release assets are URL- and hash-pinned;
# importing the extension fails this layer immediately if the ABI is wrong.
RUN torch_cxx11_abi="$(python -c \
        'import torch; print("true" if torch._C._GLIBCXX_USE_CXX11_ABI else "false")')" \
    && python -m pip install --require-hashes --no-deps \
        -r "flash-attn-cxx11abi-${torch_cxx11_abi}.lock" \
    && python -c \
        'import flash_attn; from importlib.metadata import version; assert version("flash-attn").split("+", 1)[0] == "2.8.3.post1"'

COPY main.py /app/main.py

ENV PORT=8000
# Cloud Run sets $PORT; honor it for parity with the demucs worker.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
