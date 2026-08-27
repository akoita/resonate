# Staging artwork-cache validation

This runbook completes the operational evidence owned by
[#1666](https://github.com/akoita/resonate/issues/1666). It proves that Release
and Shows artwork revisions change Next image-optimizer keys before a nonzero
cache TTL is accepted for staging.

The owner approved a staging maintenance window and disposable fixtures on
2026-08-27. Execution remains gated on the monthly `resonate-iac` GitHub
Actions allowance renewal. Do not probe that gate by dispatching workflows, and
do not use this runbook against production.

## Safety boundary

- Target only the reviewed staging web, API, database, storage, and IaC state.
- Use one new Release and one new draft Shows campaign owned by the approved
  staging test identity. Do not mutate existing artist or sample content.
- Keep the Shows campaign in `draft` with authority `none`. Do not request
  authority, attach escrow state, activate it, or create a pledge.
- Keep fixture IDs, storage references, original bytes, original-byte digests,
  access tokens, cookies, and database evidence in the private operator record.
  The sanitized evidence contains only aliases and privately salted
  fingerprints of artwork digests.
- Stop if source, image, deploy, IaC, or live revision evidence does not
  reconcile. Rollback is staging TTL `0` plus restored fixture bytes.

Repository sample Shows campaigns cannot be used for the replacement step.
They are seeded as active, and the supported visual replacement endpoint
correctly accepts only draft campaigns. Never bypass that lifecycle check with
a direct database status edit.

## Offline preparation

These checks do not contact staging or consume CI credits.

1. Confirm the local branch and source contain the revisioned artwork work:

   ```bash
   git merge-base --is-ancestor 645a7afa main
   git log -1 --format='%H' main
   ```

2. Validate the repository-owned Shows fixture manifest as a local
   configuration check. This does not create the disposable draft:

   ```bash
   cd backend
   NODE_ENV=development npm run fixtures:shows -- --dry-run
   ```

3. Select two visibly distinct repository-owned WebP assets below the upload
   and decoded-pixel bounds. Copy them into a private temporary directory at
   execution time; do not modify the source assets or commit derived fixture
   evidence.

4. Copy the sanitized evidence template from
   `scripts/staging-artwork-cache/evidence.template.json`. Keep the working
   record outside the repository until it has been scrubbed and validated.

## Create and approve the fixtures

Use the signed-in staging UI and approved test identity to create:

- a Release explicitly named as a disposable #1666 staging fixture; and
- a Shows campaign explicitly named as a disposable #1666 staging fixture,
  left in draft with one hero or card visual.

Before mutation, an operator must privately verify the following fail-closed
matrix. A missing answer is not approval.

| Check | Release | Shows |
| --- | --- | --- |
| Owned by approved staging test identity | required | required |
| Explicit disposable-fixture marker | required | required |
| Real purchases, licences, royalties, playlists, or remixes | none | n/a |
| Authority or authority request | n/a | none |
| Escrow address or contract campaign | n/a | none |
| Real pledge, receipt, dispute, booking, or payout state | n/a | none |
| Status compatible with supported replacement API | owner-managed | `draft` |
| Original bytes and SHA-256 retained privately | required | required |

Use the managed Shows read, not the public DTO alone, to confirm draft and
authority state. Any read-only database check must use the reviewed staging
connection and remain in the private record. Never paste query results that
contain internal identifiers or storage URIs into GitHub.

## Private shell workspace

Run mutation and byte checks from a temporary directory. Enter the bearer token
without placing its value in shell history:

```bash
ARTWORK_CACHE_WORK_DIR="$(mktemp -d)"
read -rs STAGING_BEARER_TOKEN
export STAGING_BEARER_TOKEN
```

Set the reviewed origins and private fixture identifiers in that shell. The API
base includes the deployed API prefix, for example `/platform/v1` when that is
the reviewed staging configuration:

```bash
export STAGING_WEB_ORIGIN=<reviewed-staging-web-origin>
export STAGING_API_BASE=<reviewed-staging-api-base>
export RELEASE_ID=<private-release-id>
export SHOW_CAMPAIGN_ID=<private-draft-campaign-id>
export SHOW_VISUAL_REF=<private-visual-id-or-role>
```

Do not enable shell tracing. Before leaving the window, unset the token and
retain or securely remove the private workspace according to the operator's
evidence policy.

## Capture the baseline

Save the managed DTOs and current bytes privately. Replace `N` with the current
server-owned revision read from each DTO:

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${STAGING_BEARER_TOKEN}" \
  "${STAGING_API_BASE}/shows/campaigns/${SHOW_CAMPAIGN_ID}/manage" \
  --output "${ARTWORK_CACHE_WORK_DIR}/shows-before.json"

curl --fail-with-body --silent --show-error \
  "${STAGING_API_BASE}/catalog/releases/${RELEASE_ID}/artwork/vN" \
  --output "${ARTWORK_CACHE_WORK_DIR}/release-before.webp"

curl --fail-with-body --silent --show-error \
  "${STAGING_API_BASE}/shows/campaigns/${SHOW_CAMPAIGN_ID}/visuals/${SHOW_VISUAL_REF}/vN" \
  --output "${ARTWORK_CACHE_WORK_DIR}/shows-before.webp"

sha256sum "${ARTWORK_CACHE_WORK_DIR}/release-before.webp" \
  "${ARTWORK_CACHE_WORK_DIR}/shows-before.webp"
```

In browser developer tools, record the two canonical `/_next/image` requests,
including their decoded `url` source parameter and `x-nextjs-cache` response
header. The private record may keep exact URLs; the sanitized record replaces
the private fixture ID with the template's fixed alias in the canonical key.

## Replace and verify

The Release multipart field is `artwork`; the Shows field is `visual`. Use the
approved replacement files from the private workspace:

```bash
curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer ${STAGING_BEARER_TOKEN}" \
  --form "artwork=@${ARTWORK_CACHE_WORK_DIR}/release-replacement.webp;type=image/webp" \
  "${STAGING_API_BASE}/catalog/releases/${RELEASE_ID}/artwork" \
  --output "${ARTWORK_CACHE_WORK_DIR}/release-replaced.json"

curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer ${STAGING_BEARER_TOKEN}" \
  --form "visual=@${ARTWORK_CACHE_WORK_DIR}/shows-replacement.webp;type=image/webp" \
  "${STAGING_API_BASE}/shows/campaigns/${SHOW_CAMPAIGN_ID}/visuals/${SHOW_VISUAL_REF}" \
  --output "${ARTWORK_CACHE_WORK_DIR}/shows-replaced.json"
```

For each fixture, require all of the following before continuing:

- the mutation response and a fresh DTO report revision `N+1`;
- the canonical path changes from `/vN` to `/vN+1`;
- the decoded `/_next/image` source and its alias-substituted canonical key
  change;
- the `N+1` canonical URL returns the replacement digest immediately;
- the legacy unversioned URL remains readable and returns current bytes; and
- the stale or future-version behavior matches the documented backend
  contract rather than being inferred from browser display alone.

Restore the original files through the same two PATCH endpoints. Restoration
must increment the revision again and return the original private digest. Do
not treat overwriting storage or editing the database as a restore.

## Measure TTL `0`

After the exact release and live staging revisions are reconciled, run the Home
harness on the same machine that will run the candidate trial:

```bash
cd web
PERF_BASE_URL="${STAGING_WEB_ORIGIN}" PERF_RUNS=5 PERF_MAX_RETRIES=3 \
  PERF_IMAGE_BUDGET_BYTES=102400 npm run perf:home
```

Copy `web/build/perf/home-latest.json` into the private evidence workspace. The
accepted record must include five complete cold/warm pairs, viewport, settle
time, discarded attempts, exact cache-status counts, and
`breakdown.images.heavy`. Do not count a discarded pair.

## Trial a nonzero value

The TTL is frontend build-time configuration. Change it only in the
authoritative staging `resonate-iac` configuration and use the normal protected
release/deploy path. Reuse unchanged backend and Demucs digests; rebuild the
frontend image because a runtime-only redeploy cannot change the baked Next
configuration.

Start with the smallest operationally meaningful candidate accepted in the IaC
review. After reconciling its PR, applied revision, frontend image digest, and
live revision, repeat the full replacement/restore proof and the same five-pair
Home command on the same machine. Do not increase the candidate merely to make
a noisy result look better.

Accept a nonzero value only when it improves warm optimizer reuse, preserves
immediate replacement correctness and legacy readability, and keeps the heavy
image budget. Otherwise restore staging TTL `0`.

## Sanitize and validate the record

Populate the evidence template with aliases and hashes, never secrets or
private fixture data. For each artwork proof, derive the `fingerprint` as an
HMAC-SHA-256 of the private byte digest with a fresh private salt retained only
in the operator record. This preserves the equality checks for replacement and
restore without publishing the original digest. Image-container digests and
deploy-manifest hashes remain their exact public release values. Then run:

```bash
node scripts/staging-artwork-cache/validate-evidence.mjs \
  <sanitized-evidence.json>
```

The validator is a completeness and privacy guard, not proof that the recorded
external facts are true. Review the private release, IaC, runtime, and fixture
records against the sanitized hashes before posting the result to #1666.

## Close the maintenance window

- Verify both fixtures render their restored original-byte digests at their
  final revisions.
- Unset `STAGING_BEARER_TOKEN` and close authenticated browser sessions used for
  the trial.
- Leave the Shows fixture inert in draft and the Release clearly marked as a
  disposable staging fixture until a separately reviewed cleanup path is used.
- Confirm staging TTL is the selected reviewed value, or `0` if the trial did
  not pass.
- Link the sanitized evidence, exact release/deploy chain, IaC issue/PR/applied
  revision, and rollback result from #1666. Do not claim production readiness.
