from fastapi import FastAPI, UploadFile, File, HTTPException, Query
import os
import shutil
import asyncio
import subprocess
from pathlib import Path
import tempfile
import logging
import httpx
from typing import Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Resonate Demucs Worker")

# Storage mode: 'local' (shared volume) or 'gcs' (Google Cloud Storage)
STORAGE_MODE = os.getenv("STORAGE_MODE", "local")
GCS_BUCKET = os.getenv("GCS_BUCKET", "")

# Local output directory (used when STORAGE_MODE=local)
OUTPUT_BASE_DIR = Path(os.getenv("OUTPUT_DIR", "/outputs"))
OUTPUT_BASE_DIR.mkdir(parents=True, exist_ok=True)

# Lazy-loaded GCS client (only imported when needed)
_gcs_client = None

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


@app.post("/separate/{release_id}/{track_id}")
async def separate_audio(
    release_id: str,
    track_id: str,
    file: UploadFile = File(...),
    callback_url: Optional[str] = Query(None, description="Backend URL for progress reporting"),
):
    logger.info(f"Processing separation for release={release_id}, track={track_id}")
    if callback_url:
        logger.info(f"Progress callback URL: {callback_url}")
    
    # Create temporary directory for input and demucs processing
    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = Path(temp_dir) / file.filename
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Output directory for this specific track
        if STORAGE_MODE == "local":
            final_output_dir = OUTPUT_BASE_DIR / release_id / track_id
            final_output_dir.mkdir(parents=True, exist_ok=True)
        else:
            # GCS mode: use temp dir, upload later
            final_output_dir = Path(temp_dir) / "final"
            final_output_dir.mkdir(parents=True, exist_ok=True)
        
        try:
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

            # Progress tracking and stream reading
            async def read_stdout(stream):
                while True:
                    line = await stream.readline()
                    if not line: break
                    stdout_data.append(line.decode())

            async def read_stderr(stream):
                buffer = ""
                last_progress = -1
                while True:
                    # Read in small chunks to capture tqdm progress (uses \r not \n)
                    chunk = await stream.read(256)
                    if not chunk: break
                    decoded = chunk.decode(errors='ignore')
                    stderr_data.append(decoded)
                    buffer += decoded
                    
                    # Look for progress patterns in buffer
                    import re
                    matches = re.findall(r'(\d+)%\|', buffer)
                    if matches:
                        try:
                            percentage = int(matches[-1])
                            if percentage != last_progress:
                                last_progress = percentage
                                logger.info(f"Progress: {percentage}%")
                                # Report progress via callback URL if provided
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
                    
                    # Keep buffer from growing too large
                    if len(buffer) > 1000:
                        buffer = buffer[-500:]

            # Run demucs and track progress
            await asyncio.gather(
                read_stdout(process.stdout),
                read_stderr(process.stderr),
                process.wait()
            )
            
            stdout_str = "".join(stdout_data)
            stderr_str = "".join(stderr_data)

            if process.returncode != 0:
                logger.error(f"Demucs failed with exit code {process.returncode}")
                logger.error(f"Stderr: {stderr_str}")
                raise HTTPException(status_code=500, detail=f"Demucs processing failed: {stderr_str}")

            logger.info(f"Demucs finished successfully")
            
            # Demucs output structure: {temp_dir}/{model}/{track_filename_stem}/{stem}.wav
            model = "htdemucs_6s"
            track_stem = input_path.stem
            demucs_out_path = Path(temp_dir) / model / track_stem
            
            if not demucs_out_path.exists():
                logger.error(f"Expected output directory {demucs_out_path} not found")
                logger.info(f"Contents of {temp_dir}: {list(Path(temp_dir).glob('**/*'))}")
                raise HTTPException(status_code=500, detail="Demucs output directory not found")
            
            # Process stems — compress to MP3 and store
            stems = ["vocals.wav", "drums.wav", "bass.wav", "other.wav", "piano.wav", "guitar.wav"]
            results = {}
            for stem in stems:
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
                            # Upload to GCS and return HTTPS URL
                            gcs_key = f"stems/{release_id}/{track_id}/{mp3_filename}"
                            url = upload_to_gcs(stem_dest_mp3, gcs_key)
                            results[stem_name] = url
                            logger.info(f"Uploaded stem to GCS: {url}")
                        else:
                            # Local mode: return relative path (backward compatible)
                            results[stem_name] = str(Path(release_id) / track_id / mp3_filename)
                            logger.info(f"Generated stem: {stem_dest_mp3}")
                    else:
                        logger.warning(f"FFmpeg failed or MP3 missing for {stem}, falling back to WAV")
                        stem_name = stem.replace(".wav", "")
                        if STORAGE_MODE == "local":
                            results[stem_name] = str(Path(release_id) / track_id / stem)
                else:
                    logger.warning(f"Stem {stem} not found in output")
            
            return {
                "status": "success",
                "release_id": release_id,
                "track_id": track_id,
                "storage_mode": STORAGE_MODE,
                "stems": results
            }
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Demucs failed with exit code {e.returncode}")
            logger.error(f"Stderr: {e.stderr}")
            raise HTTPException(status_code=500, detail=f"Demucs processing failed: {e.stderr}")
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"status": "ok", "storage_mode": STORAGE_MODE}
