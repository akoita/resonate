# Security Best Practices Report — Issue #440

**Date:** 2026-03-11
**Branch:** `feat/440-content-protection-hierarchy`
**Scope:** All changed backend + frontend files

## Executive Summary

No Critical or High vulnerabilities introduced by #440. New `mint-authorization` controller is properly JWT-guarded. Several pre-existing Low/Info findings noted for future hardening.

| Severity | Count | New in #440? |
| -------- | ----- | :----------: |
| Critical | 0     |      —       |
| High     | 0     |      —       |
| Medium   | 0     |      —       |
| Low      | 2     |      No      |
| Info     | 2     |      No      |

---

## Low Findings

### SBPR-001: JWT_SECRET Dev Fallback

**File:** `backend/src/modules/auth/jwt.strategy.ts` L9, `auth.module.ts` L40
**Impact:** If `JWT_SECRET` env var is unset, falls back to `"dev-secret"` — a guessable value.
**Status:** Pre-existing, not introduced by #440.
**Recommendation:** Remove fallback; fail-fast if `JWT_SECRET` is not set in production.

### SBPR-002: Raw SQL in main.ts

**File:** `backend/src/main.ts` L38, L42
**Impact:** `$executeRaw` with template literals for URI normalization at startup. Not user-input-driven, but raw SQL bypasses Prisma's query builder.
**Status:** Pre-existing, not introduced by #440.
**Recommendation:** Acceptable for one-time migration; consider moving to a proper Prisma migration script.

---

## Informational Findings

### SBPR-003: Unguarded POST Endpoints in MetadataController

**File:** `backend/src/modules/contracts/metadata.controller.ts` (lines 656, 676, 1129, 1142, 1157)
**Impact:** 5 POST endpoints (`disputes`, `disputes/:id/evidence`, `indexer/reset`, `indexer/reindex-tx`, `notify-listing`) lack `@UseGuards`. Admin endpoints (`indexer/reset`, `indexer/reindex-tx`) could be abused.
**Status:** Pre-existing, not introduced by #440.
**Recommendation:** Add `@UseGuards(AuthGuard('jwt'))` to write endpoints; add role-based guard to admin indexer endpoints.

### SBPR-004: JSON.parse Without Schema Validation

**File:** `ingestion.controller.ts` L32, `stem-result.subscriber.ts` L90, `encryption.service.ts` L200
**Impact:** `JSON.parse` on incoming data without DTO/Zod validation. All inside try/catch, but malformed payloads could cause unhandled edge cases.
**Status:** Pre-existing, not introduced by #440.
**Recommendation:** Add input validation DTOs or Zod schemas to parse steps.

---

## #440-Specific Review

### New Files Introduced

| File                               |      Auth Guard       |   Input Validation   | Status |
| ---------------------------------- | :-------------------: | :------------------: | ------ |
| `mint-authorization.controller.ts` | ✅ JWT on both routes |  Body params typed   | Clean  |
| `mint-authorization.service.ts`    |     N/A (service)     | Private key from env | Clean  |
| `accountAbstraction.ts`            |  N/A (frontend util)  |          —           | Clean  |

### Scans Performed

| Scan                            | Scope          | Result                    |
| ------------------------------- | -------------- | ------------------------- |
| Hardcoded secrets               | `backend/src/` | ✅ No new secrets         |
| Raw SQL                         | `backend/src/` | ✅ No new raw queries     |
| `eval`/`JSON.parse`             | `backend/src/` | ✅ No new instances       |
| Missing auth guards             | `backend/src/` | ✅ New controller guarded |
| XSS (`dangerouslySetInnerHTML`) | `web/src/`     | ✅ None found             |
| Exposed client secrets          | `web/src/`     | ✅ None found             |
| Cookie handling                 | `web/src/`     | ✅ None found             |
