#!/usr/bin/env python3
"""Blind A/B listening kit for the remix watermark spike (#2572).

For each clean fixture, writes <n>-A.mp3 and <n>-B.mp3 (320 kbit/s, as the
mixer ships them). One is the original mix, the other the watermarked mix, in a
random order recorded only in answers.json. A listener marks which file of
each pair they think carries the watermark; scoring near 50 % means it is not
audible.

  make_abx_kit.py --fixtures FX --audiowmark BIN --key KEY --out KIT [--strength 10]
"""
import argparse
import json
import random
import secrets
import subprocess
from pathlib import Path

FF = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]

ap = argparse.ArgumentParser()
ap.add_argument("--fixtures", required=True)
ap.add_argument("--audiowmark", required=True)
ap.add_argument("--key", required=True)
ap.add_argument("--strength", default="10")
ap.add_argument("--out", required=True)
a = ap.parse_args()
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
answers = {}
for n, f in enumerate(sorted(Path(a.fixtures, "clean").glob("*.wav")), 1):
    wm = out / f"_{n}.wm.wav"
    subprocess.run([a.audiowmark, "add", "--key", a.key, "--strength", a.strength,
                    str(f), str(wm), secrets.token_hex(16)], check=True, capture_output=True)
    marked_is_a = random.SystemRandom().random() < 0.5
    pair = (wm, f) if marked_is_a else (f, wm)
    for label, src in zip("AB", pair):
        subprocess.run(FF + ["-i", str(src), "-c:a", "libmp3lame", "-b:a", "320k",
                             str(out / f"{n:02d}-{label}.mp3")], check=True)
    wm.unlink()
    answers[f"{n:02d}"] = {"fixture": f.stem, "watermarked": "A" if marked_is_a else "B"}
(out / "answers.json").write_text(json.dumps(answers, indent=1))
print(f"wrote {len(answers)} pairs to {out} (answers.json is the key: do not open before listening)")
