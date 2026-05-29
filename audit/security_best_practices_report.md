# Security Best Practices Report

## Executive Summary

The #1015 marketplace listing lifecycle changes were reviewed for backend
authorization, data exposure, secret handling, raw SQL, XSS vectors, and client
secret exposure. No Critical or High findings remain in the branch after the
owner listing endpoint was tightened to require seller-linked or admin JWT
access.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

### SBPR-001: Owner Inventory Endpoint Must Stay Authenticated

**File:** `backend/src/modules/contracts/metadata.controller.ts`

**Status:** Fixed in this branch.

**Impact:** Owner listing inventory includes expired and cancelled listings that
public purchase surfaces intentionally hide. If exposed by wallet address
alone, this could reveal non-public seller inventory lifecycle details.

**Resolution:** `GET /api/metadata/listings/owner/:seller` now uses
`AuthGuard("jwt")` and allows only the seller address, a linked EOA/smart-account
wallet relation, or an admin. The frontend management page sends the bearer
token when loading owner inventory.

### SBPR-002: Malformed Signatures Should Fail Before Contract Verification

**File:** `backend/src/modules/encryption/providers/aes_encryption_provider.ts`

**Status:** Fixed in this branch.

**Impact:** Malformed non-hex wallet signatures could fall through from local
EOA verification into EIP-1271 verification. Without an explicit `RPC_URL`, that
path could wait on a default public transport and make invalid-signature checks
slow or flaky.

**Resolution:** The AES provider now rejects non-hex signatures immediately and
skips EIP-1271 verification unless `RPC_URL` is configured.

## Informational Findings

### SBPR-003: Existing Local Anvil Key Is Present In Dev Funding Helper

**File:** `web/src/lib/localFunding.ts`

**Impact:** The standard Anvil private key appears in source for local
development funding. This was pre-existing and not touched by #1015.

**Assessment:** Acceptable only for local development. Do not reuse this pattern
for shared testnet, staging, or production keys.

### SBPR-004: Public Client API-Key Environment Variables Are Present

**File:** `web/src/lib/bundlerConfig.ts`

**Impact:** `NEXT_PUBLIC_PIMLICO_API_KEY` is intentionally browser-exposed by
name. This was pre-existing and not touched by #1015.

**Assessment:** Treat it as a publishable client identifier, not a secret. Use
server-side proxying for any credential that must remain confidential.

## Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\\$queryRaw' backend/src/`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'JSON\\.parse|eval\\(' backend/src/modules/contracts/metadata.controller.ts backend/src/modules/contracts/contracts.service.ts backend/src/modules/notifications/notification.service.ts`
- `rg 'document\\.cookie|setCookie|httpOnly.*false' web/src/`
- targeted review of #1015 backend, notification, and owner-management UI
  changes.
