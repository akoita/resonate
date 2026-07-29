---
name: auditing-resonate-security
description: |
  Routes any Resonate security work — repo audit, PR/diff review, threat model, Solidity
  contract scan, dependency/CI hardening, MCP and agent-runtime review — to the right
  agent-toolkit security skill, and supplies the Resonate-specific stack, threat surface,
  house rules, and report conventions those skills need. Use this skill whenever the user
  asks to audit, review, threat-model, or scan anything in this repository for security,
  and before running the security step of `/finish-issue`. Do NOT use it as a methodology
  source — it deliberately contains no procedure — and do not use it for functional code
  review, performance work, or legal/compliance sign-off.
license: MIT
compatibility: Requires the agent-toolkit security plugin (security@agent-toolkit on Claude Code, codex-security@agent-toolkit on Codex)
allowed-tools: Read Grep Glob Bash
metadata:
  author: akoita
  project: resonate
  version: "1.0.0"
---

# Auditing Resonate security

This skill is a **router plus project context**. The security methodology lives in the
shared [`agent-toolkit`](https://github.com/akoita/agent-toolkit) skills
(`plugins/claude/security/skills/`, installed as `security@agent-toolkit`). It is
intentionally **not** duplicated here: a fork of the procedure in this repo would drift
from the maintained one within a release or two. Pick the target skill from the routing
table, then hand it the Resonate context below.

If the security plugin is not installed, install it rather than reconstructing the
procedure from memory. The skill names below are identical on both platforms:

```bash
# Claude Code
claude plugin marketplace add akoita/agent-toolkit
claude plugin install security@agent-toolkit

# Codex
codex plugin marketplace add akoita/agent-toolkit
codex plugin add codex-security@agent-toolkit
```

## Routing table

| Situation | Use this agent-toolkit skill |
| --- | --- |
| Deep, repository-wide or large-subsystem audit; turning scanner output into evidence-backed findings; writing a security report | `security-audit` |
| A change is the unit of work — branch, PR, staged edits — and the question is "does this introduce risk?" | `security-review` |
| Choosing, installing, invoking, or CI-wiring the deterministic toolchain (SAST, SCA, secrets, IaC, DAST, fuzzing) | `security-scan` |
| Anything under `contracts/` — Solidity, proxies/upgradeability, invariants, oracles, ERC-4337 account abstraction, signature replay | `security-smart-contracts` |
| Design-time analysis: trust boundaries, assets, entry points, attacker capabilities, abuse paths, STRIDE/LINDDUN | `security-threat-model` |
| CI/CD workflows, action pinning, dependency intake, lockfiles, SBOM, release signing, provenance, OpenSSF/CRA checklists | `security-supply-chain` |
| The MCP server (`backend/src/modules/mcp/`), the AI DJ, generation, embeddings/recommendations, the agent runtime (`backend/src/modules/agents/`, `backend/src/agent-worker.ts`), or this `.agents/skills/` tree itself | `security-ai` |

Multiple skills often apply — a PR touching `contracts/` and `backend/src/modules/x402/`
needs `security-smart-contracts` **and** `security-review`. Run them in that order
(highest-custody surface first).

## Resonate stack and concerns

| Layer | Tech | Key concerns |
| --- | --- | --- |
| Backend | NestJS + Prisma + BullMQ | Auth, input validation, SQL injection, queue poisoning |
| Frontend | Next.js + React | XSS, CSRF, auth token handling, SSR data leaks |
| Contracts | Solidity + Foundry | Route to `security-smart-contracts`, not the app-side skills |
| Infra | Cloud Run + Redis + GCS | Secret management, bucket ACLs, env var hygiene |

## Resonate threat surface

- **Account abstraction** — passkey/WebAuthn auth, agent-owned keys, session keys,
  bundler integration (`backend/src/modules/webauthn/`, `sessions/`, `identity/`,
  `contracts/src/aa/`).
- **Smart contracts** — `StemNFT` minting, `StemMarketplaceV2` transactions, royalty
  distribution, plus the escrow/custody surfaces (`RevenueEscrow`,
  `ShowCampaignEscrow`, `DisputeResolution`, `ContentProtection`, `CurationRewards`,
  `PaymentAssetRegistry`, price-oracle adapters).
- **x402 payment rails** — agent-facing HTTP payments, quote/settlement integrity,
  replay and double-spend, refund and reconciliation paths
  (`backend/src/modules/x402/`, `payments/`, `pricing/`). Treat every money-moving path
  as custody code.
- **MCP server** — the agent-facing tool surface (`backend/src/modules/mcp/`): tool
  poisoning, prompt injection, over-broad tool authorization, exfiltration through tool
  output, and MCP authorization requirements. Route to `security-ai`.
- **Audio pipeline** — file upload, Demucs processing, encrypted storage, stream
  decryption (`backend/src/modules/ingestion/`, `storage/`, `encryption/`, `workers/`).
- **API layer** — NestJS backend, auth guards, WebSocket connections.
- **Infrastructure** — Cloud Run, Redis, GCS buckets, Terraform-managed resources
  (Terraform lives in the private `resonate-iac` repo).

Realistic attacker models to calibrate against: unauthenticated internet attacker;
authenticated user attempting privilege escalation; compromised agent key or session
key; malicious audio upload; a hostile MCP client driving the agent tool surface.

## Resonate house rules for findings

These override generic scanner defaults and prevent recurring false positives:

- **Use UUIDs, not incrementing IDs** for public resource identifiers.
- **Never report TLS absence as a vulnerability in local dev** — TLS is terminated by
  infrastructure in production.
- **Don't set `secure` cookies in dev** — it breaks non-HTTPS environments.
- **Avoid recommending HSTS** unless fully understood — it can cause major outages.
- **Follow the `AGENTS.md` env var conventions** — no hardcoded URLs, ports, or secrets;
  a hardcoded environment-dependent value is a real finding here, not a nit.
- Test files and fixtures under `backend/src/tests/` and `test-fixtures/` are not
  production findings unless the secret is real.
- Business-model red lines (`AGENTS.md` → ADR-BM-4) are security-relevant: no
  platform-subsidized payouts, listener-side payouts pre-funded only.

## Report conventions

- Written reports go under `audit/` (for example `audit/security-audit-<scope>.md`,
  `audit/scv-scan-report.md`). Create the directory if it does not exist.
- Severity, evidence, and triage doctrine come from `security-audit`
  (`references/severity-and-reporting.md`, `references/triage-and-false-positives.md`) —
  use those definitions verbatim rather than inventing a local scale.
- After any fix, run `npm run lint` in both `backend/` and `web/`, and the focused tests
  for the touched area (see `.agents/skills/finish-issue/SKILL.md` §4).

## Anti-patterns

- Do not restate the agent-toolkit procedure in this file or in a new local workflow.
  Add project facts here; send methodology upstream.
- Do not treat a model verdict as a merge gate — `security-review` is advisory
  (`/finish-issue` §5 still requires fixing High/Critical before proceeding).
- Do not claim a component, flow, or control without a `file:line`.
