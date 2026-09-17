---
title: "Personal Data Rights"
status: partial
owner: "@akoita"
issue: 1771
---

# Personal Data Rights

## Status

`partial`

**Export works end to end.** A signed-in person downloads everything Resonate
holds about them from Settings > Privacy, without an operator doing anything.

**Erasure does not exist yet.** It is slice 3 of #1771 and nothing in the app
offers it, promises it, or hints at it — deliberately, because a delete control
that does not propagate is the false promise #1770 was opened to prevent.

| Slice | What it is | State |
| --- | --- | --- |
| 1 | Resolve a person to all five identifiers their data is keyed by | merged (#1785) |
| 2 | Export: endpoint, Settings surface, User Guide article | this page |
| 3 | Erasure and account closure | not started |

## Who It Is For

- Anyone with an account who wants to see, keep, or take away what we hold
  about them.
- Compliance reviewers who need the subject-access path to be real rather than
  an operator errand nobody has been asked to run.
- Developers adding a Prisma model, who will be stopped by a failing test until
  they say whether it holds personal data.

## How It Works

### A person is five identifiers, not one

`PersonalDataResolverService.resolve(userId)` returns the user id, the
pseudonymous analytics actor id, wallet addresses, the owner addresses behind
smart accounts, artist ids and session ids. Export queries every model by
whichever of those keys it actually uses.

This is the whole reason slice 1 existed. An export built from `userId` alone
would miss notifications (keyed by wallet address), analytics (keyed by the
derived actor id), and everything hanging off an artist profile — and would look
complete while doing it.

### The manifest is the contract, and a test enforces it

`backend/src/modules/privacy/personal_data_export_manifest.ts` classifies every
model in the schema: **75 exported, 19 not exported**, each exclusion carrying a
one-sentence reason a reviewer can check against the schema.

There is no "serialize every table" path, and that is not stylistic. A naive
dump of this schema would put `SessionKey.agentPrivateKey` — a raw ECDSA private
key whose own schema comment says it never leaves the backend — into a file the
account holder downloads over HTTP. Nine other fields are withheld on the same
grounds: passkey key material, wallet derivation salts, an integration webhook
URL. The records themselves are exported so a person can see what is registered
against their account and revoke it; the material inside them is not, and
redacted columns are left out of the Prisma `select` so they are never read out
of the database at all.

`personal_data_export_manifest.spec.ts` drives itself from the generated Prisma
DMMF and fails when:

- a model exists in the schema and in neither list — so a new model cannot ship
  unclassified;
- an exported model has a field whose name looks like a secret and which is
  neither redacted nor explicitly reviewed-as-safe with a written reason;
- the manifest names a model, column or field the schema no longer has.

The last two matter because the default is to export a new column. That is the
right default for a person's own data and the wrong one for a new secret, and
the test is what makes the difference safe.

### Streaming, not buffering

The response is written model by model, cursor-paginated in batches of 500 with
backpressure respected, so peak server memory is a function of the batch rather
than of how much history a person has.

One consequence is designed for rather than hidden: the status code is sent with
the first byte, so a failure part-way through cannot become a `500`. A finished
document ends with `"complete": true`, the failure is logged server-side, and a
reader — or a test — detects a partial file by that flag's absence.

### What it cannot be pointed at

The user id comes from `req.user.userId` and nowhere else: no path parameter, no
query string, no body. An integration test seeds two people and asserts each
export contains none of the other's rows, in both directions.

The route allows three requests per hour, counted **per person rather than per
IP**: the framework's default tracker is `req.ip`, which would make a household
behind one NAT share one account's budget while letting a stolen token lift the
limit by changing address.

Note that `ttl` is **milliseconds** in @nestjs/throttler v5+, so this route
passes `3_600_000` while the rest of the codebase passes second-shaped values
that are a thousand times shorter than they read — tracked as
[#1790](https://github.com/akoita/resonate/issues/1790).

A served export is logged (`privacy.personal_data_export.served`, user id only,
nothing from the file). Before that, only failures were recorded, which left the
most sensitive response in the API as the one with no trace of having been
made.

### Addresses are matched case-insensitively

Wallet-keyed tables hold the same address in more than one case, because some
write paths lowercase and others pass the EIP-55 checksummed value through. The
resolver returns lowercase, so a case-sensitive match would return part of a
person's data and look complete.

Matching uses Prisma's `mode: "insensitive"`, which Postgres implements with
`ILIKE` — where `%` and `_` are wildcards. Only values matching `/^0x[0-9a-f]+$/`
take that path; anything else falls back to a case-sensitive comparison, so a
stored value containing a wildcard character cannot widen the match across
people. The durable fix is normalizing at write time and backfilling, which is
slice 3's first decision.

## Honest Limits

Stated in the app beside the download control, in the User Guide article, and in
a `notIncluded` section inside the file itself. They must stay consistent with
the privacy policy from #1769 once that exists.

- **On-chain records.** Our copy is in the file; the ledger keeps its own,
  permanently, and we cannot alter it.
- **IPFS content.** We can stop serving our copy. We cannot make a node we do
  not control forget theirs.
- **Audit-preserved analytics.** Retained under the retention policy so that a
  deletion stays provable. Those still linked to the person are included.
- **Security material.** Withheld, as above.
- **Reports other people filed about them.** Those contain the reporter's
  personal data, which is theirs to request.

### One limit that is a bug, not a policy

`runRetentionCleanup` never reaches the warehouse, so analytics events past
their retention window are deleted from Postgres and left in BigQuery. The
export reads Postgres, so past that window it would omit them —
[#1789](https://github.com/akoita/resonate/issues/1789). Latent today only
because the ledger is younger than the shortest window. The fix belongs in
retention, not in the export: having the export read BigQuery would make the
divergence permanent and put a cloud dependency in a user-facing request.

## Surfaces

| Surface | Where |
| --- | --- |
| `GET /privacy/export` | `backend/src/modules/privacy/privacy.controller.ts` |
| Export service | `backend/src/modules/privacy/personal_data_export.service.ts` |
| Model classification | `backend/src/modules/privacy/personal_data_export_manifest.ts` |
| Identifier resolution | `backend/src/modules/identity/personal_data_resolver.service.ts` |
| Settings panel | `web/src/components/settings/DataExportPanel.tsx` |
| User Guide | `download-your-data` in `web/src/lib/help/content.ts` |
| Inventory and its corrections | `docs/engineering/personal-data-inventory.md` |

## Verification

```bash
cd backend && npm run test -- personal_data_export_manifest privacy_export
cd backend && npm run test:integration -- personal_data_export
cd web && npx vitest run src/components/settings/DataExportPanel.test.tsx src/lib/help/help.test.ts
```

## For Slice 3

- **Export is not the inverse of erasure.** `EXPORTED_MODELS` must not be reused
  as a deletion list. On-chain mirrors are exported deliberately and retained
  deliberately.
- **`ContractEvent` and `ShowCampaignEscrowEvent` are unreachable by column.**
  The export skips them because nothing names a person outside an untyped JSON
  blob. That is a reason not to export them, not evidence the data is absent.
- **Category 2 needs explicit handling.** No cascade reaches it;
  `WebAuthnCredential` is authentication material with a dangling `userId`.
- **Decide the address-casing fix** before erasure runs against wallet-keyed
  tables. Under-deleting is worse than under-exporting.
