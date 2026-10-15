---
title: "Rights Verification Workflow"
status: partial
owner: "@akoita"
---

# Rights Verification Workflow

## Status

`partial` - upload routing, trusted-source requests, review decisions, route
reassessments, and admin review surfaces are implemented. Follow-up work remains
for richer artist-side trusted-source request management and larger policy
analytics.

## Who It Is For

- Artists who need to prove release or catalog control.
- Operators reviewing proof-of-control and trusted-source links.
- Backend and protocol agents deciding whether a release can use marketplace,
  payout, and publication paths.

## Value

Rights verification separates public trust signals from private compliance
review. Resonate can let low-risk uploads publish with appropriate controls,
hold risky uploads for review, and promote artists into lower-friction routes
only when proof and operator decisions support that route.

## Terminology And Guarantees

See the [Verification Language Inventory](verification_language.md) for the
complete surface-by-surface map. Account trust (including `Independent Account
Trust`), `Human Verified`, self-attested provenance, and economic trust describe
different account, personhood, provenance, or stake signals. None of them
clears rights for a release. Rights review is release-scoped: `Rights Verified`
is reserved for reviewer-approved evidence that supports likely recording
ownership or publishing authority; `Approved With Limits`, `Under Review`,
`Denied`, and `Disputed` remain distinct outcomes.

## Verification Classes

Upload-rights decisions now expose four product-facing uploader classes:

| Class | Meaning | Default route behavior |
| --- | --- | --- |
| `unverified_uploader` | No platform trust or approved source link yet. | `LIMITED_MONITORING`, with marketplace and payout restrictions. |
| `verified_independent` | Independent account trust supports standard escrow, but release rights remain release-scoped. | `STANDARD_ESCROW` when no conflicts exist. |
| `trusted_creator` | Artist has stronger platform trust. | `STANDARD_ESCROW` unless a trusted-source link or review upgrades the release. |
| `trusted_source_account` | Artist is linked to an active approved distributor, label, official artist team, or catalog operator. | `TRUSTED_FAST_PATH` when no conflicts exist. |

Metadata conflicts, quarantined audio, and DMCA takedowns override these classes
and push releases into `QUARANTINED_REVIEW` or `BLOCKED`.

## How To Use

Artists can submit release-specific marketplace-rights upgrade requests from
the release page. If they already have an active trusted-source link, the
frontend pre-fills evidence from that link so the request is reviewable without
asking the artist to re-enter the same catalog context.

Trusted-source link requests are created with:

- source type: distributor, label, official artist team, or catalog operator;
- source name and source key;
- requested trust level;
- proof-of-control summary;
- optional structured rights evidence.

Operators review pending release-rights requests and trusted-source link
requests in the admin dispute queue. Trusted-source approval creates or updates
the trusted source, links it to the artist, and lets future direct uploads use
the trusted-source account classification. Revocation removes the active routing
context and creates route reassessments for affected releases.

## API And UI Surfaces

- UI: `/admin` dispute queue trusted-source and release-rights sections.
- UI: release detail marketplace-rights upgrade modal.
- API: `POST /metadata/trusted-sources/link-requests`
- API: `GET /metadata/trusted-sources/link-requests/me`
- API: `GET /metadata/trusted-sources/links/me`
- API: `GET /metadata/trusted-sources/link-requests/pending`
- API: `PATCH /metadata/trusted-sources/link-requests/:id/review`
- API: `PATCH /metadata/trusted-sources/links/:id/revoke`
- API: `POST /metadata/release-rights/releases/:releaseId/request`
- API: `PATCH /metadata/release-rights/requests/:id/review`
- Backend policy: `backend/src/modules/rights/upload-rights-policy.ts`
- Backend trusted-source workflow:
  `backend/src/modules/rights/trusted-source.service.ts`

### DMCA Notice API

`backend/src/modules/dmca/dmca.controller.ts`. No web client calls these
routes yet.

| Route | Access | Notes |
| --- | --- | --- |
| `POST /api/dmca/report` | Public, rate limited per IP (10 per hour) | Claimants may not have an account. Returns only the new report's `id`, `trackId`, `status` and `createdAt`. |
| `POST /api/dmca/counter` | Signed-in caller who owns the reported track's release (release management owner, else the artist account) or holds an active catalog-metadata grant on it; admins and operators also allowed | `404` for an unknown report, `400` once the report is `countered` or `rejected`, `403` otherwise unauthorized. The response omits claimant contact details. |
| `PATCH /api/dmca/:id/resolve` | `admin` or `operator` role | `upheld` marks the track `dmca_removed` and delists its stems. The resolver is the authenticated caller, recorded in the audit log; any resolver field in the body is ignored. |
| `GET /api/dmca` | `admin` or `operator` role | Lists reports with claimant contact details; no other route returns them. |

## Tests

- `cd backend && npm run test -- upload-rights-policy.spec.ts`
- `cd backend && npm run test:integration -- --testPathPattern='trusted-source.service.integration|upload-rights-routing.integration|rights-route-reassessment.integration'`
- `cd backend && npm run test -- dmca.controller.http.spec.ts`
- `cd backend && npm run test:integration -- --testPathPattern='dmca.service.integration'`
- `cd web && npx vitest run src/lib/api.test.ts src/lib/__tests__/rightsOnboarding.test.ts`

## References

- Issue: [#472](https://github.com/akoita/resonate/issues/472)
- Architecture: [Upload Rights Routing Policy](../architecture/upload_rights_routing_policy.md)
- RFC: [Rights Verification Strategy](../rfc/rights-verification-strategy.md)
- Evidence schema: [Rights Evidence Schema](../architecture/rights_evidence_schema.md)
