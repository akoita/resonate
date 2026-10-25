---
title: "Entitlements and Artist Pro grants"
status: in-progress
owner: "@akoita"
---

# Entitlements and Artist Pro grants

## Status

`in-progress`: slice 1 of Artist Pro has shipped (`docs/rfc/artist-pro.md`
§10, item 1; [#2406](https://github.com/akoita/resonate/issues/2406)). It adds
one entitlement service, operator grants of the Pro plan, and the plan on
`GET /usage/summary`. The policy is `entitlements/v1` with the rule
`everyone`, so **nothing a person can do has changed**. Remix Studio Pro mode,
Crate Digger Pro and the cockpit demand cards stay free for every signed-in
person.

The later slices are tracked separately:

| Slice | Issue | What it adds |
| --- | --- | --- |
| 2 | [#2407](https://github.com/akoita/resonate/issues/2407) | Stripe subscriptions in test mode (a `Subscription` model, checked before grants). Built: see [Artist Pro billing](artist_pro_billing.md) |
| 3 | [#2408](https://github.com/akoita/resonate/issues/2408) | The monthly allowance (`credits.allowance`, `monthlyAllowanceCents`) |
| 4 | [#1422](https://github.com/akoita/resonate/issues/1422) | Buying credits |
| 5 | [#2409](https://github.com/akoita/resonate/issues/2409) | Pro gates on: the bump to rule `plan`, after the RFC's §8 gates |

Later items are in [#2410](https://github.com/akoita/resonate/issues/2410).

**Revenue line (ADR-BM-6):** line 2, Artist Pro, Phase 2. This slice is
infrastructure with no price, charge or fee change. ADR-BM-4 is unaffected:
Pro sells tools, never a share of fans' money and never exposure.

## Audience

- **Admins:** grant Pro to a founder, a partner or for support, until a date,
  and revoke it. This is on the Plan section of a person's record
  (`/admin/users/:id`).
- **Artists, producers and DJs:** Settings › Usage & Billing shows
  **Pro (granted)** and its last day when they hold a grant, **Pro** with a
  subscription (#2407, [Artist Pro billing](artist_pro_billing.md)), or Free
  with the Artist Pro subscription offer.
- **Backend developers:** every gate is decided by
  `EntitlementsService.decide(userId, feature)`.

## How it works

### The decision

`backend/src/modules/entitlements/` holds three pieces:

- `entitlements.policy.ts` is pure. `decideEntitlement(feature, plan, policy)`
  returns `{ allowed, reason, plan, source?, validUntil?, policyVersion }`. The
  features are `remix.pro`, `crate.pro` and `cockpit.demand`.
  `credits.allowance` arrives with #2408.
- `EntitlementsService.resolvePlan(userId)` looks for a plan in this order:
  1. the person's Stripe subscription (#2407, `subscription_plan.ts`): active
     or trialing until the period end (with 3 days' slack for a late renewal
     event), past due for 7 days from `pastDueSince`, or canceled at period
     end until that end;
  2. an active grant;
  3. otherwise `free`.

  Nothing is cached between calls, so a grant or a revocation is seen by the
  next decision.
- Under `everyone`, every feature is allowed with the reason
  `free_for_everyone`, as before. The plan is still recorded, so `plan: "pro"`
  is accurate for someone with a grant.

  The later rule `plan` is implemented and tested but not in force. It allows
  `pro` (reason `plan` for a subscription, `grant` for a grant) and denies
  `free` with `pro_required`. Switching to it is one policy version bump. It is
  reconciled in `docs/rfc/business-model.md` (Layer 2b) first.

### The adapters

The adapters keep the DTOs and the 403 behaviour exactly as they were:

- **`RemixEntitlementsService`** (`remix.pro`) and
  **`CrateEntitlementsService`** (`crate.pro`, also used for export and watch)
  call `decide`. They return the same
  `{ allowed, reason, policyVersion }` shape with their own policy versions
  (`remix-pro-policy/v1`, `crate-pro-policy/v1`), so project and crate
  responses are unchanged. A future denial is still answered with
  `403 pro_required` by the existing callers.
- **`SceneScoutEntitlementsService.canRead(artistId)`** decides
  `cockpit.demand` for the account that holds the artist profile (the
  artist's own user, else the managing account). It covers:
  - Scene Scout city demand and the show proposals (`propose_show_city`);
  - unmet request demand;
  - first-week discovery reception.

  Shows campaign cards (`review_show_city_demand`) are not gated, because
  Shows stay free.

### Grants

`EntitlementGrant` has these fields:

- `userId`;
- `plan` (`pro`);
- `source` (`operator_grant` or `promo`);
- `validFrom` and an optional `validUntil` (the end is exclusive);
- `reason`, the admin's note;
- `createdByUserId`, `createdAt`;
- `revokedAt` and `revokedByUserId`.

Revoking keeps the row. With several active grants, an open-ended grant wins,
then the grant that ends last.

The admin routes are admin only. Operators get `403`.

| Route | Step-up | Audit |
| --- | --- | --- |
| `GET /admin/entitlements/grants?userId=` | no | not recorded: shown on the record page, whose opening is already recorded as `user.detail_viewed` |
| `POST /admin/entitlements/grants` | yes | `entitlement_grant.created`: target user, grant id, plan, source and `validUntil` |
| `DELETE /admin/entitlements/grants/:id` | yes | `entitlement_grant.revoked`: target user, grant id and plan |

The note is never written into the audit log. Bodies use class DTOs. Errors:

- `400` for an invalid body, and `invalid_validity` for an end in the past or
  before the start;
- `404 user_not_found` and `404 grant_not_found`;
- `409 already_revoked`.

### Personal data

`reason` is personal data about the person:

- It is included in their data export. The admin ids are redacted from the
  export.
- On the person's erasure it is scrubbed, and the grant is kept, anonymized.
- `createdByUserId` and `revokedByUserId` are dangling admin ids, rewritten
  when that admin is erased.

See `docs/engineering/personal-data-inventory.md`.

### Agents and MCP

No agent or MCP tool checks an entitlement today: agents do not create crates,
export them, or set Remix Pro fields. When one does, it must call `decide` with
the id of the person it acts for, never its own (RFC §4).

## How to test

- Unit tests:
  - `backend/src/tests/entitlements_policy.spec.ts`: the decision table and
    grant resolution;
  - `remix-entitlements.spec.ts` and `crate_entitlements.spec.ts`: the
    adapters, unchanged.
- HTTP: `admin_entitlement_grants.controller.http.spec.ts` covers `401`,
  `403`, step-up, the audit record and DTO `400`s.
- Postgres:
  - `entitlements.integration.spec.ts` covers grants, the decisions, the
    adapters, `cockpit.demand` and erasure;
  - `usage-summary.integration.spec.ts` covers the Pro plan from a grant.
- Pinned in `admin_step_up_routes.spec.ts` and `admin_audit_coverage.spec.ts`.
- Web:
  - `EntitlementGrantsPanel.test.tsx` and `UserDetailView.test.tsx`;
  - `UsageBillingPanel.test.tsx`;
  - `adminStepUpGatedActions.test.ts` and `adminAudit.test.ts`.

## References

- RFC: [`docs/rfc/artist-pro.md`](../rfc/artist-pro.md) §2–§4 and §10.
- Business model: [`docs/rfc/business-model.md`](../rfc/business-model.md)
  (Layer 2b).
- Usage & Billing: [`docs/rfc/usage-billing.md`](../rfc/usage-billing.md)
  (the `plan` field).
- User Guide: `admin-users` (Granting Pro) and the Usage & Billing section of
  the AI generation article.
