# Issue #1666 plan: validate versioned artwork caching on staging

## Outcome

Prove on staging that server-owned artwork revisions keep Release and Shows
replacements immediately visible while a bounded Next image-optimizer cache TTL
improves warm-cache behavior. Retain enough release, runtime, replacement, and
performance evidence to select or reject a nonzero staging TTL without changing
production.

This is vision-neutral infrastructure and quality work under ADR-BM-6. It does
not change fees, payouts, licensing, or product policy.

## Authorization and current gate

The owner approved a staging maintenance window and disposable fixtures on
2026-08-27. The owner also chose to wait for the monthly GitHub Actions allowance
renewal rather than purchase additional CI credits. Until that renewal, work is
limited to local inspection, fixture selection criteria, evidence templates, and
operator commands. Do not dispatch a release, change staging, or create an IaC
trial merely to test whether the budget gate has cleared.

No production deployment or production TTL change is authorized by this plan.

## Delivery status

- **Implemented in this branch:** the fail-closed staging runbook, sanitized
  evidence template and validator, private-fixture safeguards, focused tests,
  and documentation links needed for the maintenance window.
- **Deferred to the open #1666 operational window:** the staging release at TTL
  `0`, creation and mutation of approved fixtures, both five-pair measurements,
  the reviewed `resonate-iac` candidate, the TTL decision, and the final
  measured documentation update. These steps wait for the monthly Actions
  allowance renewal and are not authorized for production.

## Fixture contract

### Shows

Create a new staging-only draft campaign owned by the approved test identity.
The repository-owned `sample-show-campaigns/v1` records are not suitable for
this mutation: the seed makes them active, while the supported replacement API
correctly refuses visual changes outside the draft state. Do not bypass that
lifecycle guard or change an active sample record directly.

Keep the staging-only campaign in draft with authority status `none`; do not
request authority, attach an escrow, activate it, or create pledges. Record the
selected ID, visual reference, current revision, and original-byte digest in a
private operator record. Save the original visual bytes and restore them
through the same supported owner/operator API after each trial. Delete the
draft through the supported UI/API after the final evidence is accepted if a
reviewed delete path is available; otherwise leave it clearly marked as an
inert disposable staging fixture and track cleanup.

### Release

There is no canonical repository seeder for disposable Releases. Create a new
staging-only Release owned by the approved test identity, or use an existing
record only after positively proving that identity owns it and that no real
user, purchase, license, royalty, remix, playlist, or other durable dependency
uses it. Record its ID, current revision, original-byte digest, and rollback
bytes privately. Never substitute a real artist release because it is
convenient.

If a safely owned Release cannot be created or proven, stop the Release half of
the trial and track that narrower fixture limitation instead of weakening the
guard.

## Execution phases

### 1. Prepare offline

- Confirm the current `main` source includes PR #1662 and the release workflow
  fixes required by #1666.
- Prepare a sanitized evidence record covering source SHA, release run, image
  digests, deploy manifest, IaC handoff/run, live revisions, target, viewport,
  settle time, attempts, cache counts, heavy images, and rollback state.
- Prepare replacement images with visibly different bytes and dimensions that
  remain inside the repository's upload and decoded-pixel limits. Keep original
  fixture bytes and their digests outside the repository.
- Dry-run the repository Shows fixture validator locally as a configuration
  check only. It does not create the disposable draft and must not connect to
  staging during this phase.
- Review the exact mutation requests and authentication path with the approved
  staging test identity; never place bearer tokens, cookies, storage URIs, or
  private digests in shell history, logs, issue comments, or committed files.

### 2. Deploy the TTL=0 baseline after CI renewal

- Use the protected release workflow to publish a current `main` source and
  deploy it to staging with
  `IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL=0`.
- Retain the exact source SHA, release run, per-service immutable image digests,
  deploy manifest, IaC run/revision, and observed live service revisions.
- Fail closed if any live revision or digest cannot be reconciled to the
  approved release evidence.

### 3. Prove replacement coherence at TTL=0

- Capture each fixture's public DTO, canonical `/vN` URL, legacy URL, optimizer
  request URL, response bytes, and cache status before replacement.
- Replace the Release cover and the selected Shows visual once through their
  supported authenticated APIs.
- Confirm the committed response and a fresh DTO advance to `/vN+1`; the
  `/_next/image` source parameter changes; the new bytes render immediately;
  and the legacy unversioned URL remains readable and resolves current bytes.
- Restore the original bytes after the check unless the replacement was
  explicitly created as the fixture's new permanent artwork. Confirm the
  restore advances the revision again and renders the restored digest.

### 4. Measure the TTL=0 baseline

On one machine, against the same staging target, run five accepted cold/warm
Home pairs:

```bash
cd web
PERF_BASE_URL=<staging-origin> PERF_RUNS=5 PERF_MAX_RETRIES=3 \
  PERF_IMAGE_BUDGET_BYTES=102400 npm run perf:home
```

Retain the raw JSON and record the viewport, settle time, discarded attempts,
exact cold/warm HIT/MISS/STALE/REVALIDATED/unknown counts, and
`breakdown.images.heavy`. A discarded pair does not count toward the five.

### 5. Trial a bounded nonzero staging TTL

- Open a separately reviewable `resonate-iac` change for the staging frontend
  configuration. Start with the smallest operationally meaningful candidate
  supported by the deployment contract; do not infer a value from the allowed
  `86400` maximum.
- Reuse unchanged backend and Demucs image digests. If the frontend value is
  baked into the Next build, rebuild only the frontend image through the normal
  release gate; do not claim that a runtime-only redeploy changed a build-time
  setting.
- Deploy only to staging, reconcile the applied IaC revision and live frontend
  digest, then repeat the Release and Shows replacement checks and the same
  five-pair performance run.
- Compare accepted raw evidence rather than a single median. Select the
  smallest candidate that improves warm optimizer reuse while preserving
  immediate replacement correctness and the 100 KiB image budget. If no
  candidate satisfies both, retain TTL `0` and record that result.

### 6. Document and close the loop

- Update `docs/deployment/environment.md` with the measured staging policy,
  limitations, stale-content observations, and rollback to `0`.
- Update `docs/engineering/home-performance-harness.md` with the two comparable
  evidence sets and cache interpretation.
- Update the relevant catalog and Shows feature pages only if the operational
  evidence changes their current status or documented behavior.
- Link the exact `resonate-iac` issue, PR, applied revision, release/deploy
  evidence, and sanitized raw performance records from #1666.
- Restore both disposable fixtures and verify their final bytes. If a nonzero
  TTL is not accepted, restore staging configuration to `0` before ending the
  maintenance window.

## Stop conditions

Stop without improvising if CI remains budget-blocked; the target is not the
approved staging environment; source, image, deploy, and live revisions do not
reconcile; a fixture has real authority/escrow/pledge or user dependencies; the
rollback bytes are unavailable; replacement fails to advance the canonical
revision; the legacy URL fails; or secrets/private fixture evidence would need
to be published to continue.

## Validation and completion evidence

Offline preparation uses the existing focused fixture, configuration, and
performance-harness tests. The live pass is complete only when #1666 contains
both five-pair raw records, both fixture replacement proofs at TTL `0` and at
the selected candidate, the exact release/IaC/runtime chain, the final fixture
restore checks, and either the measured selected TTL or an explicit evidence-
backed decision to keep `0`.
