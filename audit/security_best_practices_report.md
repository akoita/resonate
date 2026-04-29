# Security Best Practices Report

## Executive Summary

Reviewed the passkey recovery and WebAuthn configuration changes for frontend
auth, deployment configuration, and backend sample environment variables. No
Critical or High findings were identified in the changed code.

## Scope

- `web/src/lib/passkeyConfig.ts`
- `web/src/components/auth/AuthProvider.tsx`
- `web/src/components/auth/ZeroDevProviderClient.tsx`
- `web/src/hooks/useContracts.ts`
- `web/Dockerfile`
- `web/.env.example`
- `backend/.env.example`
- `docs/deployment/environment.md`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None in the changed code.

## Low Findings

None in the changed code.

## Informational Notes

- Passkey server selection now comes from centralized environment-backed
  helpers instead of per-file configuration.
- `NEXT_PUBLIC_PASSKEY_SERVER_URL` and `NEXT_PUBLIC_PASSKEY_RP_ID` are public
  browser configuration values, not secrets. They are documented and passed
  through the frontend Docker build explicitly.
- Signup now reuses login mode when the browser has a recoverable smart-account
  address, reducing the risk of accidentally deriving a new account from an
  existing passkey browser state.
- A selected passkey that derives a different smart account than the saved
  browser account is rejected before backend authentication.
- The backend sample env now uses the variable names read by the WebAuthn
  service: `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN`.
- Broad scans surfaced pre-existing backend secret references and raw SQL in
  unrelated modules. They were reviewed as out of scope for this branch and are
  not introduced by these changes.

## Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg 'dangerouslySetInnerHTML|innerHTML' web/src/
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg 'document\.cookie|setCookie|httpOnly.*false' web/src/
cd backend && npm run lint
cd web && npm run lint
cd web && npm run build
git diff --check
```
