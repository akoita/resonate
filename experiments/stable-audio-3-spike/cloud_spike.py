#!/usr/bin/env python3
"""Cloud Run GPU job entrypoint for the Stable Audio 3 spike (#1193).

Runs the init_noise_level sweep on a conditioning stem, uploads the clips +
metrics to GCS, and is deliberately verbose about the *actual* installed
stable_audio_3 API so a first-run mismatch is diagnostic, not a silent fail.
Throwaway evaluation infra.
"""
import inspect
import json
import os
import time
import traceback

import numpy as np
import soundfile as sf

SR = 44100
OUTPUT_BUCKET = os.environ["OUTPUT_BUCKET"]
RUN_ID = os.environ.get("CLOUD_RUN_EXECUTION", f"run-{int(time.time())}")
PROMPT = os.environ.get("SPIKE_PROMPT", "darker halftime variation, keep the groove")
NOISE_LEVELS = [float(x) for x in os.environ.get("SPIKE_NOISE", "0.3,0.5,0.7,0.9").split(",")]
DURATION = int(os.environ.get("SPIKE_DURATION", "30"))
STEPS = int(os.environ.get("SPIKE_STEPS", "8"))  # 8 = turbo default; 25-50 = quality
CFG = float(os.environ.get("SPIKE_CFG", "1.0"))
MODEL = os.environ.get("SPIKE_MODEL", "medium")  # try a larger model w/o a rebuild


def log(msg):
    print(f"[spike] {msg}", flush=True)


def synth_stem(path, seconds=8.0, bpm=90):
    notes = [110.0, 130.81, 164.81, 220.0]  # A minor arpeggio
    step = 60.0 / bpm / 2
    t = np.arange(int(seconds * SR)) / SR
    out = np.zeros_like(t)
    for i in range(int(seconds / step)):
        f = notes[i % len(notes)]
        s, e = int(i * step * SR), int((i * step + step) * SR)
        out[s:e] += 0.5 * np.sin(2 * np.pi * f * t[s:e]) * np.linspace(1, 0, e - s) ** 1.5
    sf.write(path, (out / np.max(np.abs(out)) * 0.9).astype(np.float32), SR)


def upload(local, name):
    from google.cloud import storage
    storage.Client().bucket(OUTPUT_BUCKET).blob(f"{RUN_ID}/{name}").upload_from_filename(local)
    log(f"uploaded gs://{OUTPUT_BUCKET}/{RUN_ID}/{name}")


def download_gcs(uri, local):
    from google.cloud import storage
    assert uri.startswith("gs://"), uri
    bucket, _, blob = uri[len("gs://"):].partition("/")
    storage.Client().bucket(bucket).blob(blob).download_to_filename(local)
    log(f"downloaded {uri} -> {local}")


def main():
    import torch
    from huggingface_hub import login

    log(f"GPU: {torch.cuda.get_device_name(0)}  torch {torch.__version__}")
    login(token=os.environ["HF_TOKEN"])

    # Condition on a real stem when STEM_GCS_URI is set; else a synthetic probe.
    stem_uri = os.environ.get("STEM_GCS_URI", "").strip()
    if stem_uri:
        src = "source_stem" + (os.path.splitext(stem_uri)[1] or ".wav")  # ext for format infer
        download_gcs(stem_uri, src)
        log(f"conditioning on REAL stem: {stem_uri}")
    else:
        src = "source_stem.wav"
        synth_stem(src)
        log("conditioning on SYNTHETIC stem")
    upload(src, os.path.basename(src))

    # Introspect the real API up front — logged regardless of what follows.
    import stable_audio_3
    from stable_audio_3 import StableAudioModel
    log(f"stable_audio_3 {getattr(stable_audio_3, '__version__', '?')}")
    log(f"StableAudioModel attrs: {[a for a in dir(StableAudioModel) if not a.startswith('_')]}")
    try:
        log(f"from_pretrained sig: {inspect.signature(StableAudioModel.from_pretrained)}")
    except Exception as e:
        log(f"(no from_pretrained sig: {e})")

    t0 = time.monotonic()
    log(f"loading model: {MODEL}")
    model = StableAudioModel.from_pretrained(MODEL, device="cuda")
    load_s = time.monotonic() - t0
    log(f"model loaded in {load_s:.1f}s")
    try:
        log(f"generate sig: {inspect.signature(model.generate)}")
    except Exception as e:
        log(f"(no generate sig: {e})")

    import torchaudio
    wav, in_sr = torchaudio.load(src)  # torchaudio -> (tensor, sr); mp3 via ffmpeg
    init_audio = (in_sr, wav)  # generate() wants (sample_rate, tensor)
    metrics = {"gpu": torch.cuda.get_device_name(0), "model": MODEL, "prompt": PROMPT,
               "sourceStem": stem_uri or "synthetic", "durationSeconds": DURATION,
               "steps": STEPS, "cfgScale": CFG, "modelLoadSeconds": round(load_s, 1), "runs": []}
    for noise in NOISE_LEVELS:
        torch.cuda.reset_peak_memory_stats()
        g0 = time.monotonic()
        audio = model.generate(init_audio=init_audio, init_noise_level=noise,
                               prompt=PROMPT, duration=DURATION, steps=STEPS,
                               cfg_scale=CFG, seed=1189)
        gen_s = round(time.monotonic() - g0, 2)
        vram = round(torch.cuda.max_memory_allocated() / 1e9, 2)
        tensor = audio[0] if audio.dim() == 3 else audio  # drop batch dim if present
        path = f"out_noise_{noise:.2f}.wav"
        torchaudio.save(path, tensor.detach().cpu().float(), SR)  # SA3 native 44.1kHz
        upload(path, path)
        metrics["runs"].append({"initNoiseLevel": noise, "outputFile": path,
                                "generationSeconds": gen_s, "peakVramGb": vram})
        log(f"noise={noise:.2f} -> {path} ({gen_s}s, peak {vram} GB)")

    with open("metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    upload("metrics.json", "metrics.json")
    log("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("FAILED — full traceback follows for API reconcile:")
        traceback.print_exc()
        raise
