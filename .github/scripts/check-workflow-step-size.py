#!/usr/bin/env python3
"""Fail when a workflow step's inline script nears GitHub's length limit.

GitHub refuses to parse a workflow whose step script (a `run:` or
`with: script:` block containing `${{ }}` expressions) exceeds 21,000
characters ("Exceeded max expression length 21000"), and the dispatch then
fails for every operation of that workflow. actionlint does not check this
server-side limit, so this guard does. Move a long script into a file under
.github/scripts/ and pass inputs through `env:` instead.

Usage: check-workflow-step-size.py [workflow files...]
(default: every .github/workflows/*.yml / *.yaml)
"""
from __future__ import annotations

import glob
import re
import sys

GITHUB_LIMIT = 21_000
# Leave headroom so a small edit near the limit fails here, not on dispatch.
MAX_CHARS = 20_000
BLOCK_START = re.compile(r"^(?P<indent>\s*)(?:-\s+)?(?P<key>run|script):\s*[|>][-+]?\s*$")


def blocks(path: str):
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    i = 0
    while i < len(lines):
        match = BLOCK_START.match(lines[i])
        if not match:
            i += 1
            continue
        key_indent = len(match.group("indent"))
        start = i + 1
        body: list[str] = []
        j = start
        while j < len(lines):
            line = lines[j]
            if line.strip() and len(line) - len(line.lstrip()) <= key_indent:
                break
            body.append(line)
            j += 1
        yield start, match.group("key"), "\n".join(body)
        i = j


def main(argv: list[str]) -> int:
    paths = argv or sorted(glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml"))
    failures = []
    for path in paths:
        for line_no, key, body in blocks(path):
            size = len(body)
            if size > MAX_CHARS:
                failures.append((path, line_no, key, size))
    for path, line_no, key, size in failures:
        print(
            f"::error file={path},line={line_no}::{key} block is {size} characters; "
            f"GitHub rejects step scripts over {GITHUB_LIMIT}. Keep it under {MAX_CHARS} "
            "by moving the script to .github/scripts/ and passing inputs through env:."
        )
    if not failures:
        print(f"Workflow step scripts are all under {MAX_CHARS} characters ({len(paths)} files checked).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
