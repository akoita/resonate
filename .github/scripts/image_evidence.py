#!/usr/bin/env python3
"""Create and validate digest-bound Resonate deployment manifests."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "resonate-deploy-manifest/v2"
SERVICES = ("backend", "frontend", "demucs", "stable-audio")
SERVICE_KEYS = {
    "backend": "backend",
    "frontend": "frontend",
    "demucs": "demucs",
    "stable-audio": "stable_audio",
}
SHA256_DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
SOURCE_REVISION = re.compile(r"[0-9a-f]{40}")


class ManifestError(ValueError):
    """Raised when deployment evidence is incomplete or malformed."""


def parse_services(value: str) -> list[str]:
    services = [item.strip() for item in value.split(",") if item.strip()]
    if len(services) != len(set(services)):
        raise ManifestError("services must not contain duplicates")
    unknown = sorted(set(services) - set(SERVICES))
    if unknown:
        raise ManifestError(f"unsupported services: {', '.join(unknown)}")
    return services


def validate_digest(value: str) -> str:
    if not SHA256_DIGEST.fullmatch(value):
        raise ManifestError("image digest must be sha256 followed by 64 lowercase hex characters")
    return value


def immutable_image_ref(tag: str, digest: str) -> str:
    validate_digest(digest)
    if not tag or "@" in tag:
        raise ManifestError("image tag must be a non-empty tag reference, not a digest reference")
    last_component = tag.rsplit("/", 1)[-1]
    if ":" not in last_component:
        raise ManifestError(f"image reference is missing an explicit tag: {tag}")
    repository, separator, version = tag.rpartition(":")
    if not separator or not repository or not version:
        raise ManifestError(f"invalid image tag: {tag}")
    return f"{repository}@{digest}"


def parse_assignments(values: Iterable[str], *, name: str) -> dict[str, str]:
    assignments: dict[str, str] = {}
    for value in values:
        service, separator, assigned = value.partition("=")
        if not separator or not service or not assigned:
            raise ManifestError(f"{name} must use SERVICE=VALUE")
        if service not in SERVICES:
            raise ManifestError(f"unsupported service in {name}: {service}")
        if service in assignments:
            raise ManifestError(f"duplicate {name} for service: {service}")
        assignments[service] = assigned
    return assignments


def build_manifest(
    *,
    should_dispatch: bool,
    environment: str,
    source_repository: str,
    source_ref: str,
    services_csv: str,
    trigger_branch: str,
    release_sha: str,
    release_id: str,
    image_tags: dict[str, str],
    image_digests: dict[str, str],
) -> dict[str, Any]:
    services = parse_services(services_csv)
    if should_dispatch != bool(services):
        raise ManifestError("should_dispatch must be true exactly when services are selected")
    if not SOURCE_REVISION.fullmatch(source_ref):
        raise ManifestError("source_ref must be a full 40-character lowercase commit SHA")
    if release_sha != source_ref:
        raise ManifestError("release_sha must equal source_ref")
    for field_name, value in (
        ("environment", environment),
        ("source_repository", source_repository),
        ("trigger_branch", trigger_branch),
        ("release_id", release_id),
    ):
        if not value:
            raise ManifestError(f"{field_name} must not be empty")

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "should_dispatch": should_dispatch,
        "environment": environment,
        "source_repository": source_repository,
        "source_ref": source_ref,
        "services": ",".join(services),
        "trigger_branch": trigger_branch,
        "release_sha": release_sha,
        "release_id": release_id,
    }

    for service in SERVICES:
        key = SERVICE_KEYS[service]
        selected = service in services
        tag = image_tags.get(service, "") if selected else ""
        digest = image_digests.get(service, "") if selected else ""
        if selected and (not tag or not digest):
            raise ManifestError(f"selected service {service} requires an image tag and digest")
        image_ref = immutable_image_ref(tag, digest) if selected else ""
        payload[f"{key}_image"] = tag
        payload[f"{key}_image_tag"] = tag
        payload[f"{key}_image_digest"] = digest
        payload[f"{key}_image_ref"] = image_ref

    return payload


def validate_manifest(manifest: Any) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ManifestError("deploy manifest must be a JSON object")
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise ManifestError(f"schema_version must be {SCHEMA_VERSION}")
    rebuilt = build_manifest(
        should_dispatch=manifest.get("should_dispatch") is True,
        environment=_string(manifest, "environment"),
        source_repository=_string(manifest, "source_repository"),
        source_ref=_string(manifest, "source_ref"),
        services_csv=_string(manifest, "services", allow_empty=True),
        trigger_branch=_string(manifest, "trigger_branch"),
        release_sha=_string(manifest, "release_sha"),
        release_id=_string(manifest, "release_id"),
        image_tags={
            service: _string(manifest, f"{key}_image_tag", allow_empty=True)
            for service, key in SERVICE_KEYS.items()
        },
        image_digests={
            service: _string(manifest, f"{key}_image_digest", allow_empty=True)
            for service, key in SERVICE_KEYS.items()
        },
    )
    for service, key in SERVICE_KEYS.items():
        for suffix in ("image", "image_ref"):
            field = f"{key}_{suffix}"
            if _string(manifest, field, allow_empty=True) != rebuilt[field]:
                raise ManifestError(f"{field} does not match the declared tag and digest")
    return rebuilt


def _string(manifest: dict[str, Any], key: str, *, allow_empty: bool = False) -> str:
    value = manifest.get(key)
    if not isinstance(value, str) or (not allow_empty and not value):
        qualifier = "a string" if allow_empty else "a non-empty string"
        raise ManifestError(f"{key} must be {qualifier}")
    return value


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ManifestError(f"unable to read deploy manifest: {error}") from error
    return validate_manifest(document)


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="create a validated v2 deploy manifest")
    create.add_argument("--output", required=True, type=Path)
    create.add_argument("--should-dispatch", required=True, choices=("true", "false"))
    create.add_argument("--environment", required=True)
    create.add_argument("--source-repository", required=True)
    create.add_argument("--source-ref", required=True)
    create.add_argument("--services", default="")
    create.add_argument("--trigger-branch", required=True)
    create.add_argument("--release-sha", required=True)
    create.add_argument("--release-id", required=True)
    create.add_argument("--image-tag", action="append", default=[])
    create.add_argument("--image-digest", action="append", default=[])

    validate = subparsers.add_parser("validate", help="validate a v2 deploy manifest")
    validate.add_argument("manifest", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "create":
            manifest = build_manifest(
                should_dispatch=args.should_dispatch == "true",
                environment=args.environment,
                source_repository=args.source_repository,
                source_ref=args.source_ref,
                services_csv=args.services,
                trigger_branch=args.trigger_branch,
                release_sha=args.release_sha,
                release_id=args.release_id,
                image_tags=parse_assignments(args.image_tag, name="--image-tag"),
                image_digests=parse_assignments(args.image_digest, name="--image-digest"),
            )
            write_manifest(args.output, manifest)
        else:
            load_manifest(args.manifest)
    except ManifestError as error:
        print(f"deploy manifest validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
