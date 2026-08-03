#!/usr/bin/env python3
"""Fail closed on the production Python worker lock contract."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCKS = (
    Path("workers/analytics-dataflow/requirements.lock"),
    Path("workers/demucs/requirements-cpu.lock"),
    Path("workers/demucs/requirements-build.lock"),
    Path("workers/demucs/requirements-gpu.lock"),
    Path("workers/demucs/requirements-test.lock"),
    Path("workers/stable-audio/requirements.lock"),
    Path("workers/stable-audio/requirements-build.lock"),
    Path("workers/stable-audio/flash-attn.lock"),
)
INPUTS = (
    Path("workers/analytics-dataflow/requirements.in"),
    Path("workers/demucs/requirements-cpu.in"),
    Path("workers/demucs/requirements-build.in"),
    Path("workers/demucs/requirements-gpu.in"),
    Path("workers/demucs/requirements-test.in"),
    Path("workers/stable-audio/requirements.in"),
    Path("workers/stable-audio/requirements-build.in"),
)


def requirement_blocks(text: str) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line == line.lstrip() and not stripped.startswith("--"):
            if current:
                blocks.append(current)
            current = [stripped]
        elif current:
            current.append(stripped)
    if current:
        blocks.append(current)
    return blocks


def validate_lock(path: Path, errors: list[str]) -> None:
    text = (ROOT / path).read_text()
    blocks = requirement_blocks(text)
    if not blocks:
        errors.append(f"{path}: contains no requirements")
        return
    for block in blocks:
        requirement = block[0].removesuffix("\\").strip()
        label = requirement.split(" @ ", 1)[0].split("==", 1)[0]
        if "git+" in requirement.lower():
            errors.append(f"{path}: {label} uses a VCS installer")
        if " @ " in requirement:
            if not re.search(r"#sha256=[0-9a-f]{64}(?:\\|$)", requirement):
                errors.append(f"{path}: {label} direct URL lacks a SHA-256 fragment")
        elif "==" not in requirement or "*" in requirement:
            errors.append(f"{path}: {label} is not an exact version")
        if not any(re.search(r"--hash=sha256:[0-9a-f]{64}", line) for line in block):
            errors.append(f"{path}: {label} lacks a pip hash")


def require(text: str, needle: str, path: Path, errors: list[str]) -> None:
    if needle not in text:
        errors.append(f"{path}: missing {needle!r}")


def docker_instructions(text: str) -> list[str]:
    instructions: list[str] = []
    current = ""
    for line in text.splitlines():
        stripped = line.strip()
        if not current and (not stripped or stripped.startswith("#")):
            continue
        current = f"{current} {stripped}".strip()
        if current.endswith("\\"):
            current = current[:-1].rstrip()
            continue
        instructions.append(current)
        current = ""
    if current:
        instructions.append(current)
    return instructions


def main() -> int:
    errors: list[str] = []
    for path in (*LOCKS, *INPUTS):
        if not (ROOT / path).is_file():
            errors.append(f"{path}: missing")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    for path in LOCKS:
        validate_lock(path, errors)

    for path in INPUTS:
        text = (ROOT / path).read_text()
        if "git+" in text.lower() or re.search(r"(?:/archive/|@)(?:main|master|HEAD)\b", text):
            errors.append(f"{path}: mutable VCS reference")
        for url in re.findall(r"https://github\.com/[^\s#]+", text):
            if not re.search(r"/archive/[0-9a-f]{40}\.tar\.gz$", url):
                errors.append(f"{path}: GitHub archive is not commit-addressed: {url}")

    docker_contract = {
        Path("workers/analytics-dataflow/Dockerfile"): (
            "COPY requirements.lock .",
            "--require-hashes -r requirements.lock",
            "--no-build-isolation --no-deps .",
            'FLEX_TEMPLATE_PYTHON_REQUIREMENTS_FILE="/template/requirements.lock"',
        ),
        Path("workers/demucs/Dockerfile"): (
            "COPY requirements-build.lock requirements-cpu.lock ./",
            "--require-hashes -r requirements-build.lock",
            "--no-build-isolation -r requirements-cpu.lock",
        ),
        Path("workers/demucs/Dockerfile.gpu"): (
            "COPY requirements-build.lock requirements-gpu.lock constraints-gpu.txt patch_demucs.py ./",
            "--require-hashes -r requirements-build.lock",
            "--require-hashes",
            "--constraint constraints-gpu.txt -r requirements-gpu.lock",
        ),
        Path("workers/stable-audio/Dockerfile"): (
            "COPY requirements-build.lock requirements.lock constraints-gpu.txt flash-attn.lock /app/",
            "--require-hashes -r requirements-build.lock",
            "--require-hashes --no-build-isolation",
            "--constraint constraints-gpu.txt -r requirements.lock",
            "--require-hashes --no-build-isolation --no-deps",
            "FLASH_ATTENTION_FORCE_BUILD=TRUE",
            "-r flash-attn.lock",
        ),
    }
    for path, needles in docker_contract.items():
        text = (ROOT / path).read_text()
        for needle in needles:
            require(text, needle, path, errors)
        for instruction in docker_instructions(text):
            if "pip install" not in instruction:
                continue
            if re.search(r"pip install\b.* --no-deps \.$", instruction):
                continue
            if "--require-hashes" not in instruction:
                errors.append(f"{path}: external pip install is not hash-enforced: {instruction}")
        if "git+" in text.lower():
            errors.append(f"{path}: contains a VCS install")

    demucs_constraints = (ROOT / "workers/demucs/constraints-gpu.txt").read_text()
    for pin in ("torch==2.1.0", "torchaudio==2.1.0", "torchvision==0.16.0"):
        require(demucs_constraints, pin, Path("workers/demucs/constraints-gpu.txt"), errors)
    stable_constraints = (ROOT / "workers/stable-audio/constraints-gpu.txt").read_text()
    for pin in ("torch==2.7.1", "torchaudio==2.7.1"):
        require(stable_constraints, pin, Path("workers/stable-audio/constraints-gpu.txt"), errors)

    gpu_input = (ROOT / "workers/demucs/requirements-gpu.in").read_text()
    require(gpu_input, "soundfile", Path("workers/demucs/requirements-gpu.in"), errors)

    stable_docker = (ROOT / "workers/stable-audio/Dockerfile").read_text()
    if stable_docker.find("-r flash-attn.lock") < stable_docker.find("-r requirements.lock"):
        errors.append("workers/stable-audio/Dockerfile: flash-attn must install after the runtime lock")

    spike_docker = (ROOT / "experiments/stable-audio-3-spike/Dockerfile").read_text()
    spike_readme = (ROOT / "experiments/stable-audio-3-spike/README.md").read_text()
    if "ARCHIVED/NON-PRODUCTION" not in spike_docker or "Archived dependency disposition" not in spike_readme:
        errors.append("experiments/stable-audio-3-spike: missing explicit non-production disposition")

    if errors:
        print("Python worker lock validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Validated {len(LOCKS)} hashed locks and production Docker install contracts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
