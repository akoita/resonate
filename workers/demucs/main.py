from fastapi import FastAPI, UploadFile, File, HTTPException
import os
import shutil
import asyncio
import subprocess
from pathlib import Path
import tempfile
import logging
import httpx

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Resonate Demucs Worker")

# We expect a shared volume at /outputs
OUTPUT_BASE_DIR = Path(os.getenv("OUTPUT_DIR", "/outputs"))
OUTPUT_BASE_DIR.mkdir(parents=True, exist_ok=True)

@app.post("/separate/{release_id}/{track_id}")
async def separate_audio(release_id: str, track_id: str, file: UploadFile = File(...)):
    logger.info(f"Processing separation for release={release_id}, track={track_id}")
    
    # Create temporary directory for input and demucs processing
    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = Path(temp_dir) / file.filename
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Output directory for this specific track in the shared volume
        final_output_dir = OUTPUT_BASE_DIR / release_id / track_id
        final_output_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            # Run demucs
            # -n htdemucs is the default high-quality model
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
                    # Demucs/tqdm progress looks like: " 45%|████... " or "100%|..."
                    import re
                    matches = re.findall(r'(\d+)%\|', buffer)
                    if matches:
                        try:
                            percentage = int(matches[-1])  # Take the latest percentage
                            if percentage != last_progress:
                                last_progress = percentage
                                logger.info(f"Progress: {percentage}%")
                                # Send to backend
                                async with httpx.AsyncClient() as client:
                                    await client.post(
                                        f"http://host.docker.internal:3000/ingestion/progress/{release_id}/{track_id}",
                                        json={"progress": percentage}
                                    )
                        except Exception as e:
                            logger.debug(f"Failed to parse progress: {e}")
                    
                    # Keep buffer from growing too large, keep last 500 chars for context
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
                # List what's in temp_dir to debug
                logger.info(f"Contents of {temp_dir}: {list(Path(temp_dir).glob('**/*'))}")
                raise HTTPException(status_code=500, detail="Demucs output directory not found")
            
            # Move stems to final output directory
            stems = ["vocals.wav", "drums.wav", "bass.wav", "other.wav", "piano.wav", "guitar.wav"]
            results = {}
            for stem in stems:
                stem_src = demucs_out_path / stem
                if stem_src.exists():
                    stem_dest_mp3 = final_output_dir / stem.replace(".wav", ".mp3")
                    
                    logger.info(f"Compressing {stem} to MP3...")
                    ffmpeg_proc = await asyncio.create_subprocess_exec(
                        "ffmpeg", "-y", "-i", str(stem_src),
                        "-b:a", "320k", str(stem_dest_mp3),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    await ffmpeg_proc.wait()
                    
                    if ffmpeg_proc.returncode == 0 and stem_dest_mp3.exists():
                        # Return the path relative to the shared volume root
                        results[stem.replace(".wav", "")] = str(Path(release_id) / track_id / stem.replace(".wav", ".mp3"))
                        logger.info(f"Generated stem: {stem_dest_mp3}")
                    else:
                        logger.warning(f"FFmpeg failed or MP3 missing for {stem}, falling back to WAV")
                        results[stem.replace(".wav", "")] = str(Path(release_id) / track_id / stem)
                        logger.info(f"Generated stem (fallback): {stem_src}")
                else:
                    logger.warning(f"Stem {stem} not found in output")
            
            return {
                "status": "success",
                "release_id": release_id,
                "track_id": track_id,
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
    return {"status": "ok"}
