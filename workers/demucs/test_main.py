import asyncio
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("OUTPUT_DIR", tempfile.mkdtemp(prefix="resonate-demucs-test-"))

multipart_probe = types.ModuleType("python_multipart")
multipart_probe.__version__ = "0.0.13"
sys.modules.setdefault("python_multipart", multipart_probe)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import main


class DemucsCpuFallbackTest(unittest.TestCase):
    def test_cufft_runtime_error_is_cpu_retry_candidate(self):
        self.assertTrue(
            main.should_retry_demucs_on_cpu(
                "cuda",
                "RuntimeError: cuFFT error: CUFFT_INTERNAL_ERROR",
            )
        )

    def test_cpu_attempt_is_not_retried_again(self):
        self.assertFalse(
            main.should_retry_demucs_on_cpu(
                "cpu",
                "RuntimeError: cuFFT error: CUFFT_INTERNAL_ERROR",
            )
        )

    def test_non_gpu_demucs_error_does_not_retry_on_cpu(self):
        self.assertFalse(
            main.should_retry_demucs_on_cpu(
                "cuda",
                "RuntimeError: invalid audio stream",
            )
        )

    def test_device_override_can_force_cpu(self):
        with patch.object(main, "DEMUCS_DEVICE", "cpu"):
            self.assertEqual(main.demucs_devices_to_try(), ["cpu"])

    def test_run_demucs_separation_retries_cufft_failure_on_cpu(self):
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            input_path = temp_dir / "track_test.wav"
            input_path.write_bytes(b"fake wav")
            output_dir = temp_dir / "outputs"
            attempts = []

            async def fake_run_demucs_attempt(
                input_path: Path,
                temp_dir: str,
                device: str,
                release_id: str,
                track_id: str,
                callback_url=None,
            ):
                attempts.append(device)
                attempt_output_dir = Path(temp_dir) / f"demucs-{device}"
                if device == "cuda":
                    return 1, "RuntimeError: cuFFT error: CUFFT_INTERNAL_ERROR", attempt_output_dir

                demucs_output = attempt_output_dir / main.DEMUCS_MODEL / input_path.stem
                demucs_output.mkdir(parents=True)
                (demucs_output / "vocals.wav").write_bytes(b"fake separated stem")
                return 0, "", attempt_output_dir

            class FakeFfmpegProcess:
                returncode = 0

                async def wait(self):
                    return None

            async def fake_create_subprocess_exec(*args, **kwargs):
                Path(args[-1]).write_bytes(b"fake mp3")
                return FakeFfmpegProcess()

            with (
                patch.object(main, "STORAGE_MODE", "local"),
                patch.object(main, "OUTPUT_BASE_DIR", output_dir),
                patch.object(main, "demucs_devices_to_try", return_value=["cuda", "cpu"]),
                patch.object(main, "run_demucs_attempt", fake_run_demucs_attempt),
                patch.object(main.asyncio, "create_subprocess_exec", fake_create_subprocess_exec),
            ):
                result = asyncio.run(
                    main.run_demucs_separation(
                        input_path=input_path,
                        temp_dir=str(temp_dir),
                        release_id="rel_test",
                        track_id="trk_test",
                    )
                )

            self.assertEqual(attempts, ["cuda", "cpu"])
            self.assertEqual(result, {"vocals": "rel_test/trk_test/vocals.mp3"})

    def test_run_demucs_separation_fails_fast_for_non_runtime_error(self):
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            input_path = temp_dir / "track_test.wav"
            input_path.write_bytes(b"fake wav")
            attempts = []

            async def fake_run_demucs_attempt(
                input_path: Path,
                temp_dir: str,
                device: str,
                release_id: str,
                track_id: str,
                callback_url=None,
            ):
                attempts.append(device)
                return 1, "RuntimeError: invalid audio stream", Path(temp_dir) / f"demucs-{device}"

            with (
                patch.object(main, "STORAGE_MODE", "local"),
                patch.object(main, "OUTPUT_BASE_DIR", temp_dir / "outputs"),
                patch.object(main, "demucs_devices_to_try", return_value=["cuda", "cpu"]),
                patch.object(main, "run_demucs_attempt", fake_run_demucs_attempt),
            ):
                with self.assertRaisesRegex(RuntimeError, "Demucs processing failed on cuda"):
                    asyncio.run(
                        main.run_demucs_separation(
                            input_path=input_path,
                            temp_dir=str(temp_dir),
                            release_id="rel_test",
                            track_id="trk_test",
                        )
                    )

            self.assertEqual(attempts, ["cuda"])


if __name__ == "__main__":
    unittest.main()
