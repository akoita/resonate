"""Stem audio feature extraction (#1184, slice 1 of #1182).

Measured musical features per stem: tempo, beat anchors, key, energy, onset
density. These ground later remix-generation slices (feature-conditioned
prompts, render alignment) in the actual audio instead of prompt text alone.

Build verdict per docs/rfc/remix-audio-grounding-build-vs-buy.md: in-house
librosa, no third-party analysis APIs — the worker already holds the stem
audio, and it never leaves our boundary.

Chord progressions, full beat grids, and song structure are v2 (#1182).
"""

import logging
import math
from pathlib import Path
from typing import Optional, Union

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "stem-audio-features/v1"

# Krumhansl-Schmuckler key profiles (major/minor pitch-class weightings).
KRUMHANSL_MAJOR = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
]
KRUMHANSL_MINOR = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
]
TONICS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _finite(value: Optional[float]) -> Optional[float]:
    """JSON-safe number: plain python float, or None for NaN/inf."""
    if value is None:
        return None
    value = float(value)
    if not math.isfinite(value):
        return None
    return value


def _estimate_key(chroma_mean) -> Optional[dict]:
    """Krumhansl-style template matching over the mean chroma vector.

    Confidence is the relative margin between the best and second-best
    template correlation, bounded to [0, 1]. Flat/silent chroma yields None.
    """
    import numpy as np

    if float(np.max(chroma_mean)) <= 0 or float(np.std(chroma_mean)) == 0:
        return None

    scores = []
    for mode, profile in (("major", KRUMHANSL_MAJOR), ("minor", KRUMHANSL_MINOR)):
        profile_arr = np.asarray(profile)
        for shift in range(12):
            rotated = np.roll(profile_arr, shift)
            corr = np.corrcoef(chroma_mean, rotated)[0, 1]
            if math.isfinite(corr):
                scores.append((float(corr), TONICS[shift], mode))
    if not scores:
        return None

    scores.sort(reverse=True)
    best_score, tonic, mode = scores[0]
    second_score = scores[1][0] if len(scores) > 1 else 0.0
    if best_score <= 0:
        return None
    margin = max(0.0, best_score - second_score) / abs(best_score)
    return {
        "tonic": tonic,
        "mode": mode,
        "confidence": round(min(1.0, max(0.0, margin)), 4),
    }


def extract_stem_features(path: Union[str, Path]) -> dict:
    """Pure extraction: one audio file in, one JSON-safe feature dict out.

    Callers own failure policy — this function may raise on unreadable
    audio; silent or degenerate audio returns the schema with null fields
    instead of raising.
    """
    import librosa
    import numpy as np

    y, sr = librosa.load(str(path), sr=None, mono=True)
    duration = float(len(y)) / float(sr) if sr else 0.0

    features: dict = {
        "schemaVersion": SCHEMA_VERSION,
        "extractor": {"name": "librosa", "version": str(librosa.__version__)},
        "sampleRate": int(sr),
        "durationSeconds": _finite(round(duration, 3)),
        "tempoBpm": None,
        "tempoConfidence": None,
        "beatCount": None,
        "firstBeatSec": None,
        "key": None,
        "energyRms": None,
        "onsetDensity": None,
    }

    if len(y) == 0 or duration <= 0:
        return features

    rms = _finite(float(np.mean(librosa.feature.rms(y=y))))
    features["energyRms"] = round(rms, 6) if rms is not None else None

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_mean = float(np.mean(onset_env)) if onset_env.size else 0.0

    if onset_mean > 0:
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env, sr=sr,
        )
        tempo = _finite(float(np.atleast_1d(tempo)[0]))
        if tempo and tempo > 0:
            features["tempoBpm"] = round(tempo, 2)
            beat_times = librosa.frames_to_time(beat_frames, sr=sr)
            features["beatCount"] = int(len(beat_times))
            if len(beat_times):
                features["firstBeatSec"] = round(float(beat_times[0]), 3)
            # Heuristic, clearly bounded: librosa's tracker has no native
            # confidence. Beats landing on strong onsets relative to the
            # average onset strength → ratio mapped into (0, 1).
            if len(beat_frames):
                valid = beat_frames[beat_frames < len(onset_env)]
                if valid.size:
                    beat_strength = float(np.mean(onset_env[valid]))
                    ratio = beat_strength / (onset_mean + 1e-9)
                    confidence = _finite(ratio / (1.0 + ratio))
                    if confidence is not None:
                        features["tempoConfidence"] = round(confidence, 4)

        onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
        density = _finite(float(len(onsets)) / duration)
        features["onsetDensity"] = round(density, 4) if density is not None else None

        chroma = librosa.feature.chroma_stft(y=y, sr=sr)
        features["key"] = _estimate_key(np.mean(chroma, axis=1))

    return features
