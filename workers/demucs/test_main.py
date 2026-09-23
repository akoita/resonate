import asyncio
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("OUTPUT_DIR", tempfile.mkdtemp(prefix="resonate-demucs-test-"))

# Shim only when the real package is absent: faking it while the real one is
# installed breaks starlette's `python_multipart.multipart` import.
try:
    import python_multipart  # noqa: F401
except ModuleNotFoundError:
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

    def test_cuda_attempt_retries_cpu_for_any_demucs_failure(self):
        self.assertTrue(
            main.should_retry_demucs_on_cpu(
                "cuda",
                "RuntimeError: invalid audio stream",
            )
        )

    def test_cpu_attempt_hides_cuda_from_subprocess(self):
        env = main.demucs_attempt_env("cpu")
        self.assertEqual(env["CUDA_VISIBLE_DEVICES"], "")
        self.assertEqual(env["NVIDIA_VISIBLE_DEVICES"], "")

    def test_cuda_attempt_keeps_runtime_environment(self):
        with patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": "0", "NVIDIA_VISIBLE_DEVICES": "all"}):
            env = main.demucs_attempt_env("cuda")
        self.assertEqual(env["CUDA_VISIBLE_DEVICES"], "0")
        self.assertEqual(env["NVIDIA_VISIBLE_DEVICES"], "all")

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
                audio_revision=None,
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
                results, stem_features = asyncio.run(
                    main.run_demucs_separation(
                        input_path=input_path,
                        temp_dir=str(temp_dir),
                        release_id="rel_test",
                        track_id="trk_test",
                    )
                )

            self.assertEqual(attempts, ["cuda", "cpu"])
            self.assertEqual(results, {"vocals": "rel_test/trk_test/vocals.mp3"})
            # The fake stem is not decodable audio: feature extraction must
            # degrade to None for that stem without failing separation (#1184).
            self.assertEqual(stem_features, {"vocals": None})


class AudioRevisionTest(unittest.TestCase):
    REVISION_ONE = "11111111-1111-4111-8111-111111111111"
    REVISION_TWO = "22222222-2222-4222-8222-222222222222"

    def test_audio_revision_validation_rejects_unsafe_values(self):
        self.assertIsNone(main.validate_audio_revision(None))
        self.assertEqual(
            main.validate_audio_revision(self.REVISION_ONE), self.REVISION_ONE
        )
        for unsafe in ("../../escape", "not-a-uuid", "", 123, {"id": "x"}):
            with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                main.validate_audio_revision(unsafe)
        with self.assertRaises(ValueError):
            main.local_stem_directory(
                Path("/outputs"), "../escape", "trk_test", self.REVISION_ONE
            )

    def test_audio_mime_types_keep_the_source_file_suffix(self):
        self.assertEqual(main.audio_file_extension("audio/mpeg"), ".mp3")
        self.assertEqual(main.audio_file_extension("audio/flac"), ".flac")
        self.assertEqual(main.audio_file_extension("audio/wav"), ".wav")
        self.assertEqual(main.audio_file_extension("audio/flac; codecs=lossless"), ".flac")

    def test_output_namespaces_isolate_revisions_and_preserve_legacy_paths(self):
        base_dir = Path("/outputs")
        first_dir = main.local_stem_directory(
            base_dir, "rel_test", "trk_test", self.REVISION_ONE
        )
        second_dir = main.local_stem_directory(
            base_dir, "rel_test", "trk_test", self.REVISION_TWO
        )

        self.assertEqual(first_dir, base_dir / "rel_test" / "trk_test" / self.REVISION_ONE)
        self.assertNotEqual(first_dir, second_dir)
        self.assertEqual(
            main.gcs_stem_key("rel_test", "trk_test", "vocals.mp3", self.REVISION_ONE),
            f"stems/rel_test/trk_test/{self.REVISION_ONE}/vocals.mp3",
        )
        self.assertEqual(
            main.local_stem_uri("rel_test", "trk_test", "vocals.mp3", self.REVISION_ONE),
            f"rel_test/trk_test/{self.REVISION_ONE}/vocals.mp3",
        )

        # Tokenless jobs keep the path shape used by existing workers.
        self.assertEqual(
            main.local_stem_directory(base_dir, "rel_test", "trk_test"),
            base_dir / "rel_test" / "trk_test",
        )
        self.assertEqual(
            main.gcs_stem_key("rel_test", "trk_test", "vocals.mp3"),
            "stems/rel_test/trk_test/vocals.mp3",
        )
        self.assertEqual(
            main.local_stem_uri("rel_test", "trk_test", "vocals.mp3"),
            "rel_test/trk_test/vocals.mp3",
        )

    def test_http_separate_accepts_optional_revision_and_echoes_it(self):
        seen_revisions = []

        async def fake_run_demucs_separation(
            input_path,
            temp_dir,
            release_id,
            track_id,
            callback_url=None,
            audio_revision=None,
        ):
            seen_revisions.append(audio_revision)
            return {"vocals": "rel_test/trk_test/vocals.mp3"}, {}

        operation = main.app.openapi()["paths"]["/separate/{release_id}/{track_id}"]["post"]
        query_parameters = {parameter["name"]: parameter for parameter in operation["parameters"]}
        self.assertEqual(query_parameters["audioRevision"]["in"], "query")

        fake_file = types.SimpleNamespace(filename="track.wav")
        with (
            patch.object(main, "save_upload_capped"),
            patch.object(main, "run_demucs_separation", fake_run_demucs_separation),
        ):
            tokenized = asyncio.run(
                main.separate_audio(
                    "rel_test", "trk_test", fake_file, None, self.REVISION_ONE
                )
            )
            legacy = asyncio.run(
                main.separate_audio("rel_test", "trk_test", fake_file, None, None)
            )
            with self.assertRaises(main.HTTPException) as error:
                asyncio.run(
                    main.separate_audio(
                        "rel_test", "trk_test", fake_file, None, "not-a-uuid"
                    )
                )

        self.assertEqual(tokenized["audioRevision"], self.REVISION_ONE)
        self.assertNotIn("audioRevision", legacy)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(seen_revisions, [self.REVISION_ONE, None])

    def test_progress_callback_includes_audio_revision(self):
        callback_payloads = []

        class FakeStdout:
            async def readline(self):
                return b""

        class FakeStderr:
            def __init__(self):
                self.chunks = [b"42%|", b""]

            async def read(self, _size):
                return self.chunks.pop(0)

        class FakeProcess:
            returncode = 0
            stdout = FakeStdout()
            stderr = FakeStderr()

            async def wait(self):
                return None

        async def fake_create_subprocess_exec(*_args, **_kwargs):
            return FakeProcess()

        class FakeAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, _url, json=None, **_kwargs):
                callback_payloads.append(json)

        with (
            tempfile.TemporaryDirectory() as temp_dir,
            patch.object(main.asyncio, "create_subprocess_exec", fake_create_subprocess_exec),
            patch.object(main.httpx, "AsyncClient", FakeAsyncClient),
        ):
            asyncio.run(
                main.run_demucs_attempt(
                    Path(temp_dir) / "track.wav",
                    temp_dir,
                    "cpu",
                    "rel_test",
                    "trk_test",
                    "http://backend",
                    self.REVISION_ONE,
                )
            )

        self.assertEqual(
            callback_payloads,
            [{"progress": 42, "audioRevision": self.REVISION_ONE}],
        )

    def test_fingerprint_callback_includes_audio_revision(self):
        captured = {}

        class FakeResponse:
            status_code = 200
            text = ""

            def json(self):
                return {"quarantined": False}

        class FakeAsyncClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, url, json=None, **_kwargs):
                captured["url"] = url
                captured["payload"] = json
                return FakeResponse()

        with patch.object(main.httpx, "AsyncClient", FakeAsyncClient):
            result = asyncio.run(
                main.submit_fingerprint(
                    "http://backend",
                    "rel_test",
                    "trk_test",
                    1.25,
                    "123,456",
                    "fingerprint-hash",
                    self.REVISION_ONE,
                )
            )

        self.assertEqual(result, {"quarantined": False})
        self.assertEqual(
            captured["payload"]["audioRevision"], self.REVISION_ONE
        )

    def test_pubsub_completed_and_quarantined_results_echo_audio_revision(self):
        published = []

        class FakeFuture:
            def result(self):
                return "message-id"

        class FakePublisher:
            def topic_path(self, project, topic):
                return f"{project}/{topic}"

            def publish(self, _topic_path, data, **_attributes):
                published.append(json.loads(data))
                return FakeFuture()

        fake_google = types.ModuleType("google")
        fake_google.__path__ = []
        fake_cloud = types.ModuleType("google.cloud")
        fake_cloud.__path__ = []
        fake_pubsub = types.ModuleType("google.cloud.pubsub_v1")
        fake_pubsub.PublisherClient = FakePublisher
        fake_cloud.pubsub_v1 = fake_pubsub
        fake_google.cloud = fake_cloud

        downloaded_suffixes = []

        async def fake_download(_uri, dest_path):
            downloaded_suffixes.append(dest_path.suffix)
            dest_path.write_bytes(b"fake audio")

        for quarantined in (False, True):
            with self.subTest(quarantined=quarantined):
                published.clear()
                downloaded_suffixes.clear()

                async def fake_submit_fingerprint(*args, **kwargs):
                    self.assertEqual(args[-1], self.REVISION_ONE)
                    return {"quarantined": quarantined, "reason": "duplicate"}

                async def fake_run_demucs_separation(*_args, **kwargs):
                    self.assertEqual(kwargs["audio_revision"], self.REVISION_ONE)
                    return {"vocals": "rel_test/trk_test/vocals.mp3"}, {}

                with (
                    patch.dict(
                        sys.modules,
                        {
                            "google": fake_google,
                            "google.cloud": fake_cloud,
                            "google.cloud.pubsub_v1": fake_pubsub,
                        },
                    ),
                    patch.object(main, "download_audio", fake_download),
                    patch.object(main, "generate_fingerprint", return_value=(2.0, "raw", "hash")),
                    patch.object(main, "submit_fingerprint", fake_submit_fingerprint),
                    patch.object(main, "run_demucs_separation", fake_run_demucs_separation),
                ):
                    asyncio.run(
                        main.process_pubsub_message(
                            {
                                "jobId": "job_test",
                                "releaseId": "rel_test",
                                "trackId": "trk_test",
                                "originalStemUri": "https://example.test/audio.flac",
                                "mimeType": "audio/flac",
                                "audioRevision": self.REVISION_ONE,
                                "callbackUrl": "http://backend",
                                "originalStemMeta": {
                                    "mimeType": "audio/flac",
                                    "storageProvider": "gcs",
                                },
                            }
                        )
                    )

                self.assertEqual(len(published), 1)
                self.assertEqual(published[0]["audioRevision"], self.REVISION_ONE)
                self.assertEqual(downloaded_suffixes, [".flac"])
                if quarantined:
                    self.assertEqual(published[0]["status"], "quarantined")
                else:
                    self.assertEqual(published[0]["status"], "completed")
                    self.assertEqual(
                        published[0]["originalStemMeta"]["mimeType"], "audio/flac"
                    )

    def test_failed_result_echoes_audio_revision(self):
        published = []

        class FakeFuture:
            def result(self):
                return "message-id"

        class FakePublisher:
            def topic_path(self, project, topic):
                return f"{project}/{topic}"

            def publish(self, _topic_path, data, **_attributes):
                published.append(json.loads(data))
                return FakeFuture()

        fake_google = types.ModuleType("google")
        fake_google.__path__ = []
        fake_cloud = types.ModuleType("google.cloud")
        fake_cloud.__path__ = []
        fake_pubsub = types.ModuleType("google.cloud.pubsub_v1")
        fake_pubsub.PublisherClient = FakePublisher
        fake_cloud.pubsub_v1 = fake_pubsub
        fake_google.cloud = fake_cloud

        with patch.dict(
            sys.modules,
            {
                "google": fake_google,
                "google.cloud": fake_cloud,
                "google.cloud.pubsub_v1": fake_pubsub,
            },
        ):
            self.assertTrue(
                main.publish_failure_result(
                    {
                        "jobId": "job_test",
                        "releaseId": "rel_test",
                        "trackId": "trk_test",
                        "audioRevision": self.REVISION_ONE,
                    },
                    RuntimeError("separation failed"),
                )
            )

        self.assertEqual(published[0]["status"], "failed")
        self.assertEqual(published[0]["audioRevision"], self.REVISION_ONE)

    def test_consumer_nacks_input_when_failure_result_publish_is_rejected(self):
        result_calls = []

        class FakeFuture:
            def result(self):
                result_calls.append(True)
                raise RuntimeError("Pub/Sub rejected the message")

        class FakePublisher:
            def topic_path(self, project, topic):
                return f"{project}/{topic}"

            def publish(self, *_args, **_kwargs):
                return FakeFuture()

        class FakeMessage:
            data = json.dumps({
                "jobId": "job_test",
                "releaseId": "rel_test",
                "trackId": "trk_test",
                "audioRevision": self.REVISION_ONE,
            }).encode("utf-8")

            def __init__(self):
                self.acks = 0
                self.nacks = 0

            def ack(self):
                self.acks += 1

            def nack(self):
                self.nacks += 1

        message = FakeMessage()

        class FakeStreamingPullFuture:
            def result(self):
                return None

        class FakeSubscriber:
            def subscription_path(self, *_args):
                return "project/subscription"

            def subscribe(self, _subscription_path, callback, **_kwargs):
                callback(message)
                return FakeStreamingPullFuture()

        class FakeFlowControl:
            def __init__(self, **_kwargs):
                pass

        fake_google = types.ModuleType("google")
        fake_google.__path__ = []
        fake_cloud = types.ModuleType("google.cloud")
        fake_cloud.__path__ = []
        fake_pubsub = types.ModuleType("google.cloud.pubsub_v1")
        fake_pubsub.PublisherClient = FakePublisher
        fake_pubsub.SubscriberClient = FakeSubscriber
        fake_pubsub.types = types.SimpleNamespace(FlowControl=FakeFlowControl)
        fake_pubsub_types = types.ModuleType("google.cloud.pubsub_v1.types")
        fake_pubsub_types.FlowControl = FakeFlowControl
        fake_cloud.pubsub_v1 = fake_pubsub
        fake_google.cloud = fake_cloud

        async def fail_processing(_data):
            raise RuntimeError("Demucs failed")

        with patch.dict(
            sys.modules,
            {
                "google": fake_google,
                "google.cloud": fake_cloud,
                "google.cloud.pubsub_v1": fake_pubsub,
                "google.cloud.pubsub_v1.types": fake_pubsub_types,
            },
        ):
            with patch.object(main, "process_pubsub_message", fail_processing):
                main.pubsub_consumer_loop()

        self.assertEqual(message.acks, 0)
        self.assertEqual(message.nacks, 1)
        self.assertEqual(result_calls, [True])

    def test_run_demucs_separation_retries_any_cuda_failure_before_raising(self):
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
                audio_revision=None,
            ):
                attempts.append(device)
                return 1, "RuntimeError: invalid audio stream", Path(temp_dir) / f"demucs-{device}"

            with (
                patch.object(main, "STORAGE_MODE", "local"),
                patch.object(main, "OUTPUT_BASE_DIR", temp_dir / "outputs"),
                patch.object(main, "demucs_devices_to_try", return_value=["cuda", "cpu"]),
                patch.object(main, "run_demucs_attempt", fake_run_demucs_attempt),
            ):
                with self.assertRaisesRegex(RuntimeError, "Demucs processing failed on cpu"):
                    asyncio.run(
                        main.run_demucs_separation(
                            input_path=input_path,
                            temp_dir=str(temp_dir),
                            release_id="rel_test",
                            track_id="trk_test",
                        )
                    )

            self.assertEqual(attempts, ["cuda", "cpu"])


if __name__ == "__main__":
    unittest.main()
