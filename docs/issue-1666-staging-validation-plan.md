# Issue #1666 plan: validate versioned artwork caching on staging

## Outcome

Evaluate on staging whether a bounded Next image-optimizer cache TTL improves
warm-cache behavior while server-owned artwork revisions keep Release and Shows
replacements immediately visible. Retain enough release, runtime, replacement,
and performance evidence to select or reject a nonzero staging TTL without
changing production.

This is vision-neutral infrastructure and quality work under ADR-BM-6. It does
not change fees, payouts, licensing, or product policy.

## Authorization and final gate

The owner approved a staging maintenance window and disposable fixtures on
2026-08-27. GitHub Actions capacity renewed on 2026-09-01, and the deferred
staging handoff for #1670 subsequently passed release verification, Terraform
apply, live digest reconciliation, fixture seeding, and staging validation. The
budget and staging-deployment prerequisites are therefore cleared.

The owner reapproved that checkpoint on 2026-09-01. The post-fix protected TTL
`0` release and five-pair Home baseline, the staging-only TTL `300` candidate
trial, and the rollback to TTL `0` are complete. The candidate was rejected on
its cache-reuse evidence; staging remains at TTL `0`.

No production deployment or production TTL change is authorized by this plan.

## Delivery status

- **Implemented in this branch:** the fail-closed staging runbook, sanitized
  evidence template and validator, private-fixture safeguards, focused tests,
  and documentation links needed for the maintenance window.
- **Completed in the approved #1666 operational window:** the post-fix
  current-`main` staging release at TTL `0`, exact release/IaC/live
  reconciliation, five accepted cold/warm Home pairs, and controlled Release
  and Shows replacement and exact-byte restoration using approved disposable
  fixtures. A staging-only TTL `300` candidate was also built, measured, and
  rolled back successfully.
- **Outcome:** retain staging TTL `0`. The post-fix baseline passed the
  transformed-output and 100 KiB image-budget checks, but the TTL `300`
  candidate produced no warm optimizer hits and did not improve measured warm
  reuse. The candidate was rejected and the issue outcome is complete; no
  production action was authorized.

## Runtime diagnosis and post-deployment gate

The CI-built standalone artifact contains Linux glibc Sharp 0.35.3 binaries,
while the previous `web/Dockerfile.runtime` used Alpine/musl. Sharp therefore
failed to load in that runtime and Next silently returned original image bytes
from the optimizer. The runtime now matches the bundle's glibc ABI, and CI
checks a real resize/WebP transform.

The private raw first baseline showed all 12 heavy responses were optimizer
requests: 11 Release artwork responses and 1 Shows visual response, requested
at 96px or 384px, and each returned its source bytes unchanged. That historical
record is retained below as pre-fix evidence; it failed the image-budget gate
and did not authorize a candidate trial.

The post-fix TTL `0` baseline passed the 100 KiB image-budget gate, so the
bounded staging-only candidate trial could proceed. The replacement-coherence
proof remained the correctness evidence for the decision; the candidate
mutation was intentionally not repeated after the candidate's cache-reuse gate
failed.

## Historical first TTL `0` baseline and fixture proof (2026-09-01)

This first record predates the runtime packaging correction. It is retained to
explain the original fail-closed stop and to preserve the fixture proof.

- Source: `a5f6e170abab595da379436d3658f517423bf25a`; exact successful
  [main CI run](https://github.com/akoita/resonate/actions/runs/33457316347).
- Successful fail-closed
  [release preview](https://github.com/akoita/resonate/actions/runs/33468391006)
  and [staging release](https://github.com/akoita/resonate/actions/runs/33468418757),
  release ID `release-33468418757-5`.
- Published image digests: backend
  `sha256:4267cc15a559d61f162707235c5c23688226e1650cfa9a334245399c7074a650`,
  frontend
  `sha256:0f23a8acc1f42a0747fff31bacdf6d751dce407fed6adf870ed81867480ce3a7`,
  reused Demucs
  `sha256:20eaee7462072d791bd54abce8fd389327ccca5c2a747af3e4d537d6798eb466`,
  and reused Stable Audio
  `sha256:4688c1fcf62e5073573bfdccced07bb57265da6ca69c1465f37836f4ed7d3941`.
- Successful [IaC handoff and apply](https://github.com/akoita/resonate-iac/actions/runs/33469676987)
  at IaC source `ac6f9a192c79094464858657f9246ec11c0aa1e1`. Live backend revision
  `resonate-staging-backend-00029-s6v` and frontend revision
  `resonate-staging-frontend-00039-sj9` reconciled to the published digests;
  both health probes returned HTTP 200.
- Home harness: five accepted pairs at 1440x900 with a 3,000 ms settle time and
  no discarded attempts. Cold optimizer requests were 125 `MISS`; warm
  optimizer requests were 125 `unknown` because those browser-cached responses
  did not expose an optimizer cache header. Median LCP was 1,176 ms cold and
  860 ms warm; median transfer was 3,730.6 KiB cold and 44.0 KiB warm.
- Image budget: 30 image responses transferred 2,879.1 KiB. Twelve distinct
  images exceeded 100 KiB, totalling 2,003.5 KiB, with a 555.5 KiB maximum.
  The 100 KiB acceptance condition therefore failed.
- Disposable-fixture proof: the Release completed a controlled revision cycle
  `v6 → v7 → v8`, while the Shows hero completed `v1 → v2 → v3`. In both
  cases the replacement produced a new canonical optimizer key, the new and
  legacy URLs returned the replacement immediately, the future revision
  returned 404, and restoration returned the exact original bytes. The Shows
  campaign remained `draft`, authority `none`, without a linked contract or
  raised funds.
- Historical decision: retain staging TTL `0`. The artwork-coherence
  prerequisite passed, but the Home heavy-image prerequisite failed, so no
  nonzero candidate was eligible for trial in this first run.

The raw harness JSON and private fixture record remain local/private. The
public issue record links the exact deployment chain and sanitized aggregate
results without fixture identifiers, private URLs/digests, or secrets.

## Post-fix TTL `0` baseline (2026-09-02)

- Source: [`79d491327848a2ad0d6979bc9d123385ea2a391d`](https://github.com/akoita/resonate/commit/79d491327848a2ad0d6979bc9d123385ea2a391d), with the successful
  [application release/deploy run](https://github.com/akoita/resonate/actions/runs/33659799658).
- The [IaC handoff/apply run](https://github.com/akoita/resonate-iac/actions/runs/33661237818)
  deployed the immutable image; no separate `resonate-iac` source change was
  required for this build-time frontend variable. The live frontend revision
  was `resonate-staging-frontend-00040-qw8`.
- Home harness: five accepted cold/warm pairs at 1440×900, a 3,000 ms settle
  time, and no discarded attempts. Cold/warm medians were LCP 700/732 ms, FCP
  580/524 ms, TTFB 90/29 ms, transfer 1,288.7/46.6 KiB, and 88/88 requests.
- Optimizer statuses were cold `MISS=149`; warm `MISS=26`, `unknown=118`,
  `HIT=0`. The `unknown` warm responses were browser-cache reads without an
  exposed optimizer cache header and were not inferred as hits.
- Image budget: 35 images transferred 427.5 KiB; the median image was 2.8 KiB,
  the maximum was 81.3 KiB, and no image exceeded 100 KiB. The post-fix
  baseline therefore passed the image-budget gate.

## TTL `300` candidate trial and rejection (2026-09-02)

- The staging-only protected GitHub Actions environment variable was set to
  `300` for the frontend build. The [application release/deploy run](https://github.com/akoita/resonate/actions/runs/33663869984)
  and [IaC handoff/apply run](https://github.com/akoita/resonate-iac/actions/runs/33665199010)
  reconciled to live frontend revision `resonate-staging-frontend-00041-fkj`.
  A public transformed WebP response reported `max-age=300`, confirming that
  the candidate value was active.
- The same machine, viewport, settle time, five accepted pairs, and zero
  discarded attempts were used. Cold/warm medians were LCP 1,480/772 ms, FCP
  688/592 ms, TTFB 109/31 ms, transfer 1,288.6/47.1 KiB, and 88/83 requests.
- Optimizer statuses were cold `MISS=149`, `HIT=0`; warm `MISS=116`, `HIT=0`.
  Warm optimizer reuse did not improve and the candidate exposed zero hits.
  The same 35-image budget remained within bounds, with a maximum image size of
  81.3 KiB and zero images over 100 KiB.
- Decision: reject TTL `300`. Because the cache-reuse gate had already failed,
  the Release and Shows replacement mutation was intentionally not repeated at
  the candidate. The existing TTL `0` fixture proof remains the correctness
  evidence; TTL `300` could not be selected.

## Rollback and final state (2026-09-02)

- The staging-only GitHub Actions environment variable was deleted, restoring
  the default TTL `0`. The [rollback application run](https://github.com/akoita/resonate/actions/runs/33665754506)
  and [rollback IaC handoff/apply run](https://github.com/akoita/resonate-iac/actions/runs/33666981040)
  reconciled the signed image to live frontend revision
  `resonate-staging-frontend-00042-wht`.
- API and frontend health checks returned HTTP 200, and a fresh transformed
  WebP response reported `max-age=0`. Staging is therefore back at the default
  TTL `0`; no production value was configured or changed.

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

- Set the staging-only non-secret `IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL` GitHub
  Actions environment variable in `akoita/resonate`. It is consumed while
  building the frontend; Terraform in `resonate-iac` deploys the resulting
  immutable image, so a separate IaC source issue, PR, or change is not
  required. Start with the smallest operationally meaningful candidate
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
- Link the release/deploy and `resonate-iac` handoff/apply runs, live revisions,
  rollback evidence, and sanitized aggregate performance records from #1666.
  Keep raw JSON and private fixture records local/private.
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
performance-harness tests. The live pass is complete when #1666 contains the
post-fix TTL `0` and candidate five-pair raw records, the exact
release/IaC/runtime chain, the final fixture restore checks, and either the
selected candidate's replacement proof or an explicit evidence-backed
rejection. For this completed run, the candidate mutation was stopped after
the cache-reuse gate failed, so the existing TTL `0` fixture proof is the
correctness evidence and staging was rolled back to `0`.
