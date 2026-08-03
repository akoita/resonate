#!/usr/bin/env python3

import shlex
import sys
from pathlib import Path

from image_evidence import ManifestError, load_manifest


EXPECTED_KEYS = (
    "schema_version",
    "environment",
    "source_repository",
    "source_ref",
    "services",
    "trigger_branch",
    "release_sha",
    "release_id",
    "backend_image",
    "backend_image_tag",
    "backend_image_digest",
    "backend_image_ref",
    "frontend_image",
    "frontend_image_tag",
    "frontend_image_digest",
    "frontend_image_ref",
    "demucs_image",
    "demucs_image_tag",
    "demucs_image_digest",
    "demucs_image_ref",
    "stable_audio_image",
    "stable_audio_image_tag",
    "stable_audio_image_digest",
    "stable_audio_image_ref",
)


def emit(key: str, value: str) -> None:
    print(f"{key}={shlex.quote(value)}")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: export-deploy-intent.py <deploy-manifest.json>", file=sys.stderr)
        return 1

    manifest_path = Path(sys.argv[1])
    try:
        manifest = load_manifest(manifest_path)
    except ManifestError as error:
        print(f"Invalid deploy manifest: {error}", file=sys.stderr)
        return 1

    for key in EXPECTED_KEYS:
        emit(key, str(manifest.get(key, "")))

    emit("should_dispatch", "true" if manifest.get("should_dispatch") else "false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
