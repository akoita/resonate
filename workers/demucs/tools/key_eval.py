"""Key-detection evaluation against labelled keys (#2016, #2018).

Dev tool, not used at runtime. Reproduces the tables in
docs/features/audio_features.md. Every variant loads audio at the native rate,
as production does, then derives its chroma from the same signal.

Datasets (public, downloaded separately):
  giantsteps  GiantSteps Key via mirdata (`pip install mirdata`), expert labels:
              python tools/key_eval.py giantsteps <mirdata data_home> out.json
  fma         FMA keys (zenodo.org/records/10719860): metadata CSV + one or more
              track archives unzipped under <dir>/t0/*/*.mp3; labels are
              Spotify key_and_mode, so they are estimates themselves:
              python tools/key_eval.py fma <dir> out.json [sample_size]

Extra dependencies beyond the worker image: mirdata (giantsteps only).
"""
import csv
import glob
import json
import math
import os
import random
import sys
from multiprocessing import Pool

import librosa
import numpy as np

TONICS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PROFILES = {
    "krumhansl": ([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
                  [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]),
    "temperley": ([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0],
                  [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0]),
    "albrecht": ([0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.080, 0.008, 0.081],
                 [0.220, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052]),
}


def estimate(chroma_mean, profile="krumhansl"):
    """Template matching identical to audio_features._estimate_key."""
    if float(np.max(chroma_mean)) <= 0 or float(np.std(chroma_mean)) == 0:
        return None
    major, minor = PROFILES[profile]
    scores = []
    for mode, prof in (("major", major), ("minor", minor)):
        arr = np.asarray(prof)
        for shift in range(12):
            corr = np.corrcoef(chroma_mean, np.roll(arr, shift))[0, 1]
            if math.isfinite(corr):
                scores.append((float(corr), TONICS[shift], mode))
    scores.sort(reverse=True)
    best, tonic, mode = scores[0]
    if best <= 0:
        return None
    return {"tonic": tonic, "mode": mode, "conf": max(0.0, best - scores[1][0]) / abs(best)}


THRESHOLD = 0.1
# Albrecht-Shanahan margins sit lower; production uses 0.05 for them (#2018).
ALBRECHT_THRESHOLD = 0.05


def cutoff(name):
    return ALBRECHT_THRESHOLD if "albrecht" in name else THRESHOLD
KEY_SR = 22050
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
ALIASES = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}


def pc(tonic):
    return NAMES.index(ALIASES.get(tonic, tonic))


def mirex(est, ref):
    """MIREX key score: same 1, fifth 0.5, relative 0.3, parallel 0.2, else 0."""
    if est is None:
        return 0.0
    et, em = pc(est[0]), est[1]
    rt, rm = pc(ref[0]), ref[1]
    if (et, em) == (rt, rm):
        return 1.0
    if em == rm and (et - rt) % 12 in (5, 7):
        return 0.5
    if em != rm:
        if rm == "major" and em == "minor" and et == (rt + 9) % 12:
            return 0.3
        if rm == "minor" and em == "major" and et == (rt + 3) % 12:
            return 0.3
        if et == rt:
            return 0.2
    return 0.0


def chromas(y, sr):
    y22 = librosa.resample(y, orig_sr=sr, target_sr=KEY_SR) if sr > KEY_SR else y
    s22 = min(sr, KEY_SR)
    h22 = librosa.effects.harmonic(y22, margin=3.0)
    return {
        "native_stft": librosa.feature.chroma_stft(y=y, sr=sr),
        "22k_hpss_stft": librosa.feature.chroma_stft(y=h22, sr=s22),
        "22k_hpss_cqt": librosa.feature.chroma_cqt(y=h22, sr=s22),
        "22k_stft": librosa.feature.chroma_stft(y=y22, sr=s22),
    }


VARIANTS = {
    "A production (native stft, krumhansl)": ("native_stft", "krumhansl"),
    "D #2017 (22k hpss stft, krumhansl)": ("22k_hpss_stft", "krumhansl"),
    "22k stft, krumhansl": ("22k_stft", "krumhansl"),
    "22k hpss stft, temperley": ("22k_hpss_stft", "temperley"),
    "22k hpss stft, albrecht": ("22k_hpss_stft", "albrecht"),
    "22k hpss cqt, krumhansl": ("22k_hpss_cqt", "krumhansl"),
    "22k hpss cqt, temperley": ("22k_hpss_cqt", "temperley"),
    "22k hpss cqt, albrecht": ("22k_hpss_cqt", "albrecht"),
}


def run(item):
    path, ref = item
    try:
        y, sr = librosa.load(path, sr=None, mono=True)
        ch = chromas(y, sr)
        out = {"path": os.path.basename(path), "ref": ref}
        for name, (ck, prof) in VARIANTS.items():
            e = estimate(np.mean(ch[ck], axis=1), prof)
            out[name] = None if e is None else [e["tonic"], e["mode"], e["conf"]]
        return out
    except Exception as exc:  # noqa: BLE001 - keep the batch going
        return {"path": os.path.basename(path), "error": str(exc)}


def ensemble(row):
    """D, but when production agrees on the key keep the higher confidence."""
    a = row["A production (native stft, krumhansl)"]
    d = row["D #2017 (22k hpss stft, krumhansl)"]
    if a and d and a[:2] == d[:2]:
        return [d[0], d[1], max(a[2], d[2])]
    return d


def report(rows):
    rows = [r for r in rows if "error" not in r]
    for r in rows:
        r["E ensemble (D, max conf when A agrees)"] = ensemble(r)
    names = list(VARIANTS) + ["E ensemble (D, max conf when A agrees)"]
    n = len(rows)
    print(f"tracks scored: {n}")
    print(f"{'method':42s} exact  mirex  covered  served-exact  served-mirex  served-compatible")
    for name in names:
        exact = sum(1 for r in rows if r[name] and mirex(r[name][:2], r["ref"]) == 1.0) / n
        mx = sum(mirex(r[name][:2] if r[name] else None, r["ref"]) for r in rows) / n
        served = [r for r in rows if r[name] and r[name][2] >= cutoff(name)]
        cov = len(served) / n
        if served:
            s_exact = sum(1 for r in served if mirex(r[name][:2], r["ref"]) == 1.0) / len(served)
            s_mx = sum(mirex(r[name][:2], r["ref"]) for r in served) / len(served)
            s_comp = sum(1 for r in served if mirex(r[name][:2], r["ref"]) >= 0.3) / len(served)
        else:
            s_exact = s_mx = s_comp = 0.0
        print(f"{name:42s} {exact:5.1%} {mx:6.3f}  {cov:6.1%}   {s_exact:9.1%}   {s_mx:10.3f}   {s_comp:12.1%}")


def giantsteps_items(data_home):
    import mirdata

    ds = mirdata.initialize("giantsteps_key", data_home=data_home)
    items = []
    for tid, track in ds.load_tracks().items():
        key = (track.key or "").strip()
        parts = key.split()
        # Labels may add a church mode ("F minor aeolian"); keep tonic + major/minor.
        if len(parts) < 2 or parts[1] not in ("major", "minor") or not os.path.exists(track.audio_path):
            continue
        items.append((track.audio_path, [parts[0], parts[1]]))
    return items


def run_excerpt(item):
    path, ref = item
    try:
        y, sr = librosa.load(path, sr=None, mono=True, offset=30.0, duration=120.0)
        if len(y) < sr * 20:
            return {"path": path, "error": "short"}
        ch = chromas(y, sr)
        out = {"path": os.path.basename(path), "ref": ref}
        for name, (ck, prof) in VARIANTS.items():
            e = estimate(np.mean(ch[ck], axis=1), prof)
            out[name] = None if e is None else [e["tonic"], e["mode"], e["conf"]]
        return out
    except Exception as exc:  # noqa: BLE001
        return {"path": path, "error": str(exc)}



def fma_items(base, sample):
    labels = {}
    for row in csv.DictReader(open(f"{base}/meta.csv")):
        tonic, mode = row["key_and_mode"].split()
        labels[int(row["track_id"])] = [tonic, mode.lower()]
    items = []
    for path in sorted(glob.glob(f"{base}/t0/*/*.mp3")):
        track_id = int(os.path.basename(path)[:-4])
        if track_id in labels:
            items.append((path, labels[track_id]))
    random.Random(2016).shuffle(items)
    return items[:sample]


if __name__ == "__main__":
    dataset, source, out = sys.argv[1], sys.argv[2], sys.argv[3]
    if dataset == "giantsteps":
        items, worker = giantsteps_items(source), run
    elif dataset == "fma":
        items, worker = fma_items(source, int(sys.argv[4]) if len(sys.argv) > 4 else 300), run_excerpt
    else:
        raise SystemExit("dataset must be giantsteps or fma")
    with Pool(int(os.environ.get("PROCS", "8"))) as pool:
        rows = pool.map(worker, items, chunksize=4)
    json.dump(rows, open(out, "w"))
    valid = set(NAMES) | set(ALIASES)
    rows = [r for r in rows if "error" not in r and r["ref"][0] in valid]
    report(rows)
