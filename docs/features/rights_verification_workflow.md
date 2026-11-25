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

When an admin upholds a DMCA report (`PATCH /api/dmca/:id/resolve` with
`upheld`), the track becomes `dmca_removed` and its stems are delisted. The
creator also gets one in-app `moderation` notice: the release's management
owner, else the artist's account; if neither resolves, the notice is logged and
skipped. The notice names the track and release, gives the reason category
(copyright complaint, impersonation, illegal content, or another concern) and
the reviewer's statement of reasons. It never includes the complainant's name,
email or written reason. It is keyed on the report (`dmca_report:<id>`), so
resolving the report again sends nothing new. See
[Platform notices](platform_notices.md) and
[#2146](https://github.com/akoita/resonate/issues/2146).

### Report form and counter-notices (#2664)

The public report form at `/report` is the notice channel named in the Terms.
It needs no account and no stake, and it is linked from the global footer, the
legal pages, release pages ("Report this release") and stem pages ("Report
this stem"). There is no separate track page; the form loads the release and
asks for the track. The form collects the reporter's name and capacity
(rights holder, authorised agent, the artist being impersonated, or someone
else), a contact email, the work concerned, where the content is, the reason
category (`copyright`, `impersonation`, `illegal_content`, `other`), a written
explanation and a good-faith statement. A hidden honeypot field drops automated
submissions without storing them. A signed-in reporter's confirmed notice
address is prefilled.

On filing, the reporter sees the reference. When platform email is configured,
the reporter also gets a receipt email with the reference and nothing else from
the notice. An address gets at most three receipts in 24 hours, so the form
cannot flood a stranger's inbox. The creator gets a `moderation` notice that a
report was received (`dmca_report_received:<id>`), with a link to
`/report/respond`, where they see every notice on their releases (category,
status, decision, reasons, never the reporter's details) and can send one
counter-notice per open notice. A rejected report sends a "no action" notice
with the reasons (`dmca_report_rejected:<id>`).

Operators review notices at `/admin/takedowns`: every field the reporter gave,
any counter-notice, and a decision with a required statement of reasons.
Upholding asks for a fresh passkey confirmation; opening the queue
(`dmca.reports_viewed`) and each decision (`dmca.report_resolved`) are in the
admin audit log, which records the outcome and never the reasons' text.

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
the trusted-source account classification. An upload request cannot name its own
source type: trusted routing comes only from that server-side link. Revocation
removes the active routing context and creates route reassessments for affected
releases.

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

`backend/src/modules/dmca/dmca.controller.ts`. Bodies are class DTOs in
`dmca.dto.ts`. The web report form, the creator's notices page and the
operator queue call these routes.

| Route | Access | Notes |
| --- | --- | --- |
| `POST /api/dmca/report` | Public, rate limited per IP (10 per hour) | Claimants may not have an account. Requires `goodFaith: true`. A filled `website` honeypot returns a look-alike answer and stores nothing. Returns only the new report's `id`, `trackId`, `status`, `createdAt` and `receiptSent`. |
| `GET /api/dmca/mine` | Signed-in caller | Notices on releases the caller owns (management owner, else the artist account): category, status, statement of reasons, counter-notice, `canCounter`. Never the reporter's identity, contact or explanation. |
| `POST /api/dmca/counter` | Signed-in caller who owns the reported track's release (release management owner, else the artist account) or holds an active catalog-metadata grant on it; admins and operators also allowed | `404` for an unknown report, `400` once the report is `countered` or `rejected`, `403` otherwise unauthorized. The response omits claimant contact details. |
| `PATCH /api/dmca/:id/resolve` | `admin` or `operator` role, fresh step-up proof | `outcome` is `upheld` or `rejected`; optional `statementOfReasons` (up to 2000 characters) is stored and shown to the creator. `upheld` marks the track `dmca_removed` and delists its stems. The resolver is the authenticated caller, recorded in the audit log; any resolver field in the body is ignored. |
| `GET /api/dmca` | `admin` or `operator` role | Lists reports with every field, including claimant contact details; no other route returns them. |

## Tests

- `cd backend && npm run test -- upload-rights-policy.spec.ts`
- `cd backend && npm run test:integration -- --testPathPattern='trusted-source.service.integration|upload-rights-routing.integration|rights-route-reassessment.integration'`
- `cd backend && npm run test -- dmca.controller.http.spec.ts`
- `cd backend && npm run test:integration -- --testPathPattern='dmca.service.integration|dmca_takedown_notice|dmca_report_form'`
- `cd web && npx vitest run src/lib/takedownForm.test.ts`
- `cd web && npx vitest run src/lib/api.test.ts src/lib/__tests__/rightsOnboarding.test.ts`

## Deposit mode and upload limits (#2659)

Publishing can run with no Content Protection deposit (`PUBLISH_DEPOSIT_MODE=none`); the release is still attested. Accounts that are not yet verified have daily and total upload limits, checked before any file is stored, which an admin can lift per account. Upload limits do not change a release's rights route. See [Publishing Without a Deposit, With Upload Limits](publish_deposit_and_upload_limits.md).

## References

- Issue: [#472](https://github.com/akoita/resonate/issues/472)
- Architecture: [Upload Rights Routing Policy](../architecture/upload_rights_routing_policy.md)
- RFC: [Rights Verification Strategy](../rfc/rights-verification-strategy.md)
- Evidence schema: [Rights Evidence Schema](../architecture/rights_evidence_schema.md)
