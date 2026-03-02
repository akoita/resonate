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
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'

# SQL injection / raw queries
rg 'rawQuery\|executeRaw\|\$queryRaw' backend/src/

# Missing auth guards
rg '@Controller\|@Get\|@Post\|@Put\|@Delete\|@Patch' backend/src/ | grep -v 'Guard\|Auth'

# Unsafe deserialization
rg 'JSON\.parse\|eval\(' backend/src/

# Missing input validation
rg '@Body\(\)\|@Query\(\)\|@Param\(\)' backend/src/ | grep -v 'Pipe\|Dto\|Validation'
```

#### Frontend (Next.js / React)

```
# XSS vectors
rg 'dangerouslySetInnerHTML\|innerHTML' web/src/

# Exposed secrets in client code
rg 'NEXT_PUBLIC_.*SECRET\|NEXT_PUBLIC_.*KEY\|NEXT_PUBLIC_.*PASSWORD' web/src/

# Insecure cookie handling
rg 'document\.cookie\|setCookie\|httpOnly.*false' web/src/
```

### 3. Evaluate findings

For each finding:

- Confirm it's a real vulnerability (not a test file, not behind proper guards)
- Assess severity: Critical → High → Medium → Low → Informational
- Note the file path and line numbers

### 4. Produce report

Write the report to `security_best_practices_report.md`:

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
- Run `npm run lint` in both `backend/` and `web/` after fixes

## General security advice

- **Use UUIDs, not incrementing IDs** for public resource identifiers
- **Never report TLS absence as a vulnerability** in local dev — TLS is handled by infrastructure in production
- **Don't set `secure` cookies in dev** — it will break non-HTTPS environments
- **Avoid recommending HSTS** unless fully understood — it can cause major outages
- **Follow `AGENTS.md` env var conventions** — no hardcoded URLs, ports, or secrets
