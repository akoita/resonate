#!/usr/bin/env python3
"""Build release evidence and render evidence-bound Resonate release notes."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

import image_evidence


SCHEMA_VERSION = "resonate-release-evidence/v2"
SEMVER_NUMBER = r"(?:0|[1-9]\d*)"
SEMVER_PRERELEASE_IDENTIFIER = r"(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
STRICT_SEMVER = re.compile(
    rf"{SEMVER_NUMBER}\.{SEMVER_NUMBER}\.{SEMVER_NUMBER}"
    rf"(?:-{SEMVER_PRERELEASE_IDENTIFIER}(?:\.{SEMVER_PRERELEASE_IDENTIFIER})*)?"
)
HTTP_URL = re.compile(r"https://[^\s]+")
REQUIRED_NOTE_HEADINGS = (
    "Summary",
    "User-visible changes",
    "API and contract changes",
    "Operations and deployments",
    "Security",
    "Migrations",
    "Known limitations and deferred work",
    "Documentation and maintenance",
    "Other changes",
    "Release evidence",
    "Rollback and recovery",
)
EVIDENCE_FILES = {
    "build_metadata": "{service}.build.json",
    "sbom": "{service}.sbom.cdx.json",
    "signature_verification": "{service}.signature-verification.json",
    "sbom_attestation_verification": "{service}.attestation-verification.json",
    "build_attestation_verification": "{service}.build-attestation-verification.json",
}


class ReleaseEvidenceError(ValueError):
    """Raised when release inputs are incomplete, malformed, or inconsistent."""


def validate_version(version: str) -> str:
    if not STRICT_SEMVER.fullmatch(version):
        raise ReleaseEvidenceError("version must be strict MAJOR.MINOR.PATCH[-prerelease] SemVer")
    return version


def validate_source_sha(source_sha: str) -> str:
    if not image_evidence.SOURCE_REVISION.fullmatch(source_sha):
        raise ReleaseEvidenceError("source SHA must be 40 lowercase hexadecimal characters")
    return source_sha


def validate_url(value: str, *, field: str) -> str:
    if not HTTP_URL.fullmatch(value):
        raise ReleaseEvidenceError(f"{field} must be a non-empty https URL")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_nonempty_json(path: Path, *, description: str) -> Any:
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ReleaseEvidenceError(f"unable to read {description} at {path}: {error}") from error
    if not raw:
        raise ReleaseEvidenceError(f"{description} must not be empty: {path}")
    try:
        document = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ReleaseEvidenceError(f"{description} must contain valid JSON: {path}") from error
    if document in ({}, [], None, ""):
        raise ReleaseEvidenceError(f"{description} JSON must not be empty: {path}")
    return document


def _service_evidence(
    *,
    root: Path,
    service: str,
    source_sha: str,
    immutable_ref: str,
    digest: str,
) -> dict[str, Any]:
    service_dir = root / service
    if not service_dir.is_dir():
        raise ReleaseEvidenceError(f"selected service {service} requires evidence directory {service_dir}")

    files: dict[str, dict[str, str]] = {}
    documents: dict[str, Any] = {}
    for evidence_name, filename_pattern in EVIDENCE_FILES.items():
        filename = filename_pattern.format(service=service)
        path = service_dir / filename
        document = _load_nonempty_json(path, description=f"{service} {evidence_name}")
        documents[evidence_name] = document
        files[evidence_name] = {
            "filename": filename,
            "sha256": _sha256(path),
        }

    metadata = documents["build_metadata"]
    if not isinstance(metadata, dict):
        raise ReleaseEvidenceError(f"{service} build metadata must be a JSON object")
    if metadata.get("immutable_ref") != immutable_ref:
        raise ReleaseEvidenceError(f"{service} build metadata immutable reference mismatch")
    if metadata.get("source_sha") != source_sha:
        raise ReleaseEvidenceError(f"{service} build metadata source SHA mismatch")
    if metadata.get("digest") != digest:
        raise ReleaseEvidenceError(f"{service} build metadata digest mismatch")
    if not isinstance(metadata.get("cloud_build_id"), str) or not metadata["cloud_build_id"]:
        raise ReleaseEvidenceError(f"{service} build metadata is missing cloud_build_id")

    sbom = documents["sbom"]
    if not isinstance(sbom, dict) or sbom.get("bomFormat") != "CycloneDX" or not sbom.get("components"):
        raise ReleaseEvidenceError(f"{service} SBOM must be a non-empty CycloneDX document")

    return {
        "digest": digest,
        "immutable_ref": immutable_ref,
        "cloud_build_id": metadata["cloud_build_id"],
        "evidence_files": files,
    }


def build_release_evidence(
    *,
    deploy_manifest_path: Path,
    image_evidence_root: Path,
    source_sha: str,
    version: str,
    ci_run_id: str,
    ci_run_url: str,
    image_run_id: str,
    image_run_url: str,
    release_pr_url: str,
) -> dict[str, Any]:
    validate_source_sha(source_sha)
    validate_version(version)
    if not ci_run_id.strip():
        raise ReleaseEvidenceError("ci-run-id must not be empty")
    if not image_run_id.strip():
        raise ReleaseEvidenceError("image-run-id must not be empty")
    validate_url(ci_run_url, field="ci-run-url")
    validate_url(image_run_url, field="image-run-url")
    validate_url(release_pr_url, field="release-pr-url")

    try:
        manifest = image_evidence.load_manifest(deploy_manifest_path)
    except image_evidence.ManifestError as error:
        raise ReleaseEvidenceError(f"invalid deploy manifest: {error}") from error
    if manifest["source_ref"] != source_sha:
        raise ReleaseEvidenceError("deploy manifest source_ref does not match source SHA")
    if manifest["release_sha"] != source_sha:
        raise ReleaseEvidenceError("deploy manifest release_sha does not match source SHA")

    selected_services = image_evidence.parse_services(manifest["services"])
    services: dict[str, Any] = {}
    for service in selected_services:
        key = image_evidence.SERVICE_KEYS[service]
        digest = manifest[f"{key}_image_digest"]
        immutable_ref = manifest[f"{key}_image_ref"]
        image_evidence.validate_digest(digest)
        if not re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", immutable_ref):
            raise ReleaseEvidenceError(f"selected service {service} image reference is not immutable")
        if immutable_ref.rsplit("@", 1)[1] != digest:
            raise ReleaseEvidenceError(f"selected service {service} image reference digest mismatch")
        services[service] = _service_evidence(
            root=image_evidence_root,
            service=service,
            source_sha=source_sha,
            immutable_ref=immutable_ref,
            digest=digest,
        )

    deploy_status = "handoff-requested" if manifest["should_dispatch"] else "not-performed"
    return {
        "schema_version": SCHEMA_VERSION,
        "version": version,
        "tag": f"v{version}",
        "source_sha": source_sha,
        "ci_run": {
            "id": ci_run_id,
            "url": ci_run_url,
        },
        "image_run": {
            "id": image_run_id,
            "url": image_run_url,
        },
        "release_pr_url": release_pr_url,
        "deployment": {
            "status": deploy_status,
            "environment": manifest["environment"],
            "release_id": manifest["release_id"],
            "source_repository": manifest["source_repository"],
            "trigger_branch": manifest["trigger_branch"],
            "deploy_manifest_sha256": _sha256(deploy_manifest_path),
        },
        "services": services,
        "analytics": {"status": "not-performed"},
        "contracts": {"status": "not-performed"},
        "infrastructure": {
            "status": deploy_status,
            "release_id": manifest["release_id"],
        },
    }


def write_json(path: Path, document: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _normalized_section(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
        return "\n".join(item if item.startswith(("- ", "* ")) else f"- {item}" for item in items)
    return ""


def _sections_from_markdown(body: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    active: str | None = None
    for line in body.splitlines():
        match = re.fullmatch(r"##\s+(.+?)\s*", line)
        if match:
            heading = match.group(1)
            active = heading if heading in REQUIRED_NOTE_HEADINGS else None
            if active is not None:
                sections.setdefault(active, [])
        elif active is not None:
            sections[active].append(line)
    return {heading: "\n".join(lines).strip() for heading, lines in sections.items()}


def load_generated_sections(path: Path) -> dict[str, str]:
    document = _load_nonempty_json(path, description="generated release notes")
    if not isinstance(document, dict):
        raise ReleaseEvidenceError("generated release notes must be a JSON object")

    sections: dict[str, str] = {}
    category_source = document.get("categories")
    if isinstance(category_source, dict):
        for heading in REQUIRED_NOTE_HEADINGS:
            content = _normalized_section(category_source.get(heading))
            if content:
                sections[heading] = content
    for heading in REQUIRED_NOTE_HEADINGS:
        content = _normalized_section(document.get(heading))
        if content:
            sections[heading] = content
    if isinstance(document.get("body"), str):
        for heading, content in _sections_from_markdown(document["body"]).items():
            if content:
                sections[heading] = content
    return sections


def load_release_evidence(path: Path) -> dict[str, Any]:
    document = _load_nonempty_json(path, description="release evidence")
    if not isinstance(document, dict) or document.get("schema_version") != SCHEMA_VERSION:
        raise ReleaseEvidenceError(f"release evidence schema_version must be {SCHEMA_VERSION}")
    for key in ("tag", "source_sha", "ci_run", "image_run", "release_pr_url", "services"):
        if key not in document:
            raise ReleaseEvidenceError(f"release evidence is missing {key}")
    return document


def render_notes(*, generated_notes_path: Path, evidence_path: Path) -> str:
    sections = load_generated_sections(generated_notes_path)
    evidence = load_release_evidence(evidence_path)

    evidence_lines = [
        f"- Version: `{evidence['tag']}`",
        f"- Source commit: `{evidence['source_sha']}`",
        f"- CI run: [{evidence['ci_run']['id']}]({evidence['ci_run']['url']})",
        f"- Image release run: [{evidence['image_run']['id']}]({evidence['image_run']['url']})",
        f"- Approved release PR: {evidence['release_pr_url']}",
    ]
    services = evidence.get("services", {})
    if services:
        for service in sorted(services):
            service_evidence = services[service]
            evidence_lines.append(
                f"- {service}: `{service_evidence['immutable_ref']}` "
                f"(digest `{service_evidence['digest']}`)"
            )
    else:
        evidence_lines.append("- OCI service evidence: None")
    for boundary in ("analytics", "contracts", "infrastructure"):
        status = evidence.get(boundary, {}).get("status", "not-performed")
        evidence_lines.append(f"- {boundary.capitalize()} status: `{status}`")

    generated_evidence = sections.get("Release evidence", "").strip()
    combined_evidence = "\n".join(
        part for part in (generated_evidence, "\n".join(evidence_lines)) if part
    )
    sections["Release evidence"] = combined_evidence

    rendered: list[str] = [f"# Resonate {evidence['tag']}", ""]
    for heading in REQUIRED_NOTE_HEADINGS:
        rendered.extend((f"## {heading}", "", sections.get(heading, "").strip() or "None", ""))
    return "\n".join(rendered).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="build and validate release evidence")
    build.add_argument("--deploy-manifest", required=True, type=Path)
    build.add_argument("--image-evidence-root", required=True, type=Path)
    build.add_argument("--source-sha", required=True)
    build.add_argument("--version", required=True)
    build.add_argument("--ci-run-id", required=True)
    build.add_argument("--ci-run-url", required=True)
    build.add_argument("--image-run-id", required=True)
    build.add_argument("--image-run-url", required=True)
    build.add_argument("--release-pr-url", required=True)
    build.add_argument("--output", required=True, type=Path)

    render = subparsers.add_parser("render-notes", help="render complete evidence-bound release notes")
    render.add_argument("--generated-notes-json", required=True, type=Path)
    render.add_argument("--evidence", required=True, type=Path)
    render.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "build":
            document = build_release_evidence(
                deploy_manifest_path=args.deploy_manifest,
                image_evidence_root=args.image_evidence_root,
                source_sha=args.source_sha,
                version=args.version,
                ci_run_id=args.ci_run_id,
                ci_run_url=args.ci_run_url,
                image_run_id=args.image_run_id,
                image_run_url=args.image_run_url,
                release_pr_url=args.release_pr_url,
            )
            write_json(args.output, document)
        else:
            notes = render_notes(
                generated_notes_path=args.generated_notes_json,
                evidence_path=args.evidence,
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(notes, encoding="utf-8")
    except (ReleaseEvidenceError, OSError) as error:
        print(f"release evidence validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
