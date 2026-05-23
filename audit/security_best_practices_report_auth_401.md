# Security Best Practices Report - Staging Auth 401 Recovery

## Executive Summary

This change clears stale browser auth state when an authenticated API request
receives `401 Unauthorized`, then notifies the active `AuthProvider` so the UI
prompts the user to reconnect instead of remaining wallet-connected with a
dead JWT. No Critical or High findings were identified in the changed files.

## Scope

Changed frontend files reviewed:

- `web/src/lib/authSession.ts`
- `web/src/lib/api.ts`
- `web/src/lib/api.test.ts`
- `web/src/components/auth/AuthProvider.tsx`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

None in the changed files.

## Informational Notes

- The auth invalidation path removes only local session keys:
  `resonate.token`, `resonate.address`, `resonate.smartAccountAddress`, and
  `resonate.privy.userId`.
- The API client only invalidates browser auth when the failed request included
  a token. Public unauthenticated `401` responses do not clear state.
- Explicit mock-auth sessions used by Playwright/local development are not
  invalidated by backend `401` responses, because their token is intentionally
  UI-only and not a real backend JWT.
- Repository-wide frontend scans still show pre-existing public
  `NEXT_PUBLIC_*` configuration references for passkey and Pimlico browser
  configuration. They were not introduced or modified by this change.

## Commands Run

```bash
rg 'dangerouslySetInnerHTML|innerHTML' web/src/
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg 'document\.cookie|setCookie|httpOnly.*false' web/src/
```
