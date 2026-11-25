# Preview measures

Status: `partial` ([#2670](https://github.com/akoita/resonate/issues/2670),
Vision Sprint 60 "Ready to show"). Stem previews are not recorded yet
([#2689](https://github.com/akoita/resonate/issues/2689)).

Revenue line: vision-neutral operations. No fee, split, price or payout change.

## What it is

A read-only admin page, `/admin/preview-measures`, that answers for a chosen
period (at most 92 days, default the last 28):

| Figure | Source | Notes |
| --- | --- | --- |
| Artists who joined with an artist invitation, and the share who published within 14 days | `InvitationRedemption` (role `artist`), the artist's first `ready`/`published` `Release` | Artists still inside their 14 days are counted apart and left out of the share. |
| Listeners who joined, and the share active in each of their first four weeks | `User` without an artist profile; activity = any `AnalyticsEvent` for the account's pseudonymous actor id | Consenting accounts only (`AnalyticsConsent.productAnalytics`). A week counts once it has fully passed. |
| People using each feature, per week | `Session` (AI DJ), `RemixProject`, `Crate`, `PunchlineCollectible` (Drops), `ShowInterest`, `LibraryTrack` with `source = local` | Distinct accounts per seven-day bucket from the start of the period. Stem previews: not recorded yet (#2689). |
| Support requests opened, answered, median time to an answer | `SupportRequest` | Time to the request's last status change, which is the first answer for a request handled once. |
| Uploads refused by a limit; takedown and community reports | `UploadLimitRefusal` (new, written when an upload limit refuses), `DmcaReport`, `CommunityModerationReport` | |

Everything comes from the application database; no warehouse.

**Small groups.** A count from 1 to 4 is returned as `null` and shown as
"fewer than five". A share is shown only when its base is at least five and no
part of it is hidden. The server applies the rule, so the numbers never reach
the browser.

## Backend

| Route | Access | Notes |
| --- | --- | --- |
| `GET /admin/preview-measures?from=&to=` | admin | `@AdminAudit("preview_measures.viewed")`; no step-up (read-only). |

Module `backend/src/modules/preview_measures/`. `UploadLimitRefusal` stores
the limit key, the artist id and the time only; it is in the data download and
deleted on erasure.

## Tests

`preview_measures.spec.ts` (small-group rule, period, weeks),
`preview_measures.controller.http.spec.ts` (admin only, audited),
`preview_measures.integration.spec.ts` (every figure with seeded data in a
window no other suite writes to), web `previewMeasures.test.ts` and
`PreviewMeasuresView.test.tsx`. User Guide: `admin-users`, section "Preview
measures".
