---
title: "Target Cutover Verification"
status: partial
owner: "@akoita"
---

# Target Cutover Verification

Target cutover verification is the fail-closed application gate for proving a
migrated Resonate environment before traffic moves. It combines existing data
and identity checks with target smoke, deployment identity, and rollback
evidence. A green receipt means the reviewed checks agree; it does not authorize
a migration, deployment, DNS change, contract change, or production launch.

This capability is `partial`. The repository-side verifier and secret-free
evidence contract are available. Issue
[#1663](https://github.com/akoita/resonate/issues/1663) remains open until an
authorized target run supplies the reviewed configuration matrix, strict
migration receipts, cross-system smoke evidence, exact live image reconciliation,
and agreed rollback and source-retention windows.

## Who uses it

Migration and release operators use the gate after target infrastructure and
data are prepared but before any edge or DNS cutover. Application maintainers
review the evidence contract. Infrastructure mutation, source freezing, URI
rewrites, allowlist replay, Cloud Run inspection, and DNS rollback remain owned
by [`resonate-iac`](https://github.com/akoita/resonate-iac), particularly
[`resonate-iac#215`](https://github.com/akoita/resonate-iac/issues/215).

## Safety boundary

Repository-side verification is read-only. It must never retain database URLs,
tokens, private keys, secret values, allowlist members, wallet-address lists, or
matched database content. Source-reference scans retain only stable labels,
counts, and table/column locations. The final receipt records classifications,
booleans, hashes, image digests, runtime revision names, and HTTPS evidence
links.

Authenticated or mutating smoke checks require an owner-approved disposable
account and content fixture with a cleanup contract. Do not point the existing
staging Shows lifecycle smoke at a production target: it performs on-chain and
application writes. Target migration and smoke execution remain protected
manual operations until the required infrastructure workflow and target
fixtures exist.

## Required configuration review

The source/target matrix records a pass and either `equal` or
`reviewed-change` for every category below. It records no values.

| Category | What the reviewer proves |
| --- | --- |
| Environment identity | Environment identifier and data epoch intentionally describe the target. |
| Public origins | Frontend, API, desktop, and callback origins form one coherent target. |
| CORS and WebAuthn | Allowed origins, relying-party ID, and guided reauthentication behavior agree. |
| Chain, AA, and contracts | Chain ID, EntryPoint, bundler/paymaster, account factory, and contract addresses preserve the accepted invariants. |
| x402 and payment | Network, asset, facilitator, settlement, and public configuration agree without exposing credentials. |
| Storage | Configured content storage resolves target objects and no source-qualified URI remains. |
| Demucs | Queue, job, callback, storage, and runtime identity belong to the target. |
| Analytics mode | Streaming, batch, or deliberately disabled behavior is selected and evidenced. |
| Runtime allowlists | Admin and agent allowlists are equal by sanitized comparison, without retaining members. |

The canonical variable inventory is
[`docs/deployment/environment.md`](../deployment/environment.md). Deployment-
specific values remain in environment configuration and `resonate-iac`, never
in this repository.

## Verification sequence

1. Capture source and target migration snapshots with strict cutover checks, a
   reviewed identity, exact sample content, and labelled source project/bucket
   references. Compare the snapshots and retain their hashes and sanitized
   receipt.
2. Consume the `resonate-iac#215` proof that post-import URI rewrite, source-
   reference scan, runtime allowlist equality, and target configuration checks
   passed.
3. Run health, guided passkey reauthentication, disposable upload,
   playback/download, Demucs, selected analytics, x402/payment configuration,
   and public origin/edge checks. Every check needs an HTTPS evidence link.
4. Compare the accepted manifest source SHA and image digests with the live
   backend, frontend, and Demucs revisions. Include stable-audio when selected
   by the accepted manifest.
5. Record the rollback trigger, retained-source window, observation window,
   and the fact that every red gate blocks cutover.
6. Validate the assembled JSON receipt locally:

   ```bash
   node scripts/target-cutover-smoke/validate-evidence.mjs \
     /path/to/secret-free-target-cutover-evidence.json
   ```

   Exit `0` prints a compact, non-authorizing summary. Exit `1` rejects invalid
   or red evidence. Exit `2` reports command usage errors.

## Evidence contract

The validator in `scripts/target-cutover-smoke/lib.mjs` requires schema
`resonate-target-cutover-evidence/v1`. Required sections are:

- `configuration`: all matrix categories, each with `status`, `comparison`,
  and an HTTPS evidence link;
- `migration`: strict-mode status, identity/row/cursor/sample results, source
  and target snapshot hashes, receipt hash, and evidence link;
- `sourceReferences`: zero remaining `source-project` and `source-bucket`
  references;
- `smoke`: health, passkey reauthentication, upload, playback/download,
  Demucs, analytics, x402/payment configuration, and origin/edge results;
- `deployment`: accepted and live source SHA, manifest hash, and exact expected
  versus live digests and revision names for each required service;
- `rollback`: blocking behavior, retained source, trigger, observation window,
  retention window, and evidence link;
- `authorization`: four explicit `false` values for migration, deployment,
  contract changes, and production go-live.

The validator rejects credentialed URLs and field names associated with
secrets, passwords, private keys, database URLs, tokens, allowlist members, or
wallet-address lists. This is defense in depth; operators must still inspect
the artifact before upload or retention.

## Test and failure behavior

Run the dependency-free validator checks with:

```bash
node --test scripts/target-cutover-smoke/lib.test.mjs
node --check scripts/target-cutover-smoke/lib.mjs
node --check scripts/target-cutover-smoke/validate-evidence.mjs
```

Any missing or non-pass gate, stale source reference, source-SHA mismatch,
image-digest mismatch, missing runtime revision, unsafe evidence shape, missing
rollback boundary, or authorization value other than `false` is a hard failure.
The retained source remains the rollback target; a red gate never decommissions
it and never silently downgrades to a warning.

## Related sources

- [Production GCP target decision](../architecture/production-gcp-target-decision.md)
- [Identity continuity across migration](../architecture/identity-continuity-across-migration.md)
- [Deployment architecture](../architecture/deployment_architecture.md)
- [Software release process](release_process.md)
- [Staging lifecycle smoke](staging_lifecycle_smoke.md)
- [Application migration parent #915](https://github.com/akoita/resonate/issues/915)
- [Target cutover verification #1663](https://github.com/akoita/resonate/issues/1663)
