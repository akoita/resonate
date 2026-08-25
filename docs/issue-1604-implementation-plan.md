# Issue #1604 implementation plan: version mutable artwork URLs

## Outcome

Release artwork and Shows campaign visuals will carry a server-owned revision
in every canonical URL sent through Next's image optimizer. Replacing an image
will increment that revision and therefore produce a new optimizer cache key
immediately. Existing unversioned URLs will remain readable during rollout.

This is vision-neutral infrastructure and quality work under ADR-BM-6. It does
not change fees, payouts, licensing, or product policy.

## Current behavior and constraints

- Release bytes and MIME type are mutable, but `Release` has no persisted
  artwork revision. The replacement API returns a one-off timestamped query
  string, while the release page creates a second client timestamp and Home
  continues using the stable release URL.
- Shows hero, card, and gallery records retain the same public URL when their
  storage object is replaced. `ShowCampaignVisual.updatedAt` changes, but that
  state is not part of the public URL contract.
- Next accepts only exact release-artwork and campaign-visual paths with an
  empty query. Relaxing the query restriction would weaken the current
  allowlist, and query-bearing campaign images currently fall back to a raw
  browser image.
- `IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL` intentionally defaults to `0`. The
  existing `0..86400` bound and localhost-only optimizer exception must remain.

## Proposed contract

Use a positive, monotonically increasing `artworkRevision` for each mutable
release or campaign visual. Initial and migrated artwork uses revision `1`;
every successful replacement atomically increments it. Re-uploading identical
bytes may still increment the revision: the contract is tied to a successful
mutation, not client clocks or content-hash availability.

Canonical public optimizer URLs become:

```text
/catalog/releases/:releaseId/artwork/v:artworkRevision
/shows/campaigns/:campaignId/visuals/:visualRef/v:artworkRevision
```

The version segment affects cache identity but not authorization or record
selection. The backend will continue serving the existing unversioned routes,
and versioned routes will resolve the current authorized image. New clients
will stop referencing an old revision as soon as they receive the successful
replacement response or refresh the affected DTO. This preserves rollback and
old-link readability without requiring historical image retention.

## Implementation slices

### 1. Persist the revision at every mutation seam

- Add `artworkRevision Int @default(1)` to `Release` and
  `ShowCampaignVisual`, with a Prisma migration that safely initializes
  existing rows.
- Carry the initial release revision through normal ingestion and AI-generation
  publication without introducing a separate client-generated value.
- Atomically increment the release revision in the owner artwork replacement
  path and the campaign visual revision in hero, card, and gallery replacement
  paths. Reordering or metadata-only edits must not increment it.
- Return the committed revision from mutation responses. Do not advertise a
  new URL before the database points to the new bytes/storage object.

### 2. Expose one canonical versioned URL contract

- Add versioned public and owner release-artwork GET routes while retaining the
  current routes. Preserve the existing rights visibility, ownership checks,
  MIME handling, and browser-direct owner Blob fallback.
- Add the equivalent versioned Shows visual route while retaining the current
  route and its authorization/public-read behavior.
- Include `artworkRevision` in release projections that expose
  `artworkMimeType`, including Home feed/popularity/catalog and relevant
  public-agent projections. Include the visual revision in public and managed
  Shows DTOs without exposing storage URIs.
- Keep external/legacy artwork URL fields outside this contract; only the two
  mutable backend paths admitted by Next's optimizer are in scope.

### 3. Centralize frontend URL construction

- Extend `getReleaseArtworkUrl` to accept a server revision and emit the
  versioned path. Remove the release page's `Date.now()`/`?rev=` workaround and
  update local state from the replacement response.
- Give `HomeReleaseArtwork` an explicit revision and propagate it through all
  Home DTOs and call sites. Optimized and `unoptimized` MIME cases must use the
  same canonical versioned source; arbitrary caller-supplied sources remain
  disallowed.
- Version Shows hero/card/gallery URLs in the shared mapper from the revision
  returned by the backend. Update `HomeCampaignVisual` to recognize only the
  new canonical versioned path plus the retained legacy path during rollout.
- Update Next `remotePatterns` with narrowly scoped versioned path patterns.
  Keep exact origin, port, route family, empty-query, redirect, and local-IP
  restrictions intact.

### 4. Test replacement and compatibility behavior

- Backend integration tests: migrated/default revision, initial upload,
  release replacement, AI-generation artwork overwrite, Shows replacement,
  no increment for reorder, versioned and legacy reads, and unchanged
  authorization/public visibility.
- Frontend unit tests: canonical URL formatting, DTO propagation, mutation
  response adoption, Home release optimized/direct rendering, Shows canonical
  detection, and rejection/fallback for external, credentialed, query-bearing,
  or malformed sources.
- Configuration tests: both legacy and versioned paths are accepted only for
  the configured API origin; unrelated paths and query strings remain denied;
  TTL bounds remain enforced.
- Run focused backend catalog/ingestion/generation/Shows tests and focused web
  API, Home artwork, Shows image, config, and performance-harness tests. Do not
  run an unrelated full monorepo build for this dependency-independent slice.

### 5. Stage, measure, and select the TTL

- Deploy the versioned contract with the TTL still at `0`, replace one release
  cover and one campaign visual, and record that each produces a different
  `/_next/image` source/cache key while the legacy URL remains readable.
- On the same staging target and machine, run five accepted cold/warm Home
  pairs with `PERF_IMAGE_BUDGET_BYTES=102400`. Record the commit, viewport,
  settle time, raw JSON artifact, discarded attempts, exact HIT/MISS counts,
  and `breakdown.images.heavy`.
- Trial a bounded nonzero TTL through the existing deployment variable, then
  choose and document the smallest value supported by the measured warm-cache
  evidence. The code default remains `0` as the immediate rollback switch;
  any deployment-repository configuration change is linked to #1604 and
  reviewed before the issue closes.

## Documentation and rollout

- Update `docs/deployment/environment.md` with the selected TTL, versioned-path
  contract, rollback to `0`, and the fact that old URLs resolve current content
  rather than preserving historical bytes.
- Update `docs/engineering/home-performance-harness.md` with the staging
  evidence and cache interpretation.
- Update `docs/features/resonate_shows.md` and its `docs/features/README.md`
  summary for cache-coherent visual replacement. Record the release-artwork
  delivery contract in the most relevant catalog documentation rather than
  duplicating implementation details broadly.
- No User Guide or screenshot update is expected because image appearance and
  user actions do not change. Reassess if implementation introduces a visible
  stale/loading/error state.

## Risks and safeguards

- **Missing propagation:** a DTO that exposes MIME without revision could keep
  generating a stable URL. Audit every `artworkMimeType` projection and fail
  focused tests when revision is absent from a canonical mutable image.
- **Revision races:** increment in the same database update that commits the
  new image pointer/bytes; never derive revisions from browser time.
- **Allowlist regression:** use path segments, not query strings, and retain
  exact remote-pattern tests.
- **Stale client state:** mutation responses carry the committed revision so
  replacement screens switch keys immediately without a full reload.
- **Rollback:** setting the optimizer TTL to `0` stops extended reuse; legacy
  endpoints and paths remain available, so frontend rollback does not require
  a data rollback.
- **Cross-repository deployment state:** do not claim completion until any
  required `resonate-iac` variable change and staging evidence are linked from
  the issue/PR. Repository implementation can ship safely with TTL `0` while
  that operational step is pending.

## Completion evidence

The PR will report focused commands and results, migration behavior, an API
contract example before/after replacement, strict allowlist coverage, relevant
change-impact checklist decisions, and the staging harness evidence. If the
staging/IaC step cannot be completed in the same delivery window, #1604 stays
open with that external step explicitly assigned; the implementation PR must
not claim that a nonzero TTL is production-ready.

## Operational completion checkpoint — 2026-08-26

The revisioned URL implementation merged in PR #1662 at `645a7afa`, with CI
green. It has not yet been proven on staging: the corresponding
`resonate-iac` receiver run did not start its deployment steps because GitHub
Actions spending capacity was unavailable. Do not treat the current public
staging deployment as evidence for the revisioned contract.

After owner approval, complete the remaining work in this order:

1. Restore GitHub Actions runner capacity and confirm an authorized operator can
   inspect `resonate-staging-503400`. This is a prerequisite, not a code change.
2. Use the release-gated workflow to publish and deploy a current `main` source
   that contains `645a7afa` to `staging`, using its successful exact-SHA CI
   run. Keep `IMAGE_OPTIMIZER_MINIMUM_CACHE_TTL=0` for this first deployment
   and retain the release/deploy manifest evidence.
3. Select an explicitly disposable staging release and Shows campaign visual.
   Record their IDs and original image digests privately before mutation; do not
   replace real user content or proceed without a safe fixture and rollback
   image.
4. Replace each fixture image once and prove that the returned canonical URL
   advances from `/vN` to `/vN+1`, the corresponding `/_next/image` source key
   changes, the new bytes render, and the legacy unversioned URL remains
   readable. Restore the fixture content if the test image is not intended to
   remain.
5. Run five accepted cold/warm Home pairs at TTL `0` with
   `PERF_IMAGE_BUDGET_BYTES=102400`. Retain raw JSON and record commit, target,
   viewport, settle time, discarded attempts, cache HIT/MISS counts, and heavy
   images.
6. Trial one bounded nonzero TTL through the authoritative `resonate-iac`
   staging configuration, redeploy without rebuilding application images, and
   repeat the same five-pair harness plus one replacement check. Select the
   smallest TTL whose warm-cache evidence improves without weakening immediate
   replacement correctness.
7. Record the selected value, evidence, stale-content behavior, and rollback to
   `0` in deployment and performance documentation. Link the exact
   `resonate-iac` issue/PR that owns the staging variable; keep repository and
   deployment changes independently reviewable.

The first approved release attempt used source
`18dfd8025a8b97b0755e54c9be3ef44e24e88d90` and CI run `32903072598`. Release
run `32903515660` passed its exact-source validation but failed while publishing
both selected images: the reusable image jobs received neither a workload
identity provider nor service-account credential from the `staging`
environment. The failure happened before the deploy manifest and IaC handoff,
so staging was not changed. Retry only after the image jobs bind directly to
the validated reusable-workflow environment input and a regression check covers
that binding.

No additional local full-monorepo build is required for this operational pass.
The release workflow remains the consolidated deployment gate and may perform
its own required exact-source validation. Use that evidence, focused replacement
checks, the Home performance harness, and configuration/documentation
validation. No production deployment or production TTL change is authorized by
this plan.
