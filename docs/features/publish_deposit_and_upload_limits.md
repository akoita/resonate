---
title: "Publishing Without a Deposit, With Upload Limits"
status: implemented
owner: "@akoita"
issue: 2659
depends_on: [stake-visibility-views, artist-upload-flow-mvp]
---

# Publishing Without a Deposit, With Upload Limits

## Goal

Let a deployment run publishing with no Content Protection deposit, and keep
the job the deposit did (slowing abuse by new accounts) with plain upload
limits instead. ADR-BM-6: vision-neutral infrastructure; it moves no money and
changes no fee or split.

## Who it is for

- **Artists** publish with a passkey attestation only; accounts that are not
  yet verified see what they may still upload.
- **Admins** lift the limits for one account (a known artist with a large
  catalog) or restore them, from the user's record in the admin area.

## How it works

### Deposit mode

`PUBLISH_DEPOSIT_MODE=none` (backend) makes every trust tier's stake
requirement read zero (`GET /api/trust/:artistId` returns `stakeAmountWei: "0"`
and `depositWaived: true`). The upload page then attests the release on-chain
without a stake, exactly as it already did for tiers whose deposit is waived.
Any other value, or none, keeps the deposit (`required`).

- The tier's nominal deposit still sets the listing price cap the app applies
  when minting and listing (`maxListingPriceWei`). The marketplace contract
  caps prices only for releases with an active stake, so without a deposit the
  cap is applied by the app, not the chain.
- Stakes already deposited are untouched and stay claimable from My Stakes.
- The Content Protection card on the upload page says "No deposit" and
  explains that the release is still attested.

### Upload limits

Accounts that are not verified (any trust tier but `verified`) and whose limits
an admin has not lifted may upload, per artist profile:

| Limit | Variable | Default |
| --- | --- | --- |
| Releases in the last 24 hours | `UPLOAD_LIMIT_RELEASES_PER_DAY` | 5 |
| Tracks in the last 24 hours | `UPLOAD_LIMIT_TRACKS_PER_DAY` | 50 |
| Releases in total | `UPLOAD_LIMIT_RELEASES_TOTAL` | 50 |
| Tracks in total | `UPLOAD_LIMIT_TRACKS_TOTAL` | 500 |

`unlimited`, `off` or `0` turns one limit off; an unreadable value keeps the
default. The limits apply whatever the deposit mode.

- `IngestionService.handleFileUpload` checks the limits for the whole upload
  before any file is stored and refuses with `403 { code:
  "upload_limit_reached", limit, max, used }` and a plain message.
- `GET /api/trust/me/upload-limits` returns the caller's limits, what was used
  and what is left; the upload page shows it and holds Publish when the upload
  would go over a limit.
- `POST /api/trust/:artistId/upload-limits { lifted }` (admin) lifts or
  restores the limits. `CreatorTrust.uploadLimitsLiftedAt` / `uploadLimitsLiftedBy`
  record it, and the admin audit log records `trust.upload_limits_changed`.
  The admin user record shows an Upload limits section for people with an
  artist profile.

## Tests

- `backend/src/tests/upload_limits.integration.spec.ts`: limit boundaries
  (one past each limit is refused, the 24-hour window, a limit turned off),
  lifting and restoring, verified artists, and the stake requirement with the
  deposit waived.
- `web/src/components/upload/UploadLimitsNotice.test.tsx`,
  `web/src/app/admin/users/[id]/UploadLimitsPanel.test.tsx`.

## References

- [Stake Visibility Views](stake_visibility_views.md)
- [Artist Upload Flow MVP](artist_upload_flow_mvp.md)
- [Rights Verification Workflow](rights_verification_workflow.md)
