FROM python:3.10-slim

# Build argument to control model pre-caching (set to 0 to skip for faster builds)
ARG CACHE_MODEL=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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
