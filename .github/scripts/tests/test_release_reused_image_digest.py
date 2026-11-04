from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import textwrap
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("stamp_release_manifest", SCRIPTS / "stamp_release_manifest.py")
stamp = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(stamp)

DOCKER_V2 = "application/vnd.docker.distribution.manifest.v2+json"
SOURCE_SHA = "a" * 40
CACHED = json.dumps(
    {
        "schemaVersion": 2,
        "mediaType": DOCKER_V2,
        "config": {"mediaType": "application/vnd.docker.container.image.v1+json", "size": 7, "digest": "sha256:" + "c" * 64},
        "layers": [{"mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip", "size": 9, "digest": "sha256:" + "d" * 64}],
    },
    indent=3,
).encode()
CACHED_DIGEST = "sha256:" + hashlib.sha256(CACHED).hexdigest()


class StampManifestTests(unittest.TestCase):
    def test_adds_release_annotations_and_keeps_blobs(self) -> None:
        stamped = json.loads(stamp.stamp_manifest(CACHED, source_sha=SOURCE_SHA, reused_digest=CACHED_DIGEST))
        original = json.loads(CACHED)
        self.assertEqual(stamped["config"], original["config"])
        self.assertEqual(stamped["layers"], original["layers"])
        self.assertEqual(stamped["annotations"][stamp.REVISION_ANNOTATION], SOURCE_SHA)
        self.assertEqual(stamped["annotations"][stamp.REUSED_FROM_ANNOTATION], CACHED_DIGEST)

    def test_digest_is_per_release_and_reproducible(self) -> None:
        first = stamp.stamp_manifest(CACHED, source_sha=SOURCE_SHA, reused_digest=CACHED_DIGEST)
        again = stamp.stamp_manifest(CACHED, source_sha=SOURCE_SHA, reused_digest=CACHED_DIGEST)
        other = stamp.stamp_manifest(CACHED, source_sha="b" * 40, reused_digest=CACHED_DIGEST)
        self.assertEqual(first, again)
        self.assertNotEqual(first, other)
        self.assertNotEqual(hashlib.sha256(first).hexdigest(), CACHED_DIGEST.removeprefix("sha256:"))

    def test_rejects_manifest_that_does_not_match_the_reused_digest(self) -> None:
        with self.assertRaisesRegex(stamp.StampError, "does not hash"):
            stamp.stamp_manifest(CACHED + b" ", source_sha=SOURCE_SHA, reused_digest=CACHED_DIGEST)

    def test_rejects_short_source_sha(self) -> None:
        with self.assertRaisesRegex(stamp.StampError, "full lowercase"):
            stamp.stamp_manifest(CACHED, source_sha="abc123", reused_digest=CACHED_DIGEST)


class FakeRegistry(BaseHTTPRequestHandler):
    manifests: dict[str, tuple[str, bytes]] = {}

    def log_message(self, *_args: object) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        reference = self.path.rsplit("/", 1)[1]
        if reference not in self.manifests or self.headers.get("Authorization") != "Bearer token-123":
            self.send_response(404)
            self.end_headers()
            return
        media_type, body = self.manifests[reference]
        self.send_response(200)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self) -> None:  # noqa: N802
        body = self.rfile.read(int(self.headers["Content-Length"]))
        digest = "sha256:" + hashlib.sha256(body).hexdigest()
        tag = self.path.rsplit("/", 1)[1]
        self.manifests[tag] = (self.headers["Content-Type"], body)
        self.manifests[digest] = (self.headers["Content-Type"], body)
        self.send_response(201)
        self.send_header("Docker-Content-Digest", digest)
        self.end_headers()


class ReusePathTests(unittest.TestCase):
    def setUp(self) -> None:
        FakeRegistry.manifests = {CACHED_DIGEST: (DOCKER_V2, CACHED)}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeRegistry)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_reuse_publishes_a_fresh_release_digest(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        context = root / "context"
        context.mkdir()
        (context / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
        bin_dir = root / "bin"
        bin_dir.mkdir()
        base = f"http://127.0.0.1:{self.server.server_address[1]}"
        image = "europe-docker.pkg.dev/project-id/repository/demucs-worker:" + SOURCE_SHA
        # gcloud describe answers from the fake registry so the content tag
        # resolves to the cached digest and the release tag to what was pushed.
        gcloud = bin_dir / "gcloud"
        gcloud.write_text(
            textwrap.dedent(
                f"""\
                #!/usr/bin/env bash
                set -euo pipefail
                if [[ " $* " == *" auth print-access-token "* ]]; then
                  echo token-123
                elif [[ " $* " == *" artifacts docker images describe "* ]]; then
                  ref="$5"
                  if [[ "$ref" == *":src-tree" ]]; then
                    echo '{CACHED_DIGEST}'
                  else
                    python3 - "$ref" <<'PY'
                import hashlib, sys, urllib.request
                tag = sys.argv[1].rsplit(":", 1)[1]
                req = urllib.request.Request("{base}/v2/project-id/repository/demucs-worker/manifests/" + tag, headers={{"Authorization": "Bearer token-123"}})
                print("sha256:" + hashlib.sha256(urllib.request.urlopen(req).read()).hexdigest())
                PY
                  fi
                else
                  printf 'unexpected gcloud invocation: %s\\n' "$*" >&2
                  exit 1
                fi
                """
            ),
            encoding="utf-8",
        )
        gcloud.chmod(gcloud.stat().st_mode | stat.S_IXUSR)
        metadata = root / "build.json"
        result = subprocess.run(
            [
                "bash", str(SCRIPTS / "submit-cloud-build.sh"),
                "--project", "project-id",
                "--context", str(context),
                "--dockerfile", "Dockerfile",
                "--content-tag", "src-tree",
                "--image", image,
                "--metadata-output", str(metadata),
            ],
            check=False,
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "GITHUB_OUTPUT": str(root / "github-output"),
                "GITHUB_SHA": SOURCE_SHA,
                "STAMP_REGISTRY_URL": base,
                "CI_FORCE_IMAGE_REBUILD": "",
            },
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = json.loads(metadata.read_text(encoding="utf-8"))
        media_type, pushed = FakeRegistry.manifests[SOURCE_SHA]
        self.assertEqual(media_type, DOCKER_V2)
        self.assertEqual(evidence["digest"], "sha256:" + hashlib.sha256(pushed).hexdigest())
        self.assertNotEqual(evidence["digest"], CACHED_DIGEST)
        self.assertTrue(evidence["reused"])
        self.assertEqual(json.loads(pushed)["layers"], json.loads(CACHED)["layers"])


if __name__ == "__main__":
    unittest.main()
