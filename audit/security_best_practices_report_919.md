# Security Best Practices Report - Issue 919

## Executive Summary

Issue 919 adds analytics ingestion for existing backend domain events. The new
bridge uses an explicit allowlist of event names and payload keys, keeps the
events pseudonymous, converts non-JSON scalars such as bigint values to strings,
and excludes bulky user-supplied content such as generation prompts,
notification titles, notification bodies, and raw preference objects.

## Critical Findings

None found in the changed files.

## High Findings

None found in the changed files.

## Medium Findings

None found in the changed files.

## Low Findings

None found in the changed files.

## Review Notes

- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
  performs analytics shaping with an explicit bridge config instead of copying
  full domain event payloads.
- Error and reason fields are truncated before ingest.
- Source references are scalar-only strings, avoiding accidental object or
  binary payload persistence.
- Focused tests assert that prompts, notification bodies, notification titles,
  raw preferences, and remix titles are not persisted into analytics events.

## Commands Run

```bash
cd backend && npm run lint
cd backend && npx jest --runInBand src/tests/analytics_warehouse.spec.ts src/tests/analytics.spec.ts src/tests/analytics_domain_event_bridge.spec.ts
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg 'JSON\.parse|eval\(' backend/src/
rg '@Body\(\)|@Query\(\)|@Param\(' backend/src/
```

The repository-wide scans returned pre-existing findings outside this change,
such as JWT dev fallbacks, structured logging redaction patterns, existing
Prisma raw SQL uses, existing JSON parsing, and existing controllers using
NestJS body/query/param decorators. No new issue-919 finding was identified.
