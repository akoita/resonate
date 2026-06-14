#!/usr/bin/env python3
"""Stable Audio 3 audio-conditioning spike harness (#1193, gate 1).

THROWAWAY EVALUATION CODE — not production. Maps a real Resonate stem to
Stable Audio 3 Medium's audio-to-audio path across an init_noise_level sweep,
captures latency + peak VRAM, and writes comparison clips for human judgment.

It answers the only question the spike exists to answer:
  Does Stable Audio 3, conditioned on a licensed stem, produce a draft that
  stays musically recognizable as the source while applying the prompt —
  i.e. a real "variation/extension of THIS audio", not a fresh track?

The numbers (latency/VRAM) come out automatically; the quality verdict is a
human listening to outputs/ against the rubric in README.md.

API note: this is written against Stability's documented inference snippets
(stable_audio_3.StableAudioModel.generate(init_audio=..., init_noise_level=...,
prompt=..., duration=...)). The exact return shape / save call may differ in
the installed package — the two clearly-marked spots below are the only
things to reconcile against the live repo when you run it.
"""

import argparse
import json
import time
from pathlib import Path


def log(msg: str) -> None:
    print(f"[spike] {msg}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Stable Audio 3 conditioning spike")
    parser.add_argument("--stem", required=True, help="Path to a source stem (wav/mp3)")
    parser.add_argument(
        "--prompt",
        default="darker halftime variation, keep the groove",
        help="Style prompt applied on top of the source audio",
    )
    parser.add_argument(
        "--noise-levels",
        nargs="+",
        type=float,
        default=[0.3, 0.5, 0.7, 0.9],
        help="init_noise_level sweep: low = close variation, high = looser",
    )
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--seed", type=int, default=1189)
    parser.add_argument("--out", default="outputs")
    args = parser.parse_args()

    try:
        import torch
        import torchaudio
        from stable_audio_3 import StableAudioModel
    except ImportError as exc:  # pragma: no cover - environment guard
        log(f"Missing dependency: {exc}. See README.md for setup.")
        return 2

    if not torch.cuda.is_available():
        log("CUDA not available — Stable Audio 3 Medium needs a CUDA GPU.")
        return 2

    stem_path = Path(args.stem)
    if not stem_path.exists():
        log(f"Stem not found: {stem_path}")
        return 2

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    device = "cuda"
    gpu_name = torch.cuda.get_device_name(0)
    log(f"GPU: {gpu_name}")

    torch.cuda.reset_peak_memory_stats()
    load_start = time.monotonic()
    model = StableAudioModel.from_pretrained("medium", device=device)
    load_seconds = round(time.monotonic() - load_start, 2)
    load_vram_gb = round(torch.cuda.max_memory_allocated() / 1e9, 2)
    log(f"Model loaded in {load_seconds}s, {load_vram_gb} GB VRAM")

    # --- reconcile-against-live-package spot #1: loading the reference audio.
    # Documented snippet uses torchaudio.load(path) -> (tensor, sample_rate)
    # and passes the tuple straight to generate(init_audio=...).
    init_audio = torchaudio.load(str(stem_path))

    metrics = {
        "gpu": gpu_name,
        "stem": str(stem_path),
        "prompt": args.prompt,
        "duration": args.duration,
        "steps": args.steps,
        "seed": args.seed,
        "modelLoadSeconds": load_seconds,
        "modelLoadVramGb": load_vram_gb,
        "runs": [],
    }

    for noise in args.noise_levels:
        torch.cuda.reset_peak_memory_stats()
        gen_start = time.monotonic()
        audio = model.generate(
            init_audio=init_audio,
            init_noise_level=noise,
            prompt=args.prompt,
            duration=args.duration,
            steps=args.steps,
            seed=args.seed,
        )
        gen_seconds = round(time.monotonic() - gen_start, 2)
        peak_vram_gb = round(torch.cuda.max_memory_allocated() / 1e9, 2)

        out_path = out_dir / f"noise_{noise:.2f}.wav"
        # --- reconcile-against-live-package spot #2: saving the result.
        # If generate() returns (tensor, sample_rate), unpack accordingly;
        # the documented examples save with torchaudio.save(path, tensor, sr).
        sample_rate = 44100
        tensor = audio
        if isinstance(audio, tuple) and len(audio) == 2:
            tensor, sample_rate = audio
        torchaudio.save(str(out_path), tensor.detach().cpu(), sample_rate)

        log(
            f"noise={noise:.2f} -> {out_path.name} "
            f"({gen_seconds}s, peak {peak_vram_gb} GB)"
        )
        metrics["runs"].append(
            {
                "initNoiseLevel": noise,
                "outputFile": out_path.name,
                "generationSeconds": gen_seconds,
                "peakVramGb": peak_vram_gb,
            }
        )

    metrics_path = out_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2))
    log(f"Wrote {metrics_path}. Now listen to {out_dir}/ against the rubric.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
