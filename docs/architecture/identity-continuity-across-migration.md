# Identity Continuity Across a GCP-Project Migration

**Status:** implemented · **Issue:** #1407 · **Epic:** akoita/resonate-iac#185
(Portable Deployments) · **Design:**
[`resonate-iac/docs/gcp-project-data-migration-design.md`](https://github.com/akoita/resonate-iac/blob/main/docs/gcp-project-data-migration-design.md)

## The guarantee

When the deployment moves to a fresh GCP project (free-trial-credit rotation),
**every user keeps their account with no action beyond signing in again**. A
returning user authenticates with the same device passkey and lands on the same
smart account with all their data.

This holds because a Resonate user is **not** anchored to the GCP project:

- **The passkey lives on the user's device** (WebAuthn P-256), never on the
  server.
- **The smart account address is CREATE2-deterministic** from that passkey +
  the AA factory/EntryPoint/`chainId` — the same passkey always derives the
  same address, independent of any server state.
- **Postgres holds only the mapping** (`PasskeyIdentity.publicKeyHash → userId`,
  `Wallet.userId → address`) and the user's data — which the migration copies
  wholesale.
- **On-chain state (Base Sepolia) is untouched** — contracts are addressed by
  env, so the same chain + same contract config preserves wallets, pledges,
  NFTs, and listings with zero migration.

## What the migration must preserve (enforced by the preflight)

The migration tool's preflight (`resonate-iac scripts/migration/preflight.sh`)
**fails closed** unless the target preserves the identity invariants, because a
drift would make the same passkey derive a *different* smart account and orphan
every user's on-chain assets:

- `chain_id` — unchanged.
- `zerodev_project_id` and the AA factory/EntryPoint — unchanged (drive the
  deterministic derivation).
- every contract-address key — unchanged (same chain).
- `agent_key_encryption_key` (`ENCRYPTION_SECRET`) — **carried** to the target
  (compared by hash, never printed) so AES-encrypted AI-agent session keys stay
  decryptable. It is a raw AES key in tfvars on staging (not Cloud KMS), so
  carrying it is a copy, not a KMS grant.

`JWT_SECRET` may rotate: old JWTs invalidate, which the client handles as a
guided re-login (below), not as data loss.

## Re-login, not reset

Backend `GET /health` exposes `RESONATE_ENVIRONMENT_ID`
(`${environment}-${sha256(project_id)[:8]}`, so it is **stable within a project
and changes exactly when the project changes**) and `RESONATE_DATA_EPOCH`. The
client (`web/src/lib/appEnvironment.ts`) compares its stored stamp to
`/health`; on change it shows the guided **session-reset dialog** — which
clears only the local browser session and JWT, then the user signs in again.
The copy already reflects this ("you'll simply use it to sign in again"; "this
only clears your browser's saved session") — after a data-preserving migration
the user is prompted to re-authenticate, **not** told their data was wiped.

## Proving continuity

`backend/src/scripts/resolve_identity.ts` (`npm run identity:resolve`) is a
read-only diagnostic that maps a passkey (or wallet) to its canonical
`{ userId, walletAddress, chainId }`. Because the mapping is deterministic,
running it against the **source** DB and again against the **target** DB for
the same passkey yields identical output — that equality **is** the continuity
proof, and it is what the migration verification gate (#1408) asserts before
the source project is decommissioned.

```bash
# same output on source and target = the user's account survived
npm run identity:resolve -- --public-key-hash <sha256hex>
npm run identity:resolve -- --wallet 0x<address>
```

Exit code: `0` when found, `1` when the selector resolves nothing (so a gate
can treat "known user missing on target" as a failure), `2` on bad input.

The property is covered by `backend/src/tests/resolve_identity.integration.spec.ts`,
including a case that deletes and re-creates the same rows (a simulated
dump→restore) and asserts the resolution is byte-identical.
