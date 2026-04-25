# Security Best Practices Report

## Executive Summary

Reviewed the Sepolia signup faucet implementation on
`feat/666-sepolia-signup-faucet`. No Critical or High findings were identified
in the changed code.

## Scope

- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/auth/auth.module.ts`
- `backend/src/modules/auth/signup_faucet.service.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260425042000_signup_faucet_attempts/migration.sql`
- `web/src/components/auth/AuthProvider.tsx`
- `web/src/lib/api.ts`
- `backend/.env.example`
- `docs/smart-contracts/deployment.md`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

None in the changed code.

## Informational Notes

- The faucet is disabled by default and only runs when
  `SIGNUP_SEPOLIA_FAUCET_ENABLED` is explicitly enabled.
- The backend requires both the browser-reported signup chain and the server RPC
  chain to match the configured Sepolia chain ID before funding.
- Funding uses environment-provided secrets only. The code does not commit a
  deployer key, faucet key, RPC key, or production URL.
- Idempotency is backed by a unique Prisma record over user, wallet, chain, and
  faucet purpose before sending ETH, preventing repeated signup retries from
  draining the funder.
- Funding failures are persisted as failed faucet attempts and are caught after
  token issuance so signup remains available.
- Scan output included pre-existing references such as local `dev-secret`
  fallbacks and public Pimlico key configuration; these are outside this change
  and were not introduced by the faucet.

## Commands Run

```bash
rg -n 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg -n 'dangerouslySetInnerHTML|innerHTML' web/src/
rg -n 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/auth backend/src/modules/identity backend/src/modules/contracts
rg -n 'JSON\.parse|eval\(' backend/src/modules/auth backend/src/modules/identity backend/src/modules/contracts
rg -n '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/auth backend/src/modules/identity
rg -n 'document\.cookie|setCookie|httpOnly.*false' web/src/
```
