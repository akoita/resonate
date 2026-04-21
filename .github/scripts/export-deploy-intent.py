#!/usr/bin/env python3

import json
import shlex
import sys
from pathlib import Path


EXPECTED_KEYS = (
    "environment",
    "source_ref",
    "services",
    "trigger_branch",
    "release_sha",
    "release_id",
    "backend_image",
    "frontend_image",
    "demucs_image",
)


def emit(key: str, value: str) -> None:
    print(f"{key}={shlex.quote(value)}")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: export-deploy-intent.py <deploy-manifest.json>", file=sys.stderr)
        return 1

    manifest_path = Path(sys.argv[1])
    with manifest_path.open("r", encoding="utf-8") as fh:
        manifest = json.load(fh)

    for key in EXPECTED_KEYS:
        emit(key, str(manifest.get(key, "")))

    emit("should_dispatch", "true" if manifest.get("should_dispatch") else "false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
