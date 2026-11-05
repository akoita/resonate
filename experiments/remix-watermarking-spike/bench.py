#!/usr/bin/env python3
"""Remix watermark spike harness (#2572).

Embeds a token in each clean fixture (48 kHz PCM, as StemAudioMixer holds it
before the final encode), encodes the 320 kbit/s MP3 master the mixer ships,
then applies each attack, delivers it as MP3 128 kbit/s, cuts 30 s excerpts
and asks the detector for the token.

Schemes are adapters with embed(in_wav, out_wav, token) and
detect(path) -> (list_of_decoded_hex, extra). A trial succeeds when a decoded
payload equals the embedded token exactly (the RFC's database lookup rule).

Usage:
  bench.py robustness --scheme audiowmark --fixtures DIR --work DIR --out results.json
  bench.py falsepos  --scheme audiowmark --fixtures DIR --work DIR --out fp.json --count 1000
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import random
import secrets
import shutil
import subprocess
import time
from pathlib import Path

FF = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
NORM = "loudnorm=I=-14:LRA=11:TP=-1.5"
EXCERPT_S = 30
OFFSETS = [0.0, 11.3, 24.9]

# Each attack maps a 320k master (and the never-watermarked bed) to a WAV.
# Every attacked file is then delivered as MP3 128 kbit/s unless the attack is
# itself the codec step.
ATTACKS: dict[str, dict] = {
    "none (320k master)": {"af": None, "deliver": None},
    "mp3 128k": {"af": None, "deliver": ["-c:a", "libmp3lame", "-b:a", "128k"]},
    "mp3 64k": {"af": None, "deliver": ["-c:a", "libmp3lame", "-b:a", "64k"]},
    "aac 128k": {"af": None, "deliver": ["-c:a", "aac", "-b:a", "128k"], "ext": "m4a"},
    "resample 44.1k": {"af": "aresample=44100", "ar": "44100"},
    "-14 LUFS renorm": {"af": f"volume=-9dB,{NORM}"},
    "speed +5%": {"af": "asetrate=48000*1.05,aresample=48000"},
    "speed -5%": {"af": "asetrate=48000*0.95,aresample=48000"},
    "tempo +5% (pitch kept)": {"af": "atempo=1.05"},
    "tempo -5% (pitch kept)": {"af": "atempo=0.95"},
    "pitch +2 st": {"rubberband": "2"},
    "pitch -2 st": {"rubberband": "-2"},
    "under music -6 dB": {"mix": True},
}
DEFAULT_DELIVER = ["-c:a", "libmp3lame", "-b:a", "128k"]


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


# ---------------------------------------------------------------- schemes
class Audiowmark:
    name = "audiowmark"

    def __init__(self, binary: str, key: str, strength: float | None = None):
        self.bin, self.key, self.strength = binary, key, strength

    def new_token(self) -> str:
        return secrets.token_hex(16)  # 128 bits, opaque

    def embed(self, src: Path, dst: Path, token: str) -> None:
        cmd = [self.bin, "add", "--key", self.key]
        if self.strength:
            cmd += ["--strength", str(self.strength)]
        run(cmd + [str(src), str(dst), token])

    def _get(self, path: Path, speed: bool) -> list[str]:
        cmd = [self.bin, "get", "--key", self.key, str(path)]
        if speed:
            cmd.append("--detect-speed")
        out = subprocess.run(cmd, capture_output=True, text=True).stdout
        return [ln.split()[2] for ln in out.splitlines() if ln.startswith("pattern")]

    def detect(self, path: Path, wanted: set[str] | None) -> tuple[list[str], dict]:
        """Plain decode, then a --detect-speed retry when nothing matched the
        database (the order the #2575 admin detector would use)."""
        t0 = time.perf_counter()
        got = self._get(path, speed=False)
        extra = {"plain_s": round(time.perf_counter() - t0, 3), "speed_pass": False}
        if not wanted or not (set(got) & wanted):
            t1 = time.perf_counter()
            got += self._get(path, speed=True)
            extra.update(speed_pass=True, speed_s=round(time.perf_counter() - t1, 3))
        return got, extra


class AudioSeal:
    """16-bit message (AudioSeal's whole payload)."""

    name = "audioseal"

    def __init__(self):
        import torch  # noqa: F401  heavy import kept local
        from audioseal import AudioSeal as AS

        torch.set_num_threads(1)
        self.torch = torch
        self.gen = AS.load_generator("audioseal_wm_16bits")
        self.det = AS.load_detector("audioseal_detector_16bits")

    def new_token(self) -> str:
        return secrets.token_hex(2)  # 16 bits

    def _load(self, path: Path):
        import soundfile as sf

        tmp = path.with_suffix(".as16k.wav")
        run(FF + ["-i", str(path), "-ac", "1", "-ar", "16000", str(tmp)])
        data, _ = sf.read(tmp, dtype="float32")
        tmp.unlink()
        return self.torch.from_numpy(data)[None, None, :]

    def embed(self, src: Path, dst: Path, token: str) -> None:
        # AudioSeal runs at 16 kHz mono; add the 16 kHz watermark residual to
        # the full-band stereo mix so the music itself is not band-limited.
        import numpy as np
        import soundfile as sf

        x = self._load(src)
        bits = int(token, 16)
        msg = self.torch.tensor([[(bits >> (15 - i)) & 1 for i in range(16)]])
        with self.torch.no_grad():
            wm = self.gen.get_watermark(x, 16000, message=msg)[0, 0].numpy()
        res = dst.with_suffix(".res.wav")
        sf.write(res, wm, 16000, subtype="FLOAT")
        run(FF + ["-i", str(src), "-i", str(res), "-filter_complex",
                  "[1]aresample=48000,pan=stereo|c0=c0|c1=c0[r];[0][r]amix=inputs=2:normalize=0",
                  "-c:a", "pcm_s24le", str(dst)])
        res.unlink()
        _ = np

    def detect(self, path: Path, wanted: set[str] | None) -> tuple[list[str], dict]:
        x = self._load(path)
        t0 = time.perf_counter()
        with self.torch.no_grad():
            prob, msg = self.det.detect_watermark(x, 16000)
        bits = msg[0].int().tolist()
        token = f"{sum(b << (15 - i) for i, b in enumerate(bits)):04x}"
        return ([token] if prob >= 0.5 else []), {
            "plain_s": round(time.perf_counter() - t0, 3), "prob": round(float(prob), 3)}


def make_scheme(args):
    if args.scheme == "audiowmark":
        return Audiowmark(args.audiowmark, args.key, args.strength)
    return AudioSeal()


# ---------------------------------------------------------------- pipeline
def attack(master: Path, bed: Path, name: str, out_dir: Path) -> Path:
    spec = ATTACKS[name]
    stem = name.replace(" ", "_").replace("%", "pct").replace("(", "").replace(")", "")
    mid = out_dir / f"{stem}.mid.wav"
    if spec.get("rubberband"):
        run(FF + ["-i", str(master), str(mid.with_suffix(".in.wav"))])
        run(["rubberband", "-q", "-p", spec["rubberband"], str(mid.with_suffix(".in.wav")), str(mid)])
        mid.with_suffix(".in.wav").unlink()
    elif spec.get("mix"):
        run(FF + ["-i", str(master), "-i", str(bed), "-filter_complex",
                  "[0]volume=-6dB[a];[a][1]amix=inputs=2:normalize=0," + NORM, str(mid)])
    else:
        cmd = FF + ["-i", str(master)]
        if spec.get("af"):
            cmd += ["-af", spec["af"]]
        run(cmd + [str(mid)])
    deliver = spec.get("deliver", DEFAULT_DELIVER)
    if "deliver" in spec and spec["deliver"] is None:
        return mid
    out = out_dir / f"{stem}.{spec.get('ext', 'mp3')}"
    run(FF + ["-i", str(mid)] + (["-ar", spec["ar"]] if spec.get("ar") else []) + deliver + [str(out)])
    mid.unlink()
    return out


def excerpt(src: Path, offset: float, dst: Path) -> Path:
    # Re-encode the excerpt losslessly so the cut is sample-accurate and adds
    # no extra codec generation of its own.
    run(FF + ["-ss", str(offset), "-t", str(EXCERPT_S), "-i", str(src), "-c:a", "pcm_s16le", str(dst)])
    return dst


def snr_db(ref: Path, test: Path) -> float:
    import numpy as np
    import soundfile as sf

    a, _ = sf.read(ref, dtype="float64")
    b, _ = sf.read(test, dtype="float64")
    n = min(len(a), len(b))
    noise = b[:n] - a[:n]
    return float(10 * np.log10(np.sum(a[:n] ** 2) / max(np.sum(noise ** 2), 1e-20)))


def robustness(args) -> None:
    scheme = make_scheme(args)
    fx = Path(args.fixtures)
    work = Path(args.work) / scheme.name
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    bed = fx / "other" / "bed.wav"
    fixtures = sorted((fx / "clean").glob("*.wav"))
    embedded: dict[str, dict] = {}
    for f in fixtures:
        tok = scheme.new_token()
        d = work / f.stem
        d.mkdir()
        wm = d / "wm.wav"
        t0 = time.perf_counter()
        scheme.embed(f, wm, tok)
        embed_s = time.perf_counter() - t0
        master = d / "master.mp3"
        run(FF + ["-i", str(wm), "-c:a", "libmp3lame", "-b:a", "320k", str(master)])
        dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                         "csv=p=0", str(f)]).stdout)
        embedded[f.stem] = {"token": tok, "embed_s": round(embed_s, 3),
                            "embed_s_per_min": round(embed_s / dur * 60, 3),
                            "snr_db": round(snr_db(f, wm), 2), "dir": str(d)}
        print(f"embedded {f.stem} snr={embedded[f.stem]['snr_db']} t={embed_s:.2f}s", flush=True)

    wanted_all = {e["token"] for e in embedded.values()}

    def trial(fx_name: str, att: str):
        d = Path(embedded[fx_name]["dir"])
        attacked = attack(d / "master.mp3", bed, att, d)
        rows = []
        for off in OFFSETS:
            ex = excerpt(attacked, off, d / f"{attacked.stem}.ex{off}.wav")
            t0 = time.perf_counter()
            got, extra = scheme.detect(ex, wanted_all)
            rows.append({"fixture": fx_name, "attack": att, "offset": off,
                         "hit": embedded[fx_name]["token"] in got,
                         "wrong_token": bool((set(got) & wanted_all) - {embedded[fx_name]["token"]}),
                         "detect_s": round(time.perf_counter() - t0, 3), **extra})
            ex.unlink()
        return rows

    jobs = [(f.stem, a) for f in fixtures for a in ATTACKS]
    results = []
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for rows in ex.map(lambda j: trial(*j), jobs):
            results += rows
            r = rows[0]
            print(f"{r['fixture']:>24} {r['attack']:<24} {sum(x['hit'] for x in rows)}/{len(rows)}", flush=True)

    summary = {}
    for att in ATTACKS:
        rs = [r for r in results if r["attack"] == att]
        summary[att] = {"hits": sum(r["hit"] for r in rs), "trials": len(rs),
                        "wrong_token": sum(r["wrong_token"] for r in rs),
                        "median_detect_s": sorted(r["detect_s"] for r in rs)[len(rs) // 2]}
    Path(args.out).write_text(json.dumps({"scheme": scheme.name, "strength": getattr(scheme, "strength", None),
                                          "embedded": embedded, "summary": summary,
                                          "trials": results}, indent=1))
    print(json.dumps(summary, indent=1))


def falsepos(args) -> None:
    """Decode never-watermarked 30 s clips and look every decoded payload up
    in a token database (the embedded tokens + args.db random tokens)."""
    scheme = make_scheme(args)
    fx = Path(args.fixtures)
    work = Path(args.work) / f"fp-{scheme.name}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    rng = random.Random(2572)
    db = {scheme.new_token() for _ in range(args.db)}
    sources = sorted((fx / "clean").glob("*.wav")) + sorted((fx / "unmarked").glob("*.wav"))
    bed = fx / "other" / "bed.wav"
    atts = list(ATTACKS)
    plan = [(sources[i % len(sources)], atts[(i // len(sources)) % len(atts)],
             round(rng.uniform(0, 29), 2), i) for i in range(args.count)]

    def one(p):
        src, att, off, i = p
        d = work / str(i)
        d.mkdir()
        master = d / "master.mp3"
        run(FF + ["-i", str(src), "-c:a", "libmp3lame", "-b:a", "320k", str(master)])
        ex = excerpt(attack(master, bed, att, d), off, d / "ex.wav")
        got, extra = scheme.detect(ex, db)
        shutil.rmtree(d)
        return {"src": src.stem, "attack": att, "offset": off, "decoded": len(got),
                "db_matches": sorted(set(got) & db), **extra}

    rows = []
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for n, r in enumerate(ex.map(one, plan), 1):
            rows.append(r)
            if n % 100 == 0:
                print(f"{n}/{len(plan)} fp so far={sum(bool(x['db_matches']) for x in rows)}", flush=True)
    out = {"scheme": scheme.name, "clips": len(rows), "db_size": len(db),
           "false_positives": sum(bool(r["db_matches"]) for r in rows),
           "clips_with_any_decoded_payload": sum(r["decoded"] > 0 for r in rows), "rows": rows}
    Path(args.out).write_text(json.dumps(out, indent=1))
    print({k: v for k, v in out.items() if k != "rows"})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["robustness", "falsepos"])
    ap.add_argument("--scheme", choices=["audiowmark", "audioseal"], required=True)
    ap.add_argument("--fixtures", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--audiowmark", default=shutil.which("audiowmark") or "audiowmark")
    ap.add_argument("--key", default=os.environ.get("WM_KEY_FILE"))
    ap.add_argument("--strength", type=float)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    ap.add_argument("--count", type=int, default=1000)
    ap.add_argument("--db", type=int, default=10000)
    a = ap.parse_args()
    robustness(a) if a.mode == "robustness" else falsepos(a)
