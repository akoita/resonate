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

**Export and erasure both work end to end.** A person downloads their data, and
schedules their own account closure and erasure, without an operator touching
anything.

| Slice | What it is | State |
| --- | --- | --- |
| 1 | Resolve a person to all five identifiers their data is keyed by | merged (#1785) |
| 2 | Export: endpoint, Settings surface, User Guide article | this page |
| 3a | Erasure engine, closure state machine, operator endpoint | merged (#1795) |
| 3b | Settings door, signature step-up, cancel-on-sign-in | this page |

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

The window is written with `hours(1)` from
`backend/src/modules/shared/rate_limits.ts`, because `ttl` is milliseconds and
second-shaped values had made every limit in the API a thousand times shorter
than it read ([#1790](https://github.com/akoita/resonate/issues/1790), fixed).
A test now fails on any throttled route whose window is under a second.

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

## What an erasure does

**It anonymizes in place and closes the account. It never deletes the `User`
row** — and it rotates `User.id` to a fresh UUID, because for a wallet or
passkey account that id *is* the person's wallet address. Scrubbing the email
while keeping the id would have left the address as the primary key across 43
models. Every foreign key is `ON UPDATE CASCADE` (103 of 103), so the rotation
reaches relation-linked tables by itself; the columns that hold a user id
without a declared relation are enumerated in the erasure manifest and rewritten
by hand, because a missed one keeps the address forever and nothing fails.

**Order matters and is not obvious.** Analytics are erased *before* the id
rotates. The pseudonymous actor id derives from `userId`, so rotating first
makes every historical actor id underivable and the erasure misses all of it
while reporting success.

Each model carries a disposition in
`backend/src/modules/privacy/personal_data_erasure_manifest.ts`, enforced by a
DMMF-driven test that fails when the schema gains a model:

| Disposition | What it means |
| --- | --- |
| `delete` | Nothing of value survives the person — credentials, taste state, preferences. |
| `anonymize` | The row stays for its non-personal content; the named columns are scrubbed. |
| `retain` | Financial, rights and audit records under a legal retention obligation. |
| `detach` | Artist-scoped. The catalogue survives; `Artist.userId` goes null. |
| `governance` | Analytics, handled by `AnalyticsGovernanceService` from #1770. |
| `untouched` | No column names the person. |

**The address survives in financial records; the link does not.** Those rows
keep the wallet address under the retention the privacy policy states, but the
`Wallet` row, `PasskeyIdentity` and `SignupFaucetAttempt` are deleted — so
nothing in the database resolves that address back to an account. Doing it the
other way round would cost operator reconciliation and give the person nothing,
since the chain publishes the address anyway.

**An artist's erasure is not a private act**, so artists detach rather than
disappear: their releases are withdrawn through #1793 rather than deleted out
from under the people who bought them.

**The deletion log does not become a copy of what was deleted.** Lineage rows
used to carry the erased event's identifiers verbatim, which for bridge-emitted
events meant the wallet address stayed in the log proving its own removal.
Address-shaped identifiers are now pseudonymized at the log writer; non-person
subject ids pass through, because an audit trail nobody can read is not one.
**Rows written before this need a backfill** — nothing rewrites history.

## Asking for deletion

Scheduling an erasure takes two deliberate acts: a confirmation that states what
is about to happen, and **a signature over a message that names the action**.
For a passkey account that signature *is* a passkey prompt, so the person
authorises the deletion the same way they sign in.

**The server composes that message and verifies against its own reconstruction
of it — never against a string the client sent.** Accepting a client-supplied
message would let a caller obtain a signature over one text and submit it as
consent to another, and naming the action would buy nothing.

The step-up is a signature rather than a WebAuthn assertion for a structural
reason worth recording, because "require a passkey assertion" is the obvious
first design and it does not work here: `WebAuthnCredential.userId` is a
`randomUUID()` minted per registration and unrelated to `User.id`, so a verified
assertion proves someone holds *a* passkey, not that they hold *this account's*.
Tying the two together would mean re-deriving a public-key hash through
`PasskeyIdentity` — a new authentication path invented to guard an irreversible
action. The signature route reuses the proven sign-in machinery instead.

### Two asymmetries, both deliberate

**Cancelling requires no signature.** Requiring proof to *stop* an irreversible
deletion would mean somebody who lost their signer could not save their own
account. Cancelling is the safe direction: the worst case is an account that
survives when its owner wanted it gone, and they can ask again.

**Signing in cancels a pending request.** This is not a convenience. There is no
outbound email channel in this backend (#1777), so **signing in is the only way
a real owner can discover and stop an erasure that somebody else scheduled with
a stolen token.** The cancel is awaited and its failure logged loudly rather than
dispatched and forgotten, because a silently dropped cancel means an account
erased after its owner tried to save it.

### The 30-day window

Nothing happens for 30 days (`ACCOUNT_CLOSURE_WINDOW_DAYS`). One active request
per person, enforced by a partial unique index rather than an application check,
because a double-submitted request racing itself would schedule the engine twice
against the same account and the second run would find a person who no longer
exists.

The pending state is visible outside Settings, in the app shell, with no dismiss
control — somebody who did not schedule it needs to find out without going
looking. It deliberately does not join the fixed bottom stack where the
analytics consent banner sits: that banner already wins a documented stacking
contest against the update pill (#1772), and a third undismissable element in
one corner would reopen it. A deletion deadline is a state of the account rather
than an interruption, so it takes layout space instead of covering anything.

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

### One limit that was a bug, not a policy

`runRetentionCleanup` did not reach the warehouse, so analytics events past
their retention window were deleted from Postgres and left in BigQuery — and
since the export reads Postgres, past that window it would have omitted them.
Fixed in [#1789](https://github.com/akoita/resonate/issues/1789): retention now
propagates exactly as an erasure does.

The fix belonged in retention rather than in the export. Having the export read
BigQuery would have made the divergence permanent and put a cloud dependency in
a user-facing request.

The retention entry point is designed for external scheduling and defaults to
dry-run so activation and destructive retention remain separate operator
decisions. Per-environment scheduling state belongs in the private
infrastructure tracker rather than this public feature page.

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

## Still missing

- **Nothing invokes the scheduled erasures yet** ([#1797](https://github.com/akoita/resonate/issues/1797)).
  The engine, the endpoint and the entry point
  (`backend/src/scripts/run_due_erasures.ts`) exist, and the operator procedure
  is in [the runbook](../operations/account_erasure_runbook.md) — but no Cloud
  scheduled job invokes it, so a due request waits for someone to run it by hand.
  How that is wired is deployment configuration and lives in the infrastructure
  repository.
  This is what still blocks the privacy policy's "When you delete" section from
  publication, and it is the difference between the 30-day promise being true
  and being a sentence in a panel. The remaining work is infrastructure.
- **The step-up accepts an unverifiable signature as a last resort**
  ([#1798](https://github.com/akoita/resonate/issues/1798)). Narrowed — ERC-6492
  validation no longer requires the account to have bytecode, which is what
  6492 is for — but the `nonce_only` rung remains for a signature that is
  neither recoverable nor checkable on chain.
- **`ANALYTICS_ACTOR_ID_SALT` is unset everywhere**
  ([#1796](https://github.com/akoita/resonate/issues/1796)), so analytics
  erasure completeness currently depends on nobody rotating `JWT_SECRET`.
- **Pre-#1795 governance lineage rows still hold raw wallet addresses** and want
  a backfill. New rows are pseudonymized; history is not rewritten.
- No help-article screenshots: capturing them needs a running stack and seeded
  accounts.

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
- **An artist's erasure is not a private act.** Their releases were bought,
  their punchlines are held, their campaign took other people's money, so
  erasure cannot delete a catalogue other people paid into. The mechanism it
  needs is [Release Withdrawal](release_withdrawal.md) (#1793): withdraw the
  streaming licence, leave every purchase whole, and detach the profile from
  the person — `Artist.userId` is already nullable.
