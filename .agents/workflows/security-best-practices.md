---
description: Review codebase for security best practices — scan for vulnerabilities and produce a prioritized report
---

# Security Best Practices Review

Identify the languages and frameworks in use, then review the codebase against known security best practices to detect vulnerabilities and produce a prioritized report.

> Adapted from [Trail of Bits openai-security-best-practices](https://github.com/trailofbits/skills-curated/tree/main/plugins/openai-security-best-practices). Licensed under their original terms.

## When to use

- Starting a new feature that touches authentication, authorization, or data handling
- Reviewing PRs with security-sensitive changes
- When the user asks for a security audit of backend or frontend code
- Periodically as a health check on the codebase

## Resonate stack context

| Layer     | Tech                     | Key concerns                                           |
| --------- | ------------------------ | ------------------------------------------------------ |
| Backend   | NestJS + Prisma + BullMQ | Auth, input validation, SQL injection, queue poisoning |
| Frontend  | Next.js + React          | XSS, CSRF, auth token handling, SSR data leaks         |
| Contracts | Solidity + Foundry       | Use `/smart-contract-scan` workflow instead            |
| Infra     | Cloud Run + Redis + GCS  | Secret management, bucket ACLs, env var hygiene        |

## Workflow

### 1. Identify scope

Determine which parts of the codebase to review:

- Check `backend/src/` for NestJS modules, services, controllers, guards
- Check `web/src/` for Next.js pages, API routes, components handling auth
- Check environment variable usage against `AGENTS.md` conventions

### 2. Scan for common vulnerabilities

#### Backend (NestJS / TypeScript)

```
# Hardcoded secrets
rg -l -i 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'

# SQL injection / raw queries
rg '\$(queryRaw|executeRaw)(Unsafe)?' backend/src/

# Controller entry points: inspect method, controller, and global guards
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/

# Unsafe deserialization
rg 'JSON\.parse|eval\(' backend/src/

# Input entry points: trace DTOs and local/global validation pipes
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/
```

#### Frontend (Next.js / React)

```
# XSS vectors
rg 'dangerouslySetInnerHTML|innerHTML' web/src/

# Exposed secrets in client code
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/

# Insecure cookie handling
rg 'document\.cookie|setCookie|httpOnly.*false' web/src/
```

Search matches are review candidates, not proof of missing guards or validation.
Inspect inherited/global controls and reachable call paths. An empty pattern scan
is not evidence that the code is secure. Avoid copying credential values into
reports or tool output; use filenames/redacted evidence for secret candidates.

### 3. Evaluate findings

For each finding:

- Confirm it's a real vulnerability (not a test file, not behind proper guards)
- Assess severity: Critical → High → Medium → Low → Informational
- Note the file path and line numbers

### 4. Produce report

Write the report to `audit/security_best_practices_report.md` (create the `audit/` directory if it doesn't exist):

```markdown
# Security Best Practices Report

## Executive Summary

[1-2 sentence summary of overall security posture]

## Critical Findings

### SBPR-001: [Title]

**File:** `path/to/file` L{N}
**Impact:** [one sentence]
**Recommendation:** [specific fix]

## High Findings

...

## Medium Findings

...

## Low Findings

...
```

### 5. Offer fixes

After presenting the report:

- Focus on one finding at a time
- Add concise comments explaining security rationale
- Check that fixes don't break existing functionality
- Follow the project's commit conventions from `AGENTS.md`
- Run focused tests and relevant lint checks from [finish-issue](finish-issue.md).

## General security advice

- **Use UUIDs, not incrementing IDs** for public resource identifiers
- **Never report TLS absence as a vulnerability** in local dev — TLS is handled by infrastructure in production
- **Don't set `secure` cookies in dev** — it will break non-HTTPS environments
- **Avoid recommending HSTS** unless fully understood — it can cause major outages
- **Follow `AGENTS.md` env var conventions** — no hardcoded URLs, ports, or secrets
