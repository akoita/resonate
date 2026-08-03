FROM python:3.10-slim@sha256:c1e4e6c01eb489c422288b2de34b0761ca316f7a2d98e2c33f47659a73ed108a

# Build argument to control model pre-caching (set to 0 to skip for faster builds)
ARG CACHE_MODEL=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    libchromaprint-tools \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the Python 3.10/Linux CPU graph, including reviewed CPU-only Torch
# wheels. The CUDA-base graph is intentionally separate in Dockerfile.gpu.
COPY requirements-build.lock requirements-cpu.lock ./
RUN python -m pip install --no-cache-dir --require-hashes -r requirements-build.lock \
    && python -m pip install --no-cache-dir --require-hashes \
        --no-build-isolation -r requirements-cpu.lock

# Create models directory with proper permissions
RUN mkdir -p /root/.cache/torch/hub/checkpoints

# Pre-download the Demucs model (~1GB) during build to avoid first-run delay
# This downloads htdemucs_6s which separates into 6 stems (vocals, drums, bass, guitar, piano, other)
RUN if [ "$CACHE_MODEL" = "1" ]; then \
    echo "Pre-caching Demucs htdemucs_6s model..." && \
    python -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')" && \
    echo "Model cached successfully!"; \
    else echo "Skipping model cache (CACHE_MODEL=0)"; fi

COPY . .

# Ensure the output directory exists and is writable
RUN mkdir -p /outputs && chmod 777 /outputs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
