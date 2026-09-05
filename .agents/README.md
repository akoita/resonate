# Agent configuration

Start with [AGENTS.md](../AGENTS.md). `CLAUDE.md` is a symlink to that canonical
entry point. The root file holds cross-project rules and routes agents to
specialized rules only when needed.

## Layout

| Location | Purpose |
| --- | --- |
| `AGENTS.md` | Always-relevant policy and required reading by task scope |
| `.agents/rules/` | Detailed project rules; mandatory for the indicated scope |
| `.agents/workflows/` | Reusable task procedures, read when invoked or required |
| `.agents/plans/` | Issue-specific plans and remaining-work records, not global policy |
| Installed skills | External tooling procedures, discovered from the active client |

There are no repository-local `SKILL.md` packages. Workflow names such as
`/start-issue` are shorthand for reading the corresponding Markdown file; clients
without slash-command discovery can follow the file directly.

## Workflows

- [Start issue](workflows/start-issue.md): establish scope and branch, with or
  without a GitHub issue.
- [Finish issue](workflows/finish-issue.md): review, validate, and publish when
  authorized; merge only on explicit request.
- [Security review](workflows/security-best-practices.md): backend/frontend
  review grounded in reachable code paths.
- [Contract scan](workflows/smart-contract-scan.md): Solidity review and report.
- [Threat model](workflows/security-threat-model.md): assets, boundaries, abuse
  paths, and evidence-backed mitigations.

## Maintaining instructions

Keep each rule in one canonical location and link to it from workflows. Keep
security, business-model, testing, and completion requirements intact when
shortening prose. Verify links relative to the containing Markdown file; code
paths in rule files are relative to the repository root.

Do not duplicate installed skills or pin their cache paths here. In Codex, follow
the applicable orchestration policy and installed Maestro skill for non-trivial
work, including its routing preflight. Project cleanup does not authorize edits
to user-global skills or model configuration.

Use Linux/macOS shells or WSL on Windows. The former shared Claude hook invoked
`powershell.exe` for every shell command, including on Linux; machine-specific
hooks belong in ignored `.claude/settings.local.json`. `.claude/` and `.codex/`
are ignored for personal configuration. Review local hooks before enabling them.
