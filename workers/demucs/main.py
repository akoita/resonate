from fastapi import FastAPI, UploadFile, File, HTTPException, Query
import os
import shutil
import asyncio
import subprocess
import hashlib
from pathlib import Path
import tempfile
import logging
import httpx
import json
from typing import Optional, Tuple
from concurrent.futures import ThreadPoolExecutor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Resonate Demucs Worker")

# Processing mode: 'http' (Phase 1 legacy) or 'pubsub' (Phase 2 event-driven)
PROCESSING_MODE = os.getenv("PROCESSING_MODE", "pubsub")

# Storage mode: 'local' (shared volume) or 'gcs' (Google Cloud Storage)
STORAGE_MODE = os.getenv("STORAGE_MODE", "local")
GCS_BUCKET = os.getenv("GCS_BUCKET", "")

# Local output directory (used when STORAGE_MODE=local)
OUTPUT_BASE_DIR = Path(os.getenv("OUTPUT_DIR", "/outputs"))
OUTPUT_BASE_DIR.mkdir(parents=True, exist_ok=True)

# Pub/Sub config
PUBSUB_PROJECT = os.getenv("GCP_PROJECT_ID", "")
SUBSCRIPTION_NAME = os.getenv("PUBSUB_SUBSCRIPTION", "stem-separate-worker")
RESULTS_TOPIC = os.getenv("PUBSUB_RESULTS_TOPIC", "stem-results")

# Lazy-loaded GCS client (only imported when needed)
_gcs_client = None


def generate_fingerprint(audio_path: Path) -> Tuple[float, str, str]:
    """Generate a Chromaprint fingerprint for an audio file.

    Returns (duration, raw_fingerprint, fingerprint_hash).
    The fingerprint_hash is a SHA-256 of the raw fingerprint for fast DB comparison.
    """
    try:
        result = subprocess.run(
            ["fpcalc", "-raw", "-json", str(audio_path)],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            logger.error(f"fpcalc failed: {result.stderr}")
            raise RuntimeError(f"fpcalc failed with exit code {result.returncode}")

        data = json.loads(result.stdout)
        duration = data.get("duration", 0.0)
        raw_fingerprint = ",".join(str(v) for v in data.get("fingerprint", []))
        fingerprint_hash = hashlib.sha256(raw_fingerprint.encode()).hexdigest()

        logger.info(f"Fingerprint generated: duration={duration:.1f}s, hash={fingerprint_hash[:16]}...")
        return duration, raw_fingerprint, fingerprint_hash
    except FileNotFoundError:
        logger.warning("fpcalc not found — skipping fingerprint generation")
        return 0.0, "", ""
    except subprocess.TimeoutExpired:
        logger.warning("fpcalc timed out — skipping fingerprint generation")
        return 0.0, "", ""


async def submit_fingerprint(callback_url: str, release_id: str, track_id: str,
                              duration: float, fingerprint: str, fingerprint_hash: str) -> dict:
    """Submit fingerprint to the backend and check for duplicate/quarantine."""
    url = f"{callback_url}/ingestion/fingerprint/{release_id}/{track_id}"
    payload = {
        "duration": duration,
        "fingerprint": fingerprint,
        "fingerprintHash": fingerprint_hash,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload)
            if response.status_code == 200 or response.status_code == 201:
                return response.json()
            else:
                logger.warning(f"Fingerprint submission returned {response.status_code}: {response.text}")
                return {"quarantined": False}
    except Exception as e:
        logger.warning(f"Failed to submit fingerprint: {e}")
        return {"quarantined": False}  # Don't block separation on fingerprint failures

def get_gcs_client():
    global _gcs_client
    if _gcs_client is None:
        from google.cloud import storage
        _gcs_client = storage.Client()
    return _gcs_client


def upload_to_gcs(local_path: Path, gcs_key: str) -> str:
    """Upload a file to GCS and return a public HTTPS URL."""
    client = get_gcs_client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(gcs_key)
    blob.upload_from_filename(str(local_path), content_type="audio/mpeg")
    return f"https://storage.googleapis.com/{GCS_BUCKET}/{gcs_key}"


def download_from_gcs(gcs_uri: str, dest_path: Path) -> Path:
    """Download a file from GCS (gs:// or https://) to local path."""
    import re
    if gcs_uri.startswith("gs://"):
        # gs://bucket/key format
        match = re.match(r"gs://([^/]+)/(.+)", gcs_uri)
        if not match:
            raise ValueError(f"Invalid GCS URI: {gcs_uri}")
        bucket_name, key = match.groups()
        client = get_gcs_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(key)
        blob.download_to_filename(str(dest_path))
    elif gcs_uri.startswith("https://storage.googleapis.com/"):
        # HTTPS URL format — extract bucket/key
        parts = gcs_uri.replace("https://storage.googleapis.com/", "").split("/", 1)
        if len(parts) < 2:
            raise ValueError(f"Invalid GCS URL: {gcs_uri}")
        bucket_name, key = parts
        client = get_gcs_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(key)
        blob.download_to_filename(str(dest_path))
    else:
        raise ValueError(f"Unsupported URI scheme: {gcs_uri}")
    return dest_path


async def run_demucs_separation(input_path: Path, temp_dir: str, release_id: str, track_id: str, callback_url: Optional[str] = None) -> dict:
    """Run Demucs separation and return stems dict. Shared by HTTP and Pub/Sub paths."""
    # Output directory for this specific track
    if STORAGE_MODE == "local":
        final_output_dir = OUTPUT_BASE_DIR / release_id / track_id
        final_output_dir.mkdir(parents=True, exist_ok=True)
    else:
        final_output_dir = Path(temp_dir) / "final"
        final_output_dir.mkdir(parents=True, exist_ok=True)

    # Run demucs
    logger.info(f"Running Demucs on {input_path}")
    process = await asyncio.create_subprocess_exec(
        "demucs",
        "-n", "htdemucs_6s",
        "--out", str(temp_dir),
        str(input_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    # Results storage
    stdout_data = []
    stderr_data = []

    async def read_stdout(stream):
        while True:
            line = await stream.readline()
            if not line: break
            stdout_data.append(line.decode())

    async def read_stderr(stream):
        buffer = ""
        last_progress = -1
        while True:
            chunk = await stream.read(256)
            if not chunk: break
            decoded = chunk.decode(errors='ignore')
            stderr_data.append(decoded)
            buffer += decoded

            import re
            matches = re.findall(r'(\d+)%\|', buffer)
            if matches:
                try:
                    percentage = int(matches[-1])
                    if percentage != last_progress:
                        last_progress = percentage
                        logger.info(f"Progress: {percentage}%")
                        if callback_url:
                            try:
                                async with httpx.AsyncClient() as client:
                                    await client.post(
                                        f"{callback_url}/ingestion/progress/{release_id}/{track_id}",
                                        json={"progress": percentage}
                                    )
                            except Exception as cb_err:
                                logger.debug(f"Failed to send progress callback: {cb_err}")
                except Exception as e:
                    logger.debug(f"Failed to parse progress: {e}")

            if len(buffer) > 1000:
                buffer = buffer[-500:]

    await asyncio.gather(
        read_stdout(process.stdout),
        read_stderr(process.stderr),
        process.wait()
    )

    stderr_str = "".join(stderr_data)

    if process.returncode != 0:
        logger.error(f"Demucs failed with exit code {process.returncode}")
        raise RuntimeError(f"Demucs processing failed: {stderr_str}")

    logger.info("Demucs finished successfully")

    # Process output stems
    model = "htdemucs_6s"
    track_stem = input_path.stem
    demucs_out_path = Path(temp_dir) / model / track_stem

    if not demucs_out_path.exists():
        raise RuntimeError(f"Demucs output directory {demucs_out_path} not found")

    stems_list = ["vocals.wav", "drums.wav", "bass.wav", "other.wav", "piano.wav", "guitar.wav"]
    results = {}
    for stem in stems_list:
        stem_src = demucs_out_path / stem
        if stem_src.exists():
            mp3_filename = stem.replace(".wav", ".mp3")
            stem_dest_mp3 = final_output_dir / mp3_filename

            logger.info(f"Compressing {stem} to MP3...")
            ffmpeg_proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-i", str(stem_src),
                "-b:a", "320k", str(stem_dest_mp3),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await ffmpeg_proc.wait()

            if ffmpeg_proc.returncode == 0 and stem_dest_mp3.exists():
                stem_name = stem.replace(".wav", "")

                if STORAGE_MODE == "gcs" and GCS_BUCKET:
                    gcs_key = f"stems/{release_id}/{track_id}/{mp3_filename}"
                    url = upload_to_gcs(stem_dest_mp3, gcs_key)
                    results[stem_name] = url
                    logger.info(f"Uploaded stem to GCS: {url}")
                else:
                    results[stem_name] = str(Path(release_id) / track_id / mp3_filename)
                    logger.info(f"Generated stem: {stem_dest_mp3}")
            else:
                logger.warning(f"FFmpeg failed or MP3 missing for {stem}")
        else:
            logger.warning(f"Stem {stem} not found in output")

    return results


# ─── HTTP endpoint (Phase 1 legacy) ───────────────────────────────────

@app.post("/separate/{release_id}/{track_id}")
async def separate_audio(
    release_id: str,
    track_id: str,
    file: UploadFile = File(...),
    callback_url: Optional[str] = Query(None, description="Backend URL for progress reporting"),
):
    logger.info(f"[HTTP] Processing separation for release={release_id}, track={track_id}")

    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = Path(temp_dir) / file.filename
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        try:
            results = await run_demucs_separation(input_path, temp_dir, release_id, track_id, callback_url)
            return {
                "status": "success",
                "release_id": release_id,
                "track_id": track_id,
                "storage_mode": STORAGE_MODE,
                "stems": results
            }
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))


# ─── Pub/Sub consumer (Phase 2 event-driven) ──────────────────────────


async def download_audio(uri: str, dest_path: Path):
    """Download audio from GCS, HTTP URL, or shared volume."""
    if uri.startswith("gs://") or uri.startswith("https://storage.googleapis.com/"):
        # GCS download (production)
        download_from_gcs(uri, dest_path)
    elif uri.startswith("http://") or uri.startswith("https://"):
        # HTTP download (local dev — fetch from backend API)
        # Replace localhost with host.docker.internal for Docker networking
        download_url = uri.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
        logger.info(f"[PubSub] HTTP download from {download_url}")
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(download_url)
            response.raise_for_status()
            dest_path.write_bytes(response.content)
    else:
        # Try as a local file path (shared volume /outputs)
        local_candidates = [
            Path(uri),
            OUTPUT_BASE_DIR / uri,
            OUTPUT_BASE_DIR / Path(uri).name,
        ]
        for candidate in local_candidates:
            if candidate.exists():
                shutil.copy2(str(candidate), str(dest_path))
                return
        raise FileNotFoundError(f"Could not find audio at any of: {[str(c) for c in local_candidates]}")

async def process_pubsub_message(message_data: dict):
    """Process a single Pub/Sub separation job."""
    job_id = message_data.get("jobId", "unknown")
    release_id = message_data["releaseId"]
    track_id = message_data["trackId"]
    artist_id = message_data.get("artistId", "")
    original_stem_uri = message_data["originalStemUri"]
    mime_type = message_data.get("mimeType", "audio/mpeg")
    original_stem_meta = message_data.get("originalStemMeta", {})
    callback_url = message_data.get("callbackUrl")

    logger.info(f"[PubSub] Processing job {job_id}: release={release_id}, track={track_id}, callback={callback_url}")

    with tempfile.TemporaryDirectory() as temp_dir:
        # Download original audio
        ext = ".mp3" if "mp3" in mime_type else ".wav"
        input_path = Path(temp_dir) / f"track_{track_id}{ext}"
        logger.info(f"[PubSub] Downloading audio from {original_stem_uri}")
        await download_audio(original_stem_uri, input_path)

        # ─── Fingerprint full track BEFORE separation ─────────────────
        duration, fingerprint, fingerprint_hash = generate_fingerprint(input_path)
        if fingerprint and callback_url:
            logger.info(f"[PubSub] Submitting fingerprint for {track_id}")
            fp_result = await submit_fingerprint(
                callback_url, release_id, track_id,
                duration, fingerprint, fingerprint_hash
            )
            if fp_result.get("quarantined"):
                logger.warning(f"[PubSub] Track {track_id} QUARANTINED — skipping separation")
                # Publish quarantine result instead of stems
                from google.cloud import pubsub_v1
                publisher = pubsub_v1.PublisherClient()
                topic_path = publisher.topic_path(PUBSUB_PROJECT, RESULTS_TOPIC)
                quarantine_msg = {
                    "jobId": job_id,
                    "releaseId": release_id,
                    "artistId": artist_id,
                    "trackId": track_id,
                    "status": "quarantined",
                    "reason": fp_result.get("reason", "Duplicate fingerprint detected"),
                }
                future = publisher.publish(
                    topic_path,
                    json.dumps(quarantine_msg).encode("utf-8"),
                    jobId=job_id,
                    releaseId=release_id,
                )
                future.result()
                logger.info(f"[PubSub] Published quarantine result for job {job_id}")
                return  # Skip Demucs entirely

        # Run separation (with progress callbacks if callbackUrl provided)
        results = await run_demucs_separation(input_path, temp_dir, release_id, track_id, callback_url)

        # Publish result to stem-results topic
        from google.cloud import pubsub_v1
        publisher = pubsub_v1.PublisherClient()
        topic_path = publisher.topic_path(PUBSUB_PROJECT, RESULTS_TOPIC)

        result_message = {
            "jobId": job_id,
            "releaseId": release_id,
            "artistId": artist_id,
            "trackId": track_id,
            "trackTitle": message_data.get("trackTitle"),
            "trackPosition": message_data.get("trackPosition"),
            "status": "completed",
            "stems": results,
            "originalStemMeta": {
                **original_stem_meta,
                "uri": original_stem_uri,
            },
        }

        future = publisher.publish(
            topic_path,
            json.dumps(result_message).encode("utf-8"),
            jobId=job_id,
            releaseId=release_id,
        )
        msg_id = future.result()
        logger.info(f"[PubSub] Published result for job {job_id} (messageId={msg_id})")


def pubsub_consumer_loop():
    """Blocking consumer loop that runs in a background thread."""
    from google.cloud import pubsub_v1

    subscriber = pubsub_v1.SubscriberClient()
    subscription_path = subscriber.subscription_path(PUBSUB_PROJECT, SUBSCRIPTION_NAME)

    logger.info(f"[PubSub] Starting consumer on {subscription_path}")

    def callback(message):
        try:
            data = json.loads(message.data.decode("utf-8"))
            logger.info(f"[PubSub] Received message: jobId={data.get('jobId')}")

            # Run async processing in the event loop
            loop = asyncio.new_event_loop()
            try:
                loop.run_until_complete(process_pubsub_message(data))
                message.ack()
                logger.info(f"[PubSub] Acked message for job {data.get('jobId')}")
            except Exception as e:
                logger.error(f"[PubSub] Processing failed for job {data.get('jobId')}: {e}")
                # Publish failure result
                try:
                    publisher = pubsub_v1.PublisherClient()
                    topic_path = publisher.topic_path(PUBSUB_PROJECT, RESULTS_TOPIC)
                    fail_msg = {
                        "jobId": data.get("jobId", "unknown"),
                        "releaseId": data.get("releaseId", ""),
                        "artistId": data.get("artistId", ""),
                        "trackId": data.get("trackId", ""),
                        "status": "failed",
                        "error": str(e),
                    }
                    publisher.publish(topic_path, json.dumps(fail_msg).encode("utf-8"))
                except Exception as pub_err:
                    logger.error(f"[PubSub] Failed to publish failure result: {pub_err}")
                message.nack()  # Let Pub/Sub retry
            finally:
                loop.close()
        except Exception as e:
            logger.error(f"[PubSub] Failed to parse message: {e}")
            message.ack()  # Don't retry malformed messages

    # Subscribe with flow control (1 message at a time for GPU memory safety)
    from google.cloud.pubsub_v1.types import FlowControl
    flow_control = FlowControl(max_messages=1)
    streaming_pull_future = subscriber.subscribe(
        subscription_path, callback=callback, flow_control=flow_control
    )

    logger.info(f"[PubSub] Consumer listening on {subscription_path}")

    try:
        streaming_pull_future.result()  # Blocks forever
    except Exception as e:
        logger.error(f"[PubSub] Consumer error: {e}")
        streaming_pull_future.cancel()
        try:
            streaming_pull_future.result(timeout=5)
        except Exception:
            pass
        raise  # Re-raise so retry wrapper can catch and retry


def pubsub_consumer_with_retry():
    """Retry wrapper for pubsub_consumer_loop — handles startup race conditions."""
    max_retries = 30
    for attempt in range(max_retries):
        try:
            pubsub_consumer_loop()
            break  # If it returns cleanly, stop
        except Exception as e:
            wait = min(2 ** attempt, 30)
            logger.warning(f"[PubSub] Consumer failed (attempt {attempt + 1}/{max_retries}): {e}")
            logger.info(f"[PubSub] Retrying in {wait}s...")
            import time
            time.sleep(wait)


@app.on_event("startup")
async def startup_event():
    """Start Pub/Sub consumer in background thread if in pubsub mode."""
    if PROCESSING_MODE == "pubsub":
        logger.info("[PubSub] Starting consumer thread (PROCESSING_MODE=pubsub)")
        executor = ThreadPoolExecutor(max_workers=1)
        executor.submit(pubsub_consumer_with_retry)
    else:
        logger.info("[HTTP] Running in HTTP-only mode (PROCESSING_MODE=http)")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "storage_mode": STORAGE_MODE,
        "processing_mode": PROCESSING_MODE,
    }
