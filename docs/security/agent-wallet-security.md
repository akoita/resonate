# Agent Wallet Security — Private Key Management

> **Architecture**: The AI agent owns an ECDSA keypair. The private key
> **never leaves the backend**. The user grants on-chain permissions to the
> agent's public address via their passkey.

---

## Security Layers

| Layer                      | What                                  | How                                                |
| -------------------------- | ------------------------------------- | -------------------------------------------------- |
| **Encryption at rest**     | Private key encrypted before DB write | AES-256-GCM (local) or GCP Cloud KMS (production)  |
| **Short-lived decryption** | Key zeroed from memory after signing  | `SensitiveBuffer.zero()` in `finally` block        |
| **Column-level DB access** | Restricted `SELECT` on key column     | `app_readonly` role cannot query `agentPrivateKey` |
| **Audit logging**          | Every key access logged               | `KeyAuditLog` table (append-only)                  |
| **Key rotation**           | Periodic key regeneration             | `POST /wallet/agent/rotate` + frontend re-approval |

---

## Encryption Providers

Set `KMS_PROVIDER` env var to choose:

### Local (Development / Staging)

```env
KMS_PROVIDER=local
AGENT_KEY_ENCRYPTION_KEY=<64-char hex string>  # 32 bytes
```

Generate a key:

```bash
# Using the utility script
./scripts/generate-agent-encryption-key.sh

# Or manually
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Storage format: `enc:<base64(nonce[12] + ciphertext + authTag[16])>`

### GCP Cloud KMS (Production)

```env
KMS_PROVIDER=gcp-kms
GCP_KMS_KEY_NAME=projects/{project}/locations/{location}/keyRings/{ring}/cryptoKeys/{key}
```

#### One-time GCP setup:

```bash
# 1. Create key ring
gcloud kms keyrings create resonate-keys --location=europe-west1

# 2. Create encryption key (HSM-backed)
gcloud kms keys create agent-key-encryption \
  --keyring=resonate-keys \
  --location=europe-west1 \
  --purpose=encryption \
  --protection-level=hsm

# 3. Set env var (full resource name)
export GCP_KMS_KEY_NAME=projects/$(gcloud config get project)/locations/europe-west1/keyRings/resonate-keys/cryptoKeys/agent-key-encryption
```

Storage format: `kms:<base64(ciphertext from KMS)>`

#### Authentication:

| Environment           | Auth Method                              |
| --------------------- | ---------------------------------------- |
| GCE / GKE / Cloud Run | Automatic via metadata server            |
| Local dev             | `gcloud auth application-default login`  |
| CI/CD                 | `GOOGLE_APPLICATION_CREDENTIALS` env var |

---

## Short-Lived Decryption

The `SensitiveBuffer` class ([`sensitive_buffer.ts`](../backend/src/modules/shared/sensitive_buffer.ts)) wraps the decrypted key in a `Buffer` — not a JS string — so memory can be deterministically overwritten:

```typescript
// In AgentPurchaseService.purchase():
const agentKeyData = await this.agentWalletService.getAgentKeyData(userId);
try {
  txHash = await sendSessionKeyTransaction(
    agentKeyData.agentPrivateKey.toString(),  // one-time read
    agentKeyData.approvalData,
    ...
  );
} finally {
  agentKeyData.agentPrivateKey.zero();  // overwrite memory with 0x00
}
```

After `.zero()`, calling `.toString()` throws.

---

## Column-Level DB Access

Run the SQL migration manually (`prisma/sql/restrict_agent_key_column.sql`):

```bash
psql -U postgres -d resonate -f backend/prisma/sql/restrict_agent_key_column.sql
```

This creates an `app_readonly` PostgreSQL role:

- ✅ Can SELECT all columns except `agentPrivateKey`
- ❌ Cannot `SELECT "agentPrivateKey" FROM "SessionKey"`

Use this role for dashboards, analytics, and read-only replicas.

---

## Audit Logging

Every key operation writes to the `KeyAuditLog` table:

| Action     | Trigger                  | Logged Context             |
| ---------- | ------------------------ | -------------------------- |
| `enable`   | `createPendingSession()` | agentAddress               |
| `activate` | `activateSessionKey()`   | agentAddress, txHash       |
| `decrypt`  | `getAgentKeyData()`      | agentAddress, reason       |
| `revoke`   | `markRevoked()`          | agentAddress, revokeTxHash |
| `rotate`   | `rotateAgentKey()`       | new + old agentAddress     |

Query examples:

```sql
-- All key accesses for a user
SELECT * FROM "KeyAuditLog" WHERE "userId" = 'user-123' ORDER BY "createdAt" DESC;

-- All decryptions in the last 24h
SELECT * FROM "KeyAuditLog" WHERE action = 'decrypt' AND "createdAt" > NOW() - INTERVAL '24 hours';

-- Rotation history
SELECT * FROM "KeyAuditLog" WHERE action = 'rotate' ORDER BY "createdAt" DESC;
```

---

## Key Rotation

### API

```
POST /wallet/agent/rotate
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "permissions": { ... },      // optional, uses defaults
  "validityHours": 24           // optional, default 24
}
```

Response:

```json
{
  "agentAddress": "0xNewAddress...",
  "oldAgentAddress": "0xOldAddress..."
}
```

### Frontend

```typescript
import { rotateAgentKey } from "@/lib/api";

const { agentAddress, oldAgentAddress } = await rotateAgentKey(token);
// Frontend must re-approve permissions for the new agentAddress
```

### What happens:

1. New ECDSA keypair generated on the backend
2. Old session key revoked in DB
3. New key encrypted and stored
4. Returns new agent address → frontend must call `grantSessionKey(agentAddress)` to re-approve

---

## File Map

| File                                                                                               | Purpose                               |
| -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`crypto.service.ts`](../backend/src/modules/shared/crypto.service.ts)                             | AES-256-GCM / GCP KMS encrypt/decrypt |
| [`sensitive_buffer.ts`](../backend/src/modules/shared/sensitive_buffer.ts)                         | Zero-after-use key wrapper            |
| [`key_audit.service.ts`](../backend/src/modules/shared/key_audit.service.ts)                       | Append-only audit logger              |
| [`zerodev_session_key.service.ts`](../backend/src/modules/identity/zerodev_session_key.service.ts) | Agent key lifecycle management        |
| [`restrict_agent_key_column.sql`](../backend/prisma/sql/restrict_agent_key_column.sql)             | Column-level DB restriction           |
| [`generate-agent-encryption-key.sh`](../scripts/generate-agent-encryption-key.sh)                  | Key generation utility                |

## Environment Variables

| Variable                   | Required  | Provider | Description                      |
| -------------------------- | --------- | -------- | -------------------------------- |
| `KMS_PROVIDER`             | No        | —        | `local` (default) or `gcp-kms`   |
| `AGENT_KEY_ENCRYPTION_KEY` | For local | local    | 64-char hex (32-byte AES key)    |
| `GCP_KMS_KEY_NAME`         | For GCP   | gcp-kms  | Full KMS CryptoKey resource name |
