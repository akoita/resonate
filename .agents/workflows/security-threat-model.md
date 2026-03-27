---
description: Generate an AppSec-grade threat model for the repo or a specific module — anchored to actual code, not generic checklists
---

# Security Threat Model

Deliver an actionable, AppSec-grade threat model specific to the repository (or a module path), anchored to evidence in the code. Prioritize realistic attacker goals and concrete impacts over generic checklists.

> Adapted from [Trail of Bits openai-security-threat-model](https://github.com/trailofbits/skills-curated/tree/main/plugins/openai-security-threat-model). Licensed under their original terms.

## When to use

- Before deploying a new module or significant feature to production
- When adding new external integrations (payment, blockchain, third-party APIs)
- For security review of the account abstraction / wallet layer
- When the user requests a threat model of the full system or a subsystem

## Resonate threat surface

Key areas to consider:

- **Account abstraction** — passkey auth, agent-owned keys, session keys, bundler integration
- **Smart contracts** — StemNFT minting, marketplace transactions, royalty distribution
- **Audio pipeline** — file upload, Demucs processing, encrypted storage, stream decryption
- **API layer** — NestJS backend, auth guards, WebSocket connections
- **Infrastructure** — Cloud Run, Redis, GCS buckets, Terraform-managed resources

## Workflow

### 1. Scope and extract the system model

- Identify primary components, data stores, and external integrations
- Determine how each part runs (server, worker, frontend, CLI)
- Separate runtime behavior from CI/build/dev tooling
- Map in-scope locations and explicitly exclude out-of-scope items
- **Do not claim components, flows, or controls without evidence in the code**

### 2. Derive boundaries, assets, and entry points

- **Trust boundaries**: edges between components — note protocol, auth, encryption, validation, rate limiting
- **Assets**: credentials, private keys, audio content, user PII, NFT metadata, session keys, encryption keys
- **Entry points**: API endpoints, file upload surfaces, WebSocket connections, queue triggers, admin tooling

### 3. Calibrate attacker capabilities

- Describe realistic attacker capabilities based on exposure and usage
- Explicitly note non-capabilities to avoid inflated severity
- Consider:
  - Unauthenticated internet attacker
  - Authenticated user attempting privilege escalation
  - Compromised agent key
  - Malicious audio upload

### 4. Enumerate threats as abuse paths

- Map attacker goals to assets and boundaries:
  - **Exfiltration**: master audio files, private keys, user data
  - **Privilege escalation**: bypassing auth guards, forging session keys
  - **Integrity compromise**: minting unauthorized NFTs, corrupting marketplace state
  - **Denial of service**: queue flooding, contract griefing, resource exhaustion
- Keep the list small but high quality

### 5. Prioritize with likelihood × impact

| Level        | Examples                                                                      |
| ------------ | ----------------------------------------------------------------------------- |
| **Critical** | Pre-auth RCE, auth bypass, cross-tenant access, key theft, fund extraction    |
| **High**     | Targeted DoS of critical components, partial data exposure, session key abuse |
| **Medium**   | Rate-limit bypass, log poisoning, upgrade admin access issues                 |
| **Low**      | Low-sensitivity info leaks, noisy DoS with easy mitigation                    |

Use qualitative likelihood and impact (low/medium/high) with short justifications.

### 6. Validate assumptions with the user

- Summarize key assumptions that affect threat ranking
- Ask 1–3 targeted questions to resolve missing context:
  - Deployment model and internet exposure
  - Auth/authz expectations
  - Data sensitivity classification
  - Multi-tenancy model
- **Pause and wait for user feedback before producing the final report**
- If the user can't answer, state which assumptions remain and how they influence priority

### 7. Recommend mitigations

- Distinguish **existing mitigations** (with evidence) from **recommended mitigations**
- Tie each to concrete locations (component, boundary, entry point)
- Prefer specific hints: "enforce schema validation at upload endpoint" > "validate inputs"
- Mark recommendations as conditional if key assumptions are unresolved

### 8. Quality check and report

Before finalizing, confirm:

- [ ] All discovered entry points are covered
- [ ] Each trust boundary is represented in threats
- [ ] Runtime vs CI/dev separation is clear
- [ ] User clarifications are reflected
- [ ] Assumptions and open questions are explicit

Write the final report to `<module-name>-threat-model.md` (e.g. `resonate-threat-model.md`, `contracts-threat-model.md`).

Summarize findings to the user and tell them where the report was saved.
