"""Tests for the stem audio feature extractor (#1184).

Fixtures are generated in-memory (numpy + soundfile, both librosa deps), so
no binary assets are committed. Requires the worker requirements installed.
"""

import math
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

# main.py creates OUTPUT_DIR at import time; keep tests inside a tmp dir.
os.environ.setdefault("OUTPUT_DIR", tempfile.mkdtemp(prefix="resonate-demucs-test-"))

from audio_features import SCHEMA_VERSION, extract_stem_features

SR = 22050


def _write_wav(path: Path, samples: np.ndarray, sr: int = SR) -> Path:
    sf.write(str(path), samples.astype(np.float32), sr)
    return path


def _click_track(bpm: float, seconds: float, sr: int = SR) -> np.ndarray:
    """Short noise bursts on every beat at the given tempo."""
    samples = np.zeros(int(seconds * sr), dtype=np.float32)
    interval = int(sr * 60.0 / bpm)
    burst = (np.random.default_rng(1184).standard_normal(256) * 0.8).astype(
        np.float32
    )
    for start in range(0, len(samples) - len(burst), interval):
        samples[start : start + len(burst)] += burst
    return samples


def _pitched_tone(freq: float, seconds: float, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    # Fundamental plus a couple of harmonics for a stable chroma signature.
    return (
        0.6 * np.sin(2 * np.pi * freq * t)
        + 0.25 * np.sin(2 * np.pi * 2 * freq * t)
        + 0.1 * np.sin(2 * np.pi * 3 * freq * t)
    ).astype(np.float32)


class ExtractStemFeaturesTest(unittest.TestCase):
    def test_click_track_tempo_within_tolerance(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_wav(Path(tmp) / "click.wav", _click_track(120.0, 8.0))
            features = extract_stem_features(path)

        self.assertEqual(features["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(features["extractor"]["name"], "librosa")
        self.assertAlmostEqual(features["durationSeconds"], 8.0, delta=0.1)
        self.assertEqual(features["sampleRate"], SR)
        # Beat trackers commonly lock onto a metrical level: accept 120
        # or its half/double-tempo octaves.
        self.assertIsNotNone(features["tempoBpm"])
        candidates = (60.0, 120.0, 240.0)
        self.assertTrue(
            any(abs(features["tempoBpm"] - bpm) <= 6.0 for bpm in candidates),
            f"tempo {features['tempoBpm']} not near any of {candidates}",
        )
        self.assertGreater(features["beatCount"], 0)
        self.assertGreaterEqual(features["firstBeatSec"], 0.0)
        self.assertGreater(features["onsetDensity"], 0.5)
        self.assertGreater(features["energyRms"], 0.0)
        if features["tempoConfidence"] is not None:
            self.assertGreaterEqual(features["tempoConfidence"], 0.0)
            self.assertLessEqual(features["tempoConfidence"], 1.0)

    def test_pitched_tone_key_tonic(self):
        with tempfile.TemporaryDirectory() as tmp:
            # C4 = 261.63 Hz
            path = _write_wav(Path(tmp) / "tone.wav", _pitched_tone(261.63, 4.0))
            features = extract_stem_features(path)

        self.assertIsNotNone(features["key"])
        self.assertEqual(features["key"]["tonic"], "C")
        self.assertIn(features["key"]["mode"], ("major", "minor"))
        self.assertTrue(0.0 <= features["key"]["confidence"] <= 1.0)

    def test_silence_returns_safe_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_wav(
                Path(tmp) / "silence.wav", np.zeros(SR * 2, dtype=np.float32)
            )
            features = extract_stem_features(path)

        self.assertEqual(features["schemaVersion"], SCHEMA_VERSION)
        self.assertIsNone(features["tempoBpm"])
        self.assertIsNone(features["key"])
        self.assertAlmostEqual(features["energyRms"] or 0.0, 0.0, delta=1e-5)

    def test_all_numeric_fields_are_json_safe(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_wav(Path(tmp) / "click.wav", _click_track(96.0, 5.0))
            features = extract_stem_features(path)

        import json

        encoded = json.dumps(features)
        decoded = json.loads(encoded)
        for key in ("tempoBpm", "energyRms", "onsetDensity", "durationSeconds"):
            value = decoded[key]
            if value is not None:
                self.assertTrue(math.isfinite(value), f"{key} not finite")


class AnalyzeEndpointTest(unittest.TestCase):
    def test_analyze_returns_features_for_uploaded_audio(self):
        from fastapi.testclient import TestClient

        import main

        client = TestClient(main.app)
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_wav(Path(tmp) / "clip.wav", _click_track(120.0, 4.0))
            with open(path, "rb") as audio:
                response = client.post(
                    "/analyze",
                    files={"file": ("clip.wav", audio, "audio/wav")},
                )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["features"]["schemaVersion"], SCHEMA_VERSION)
        self.assertIsNotNone(body["features"]["tempoBpm"])

    def test_analyze_neutralizes_path_traversal_filenames(self):
        """Client-controlled multipart filenames must never escape the temp
        dir (#1184 review): only the basename is used for the scratch file."""
        from fastapi.testclient import TestClient

        import main

        client = TestClient(main.app)
        escape_target = Path(tempfile.gettempdir()) / "resonate-1184-escape.wav"
        escape_target.unlink(missing_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            path = _write_wav(Path(tmp) / "clip.wav", _click_track(120.0, 2.0))
            with open(path, "rb") as audio:
                response = client.post(
                    "/analyze",
                    files={
                        "file": (
                            "../../../" + escape_target.name,
                            audio,
                            "audio/wav",
                        )
                    },
                )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            escape_target.exists(),
            "upload escaped the temporary directory",
        )


if __name__ == "__main__":
    unittest.main()
