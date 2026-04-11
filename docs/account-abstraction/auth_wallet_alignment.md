# Phase 4: Auth + Wallet Alignment

## Responsibility Split

- **Frontend**: collects user identity proof (wallet signature), stores JWT, calls API.
- **Backend**: validates signature + nonce, issues JWT, enforces roles.

## Current Alignment Plan

- `/auth/nonce` issues nonce bound to address.
- `/auth/verify` verifies signature and nonce, issues JWT.
- JWT subject = address (lowercase).
- Admin role only if address in `ADMIN_ADDRESSES`.

### Local Dev Helper

For local development only, you can add a wallet to the admin allow-list with:

```bash
make grant-admin-dev ADDRESS=0x...
```

This updates [backend/.env](/home/koita/dev/web3/resonate/backend/.env), then you need to restart the backend and reconnect the wallet so a fresh JWT is issued with the `admin` role.

## Wallet Consistency

- Wallet record keyed by userId (address).
- AA metadata stored server-side.
- Provider switching and refresh done via admin endpoints.

## Next Steps

- Wire frontend to SIWE-style sign-in.
- Add typed API client and shared models.

## Implementation Status

> The auth + wallet alignment described above is implemented. See [Account Abstraction Integration](../account-abstraction.md) for the current architecture, auth flow, and API reference.
