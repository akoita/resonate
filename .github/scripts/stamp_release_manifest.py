#!/usr/bin/env python3
"""Give a content-addressed reused image its own per-release manifest digest.

When submit-cloud-build.sh reuses an unchanged image, every release used to
point its tag at the same digest, so every release's signature, SBOM and build
attestation piled up as OCI referrers on that one digest. cosign reads the
referrers list without following registry pagination, so once a long-reused
digest (the Demucs worker reached 22 releases) holds more referrers than the
registry returns in one page, the deploy-side verifier no longer sees the new
release's build attestation and refuses the deploy.

This helper copies the cached manifest, adds release annotations, and pushes
it under the release tag. The config and layers are untouched (no blob is
copied or rebuilt), but the manifest bytes change, so the release gets a fresh
digest whose referrers are only its own evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from typing import Any


DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
SOURCE_SHA = re.compile(r"[0-9a-f]{40}")
REVISION_ANNOTATION = "org.opencontainers.image.revision"
REUSED_FROM_ANNOTATION = "co.resonate.image.reused-from-digest"
MANIFEST_MEDIA_TYPES = (
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
)
MAX_MANIFEST_BYTES = 4 * 1024 * 1024


class StampError(ValueError):
    pass


def stamp_manifest(manifest: bytes, *, source_sha: str, reused_digest: str) -> bytes:
    """Return the cached manifest with release annotations, serialized stably."""
    if not SOURCE_SHA.fullmatch(source_sha):
        raise StampError("source SHA must be a full lowercase commit SHA")
    if not DIGEST.fullmatch(reused_digest):
        raise StampError("reused digest must be a sha256 digest")
    if hashlib.sha256(manifest).hexdigest() != reused_digest.removeprefix("sha256:"):
        raise StampError("fetched manifest does not hash to the reused digest")
    try:
        document: Any = json.loads(manifest)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise StampError(f"cached manifest is not JSON: {error}") from error
    if not isinstance(document, dict) or document.get("schemaVersion") != 2:
        raise StampError("cached manifest is not a schema version 2 manifest")
    annotations = document.get("annotations") or {}
    if not isinstance(annotations, dict):
        raise StampError("cached manifest annotations must be an object")
    document["annotations"] = {
        **annotations,
        REVISION_ANNOTATION: source_sha,
        REUSED_FROM_ANNOTATION: reused_digest,
    }
    # Same input, same bytes: a re-run of one release reproduces its digest.
    return json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def split_image(image: str) -> tuple[str, str, str]:
    """Split host/path:tag into (host, repository path, tag)."""
    host, slash, rest = image.partition("/")
    repository, colon, tag = rest.rpartition(":")
    if not slash or not colon or not host or not repository or not tag or "@" in rest:
        raise StampError(f"expected an explicitly tagged image reference, got: {image}")
    return host, repository, tag


def _request(method: str, url: str, token: str, *, body: bytes | None = None, content_type: str | None = None):
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    if content_type:
        request.add_header("Content-Type", content_type)
    else:
        request.add_header("Accept", ", ".join(MANIFEST_MEDIA_TYPES))
    try:
        return urllib.request.urlopen(request, timeout=60)  # noqa: S310 - registry URL built from the image ref
    except urllib.error.HTTPError as error:
        detail = error.read(2048).decode("utf-8", "replace")
        raise StampError(f"{method} {url} failed with HTTP {error.code}: {detail}") from error


def stamp_release(*, image: str, reused_digest: str, source_sha: str, token: str, registry_url: str | None) -> str:
    host, repository, tag = split_image(image)
    base = registry_url.rstrip("/") if registry_url else f"https://{host}"
    with _request("GET", f"{base}/v2/{repository}/manifests/{reused_digest}", token) as response:
        media_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip()
        manifest = response.read(MAX_MANIFEST_BYTES + 1)
    if len(manifest) > MAX_MANIFEST_BYTES:
        raise StampError("cached manifest is larger than the registry manifest limit")
    if media_type not in MANIFEST_MEDIA_TYPES:
        raise StampError(f"unsupported cached manifest media type: {media_type or '(none)'}")
    stamped = stamp_manifest(manifest, source_sha=source_sha, reused_digest=reused_digest)
    digest = "sha256:" + hashlib.sha256(stamped).hexdigest()
    with _request(
        "PUT",
        f"{base}/v2/{repository}/manifests/{tag}",
        token,
        body=stamped,
        content_type=media_type,
    ) as response:
        returned = response.headers.get("Docker-Content-Digest", "").strip()
    if returned and returned != digest:
        raise StampError(f"registry stored {returned}, expected {digest}")
    return digest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--image", required=True, help="release tag, host/path:tag")
    parser.add_argument("--reused-digest", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument(
        "--registry-url",
        help="override the registry base URL (tests only); defaults to https://<image host>",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    token = sys.stdin.readline().strip()
    if not token:
        print("stamp_release_manifest: an access token is required on stdin", file=sys.stderr)
        return 1
    try:
        digest = stamp_release(
            image=args.image,
            reused_digest=args.reused_digest,
            source_sha=args.source_sha,
            token=token,
            registry_url=args.registry_url,
        )
    except (OSError, StampError) as error:
        print(f"stamp_release_manifest: {error}", file=sys.stderr)
        return 1
    print(digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
