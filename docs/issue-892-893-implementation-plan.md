---
title: "Implementation Plan: Remix Eligibility Service And Durable Remix Projects"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/891"
  - "https://github.com/akoita/resonate/issues/892"
  - "https://github.com/akoita/resonate/issues/893"
related:
  - docs/rfc/remix-studio.md
  - docs/rfc/ai-derivative-rights-policy.md
  - docs/features/remix_studio.md
  - docs/features/remix_studio_backlog.md
---

# Implementation Plan: #892 Remix Eligibility + #893 Durable Remix Projects

Branch: `feat/892-893-remix-eligibility-and-projects`

This plan ships the two P0 backend slices of the Remix Studio MVP (#891) in one
branch: the explainable remix eligibility policy surface (#892) and the durable
`RemixProject` data model plus authenticated project APIs (#893). #893 depends
directly on #892's service, so they land together with #892 first in commit
order.

## Out Of Scope (deferred to later #891 slices)

- Frontend CTAs and `/remix/studio/:projectId` UI (#894, #895).
- `RemixGenerationProvider` and generation jobs (#896).
- Publish/export flows, License NFTs, lineage, recursive royalties.
- Artist opt-in settings UI (only a conservative policy hook here).

## Slice 1 — #892 Remix Eligibility Service

### New files

- `backend/src/modules/remix/remix-eligibility.policy.ts` — pure policy logic
  (no Prisma), versioned via `REMIX_POLICY_VERSION = "v1"`.
- `backend/src/modules/remix/remix-eligibility.service.ts` — Prisma-backed
  service that loads source/track/stem/mint/license state and delegates to the
  policy.
- Controller route on the existing `RemixController`:
  `GET /remix/eligibility?trackId=...&stemIds=a,b` (JWT-authenticated).

### Decision inputs (verified against current schema/code)

| Input | Source |
| --- | --- |
| Source rights route | `Track.rightsRoute` falling back to `Release.rightsRoute` (`upload-rights-policy.ts` routes: `BLOCKED`, `QUARANTINED_REVIEW`, `LIMITED_MONITORING`, `STANDARD_ESCROW`, `TRUSTED_FAST_PATH`) |
| Content status | `Track.contentStatus` (`clean` / `quarantined` / `dmca_removed`) |
| Mint remixability | `StemNftMint.remixable` when a mint row exists for a selected stem |
| Source opt-in hook | Conservative placeholder: policy hook defaults to allowed for `STANDARD_ESCROW`/`TRUSTED_FAST_PATH` sources, structured so an explicit artist opt-in flag can replace it without API change |
| User remix license | `StemPurchase` rows with `licenseType = remix` joined through the user's `Wallet.address` as `buyerAddress`; plus `X402Settlement` rows with `payerAddress` matching the user's wallet for the selected stems |
| Authentication | `AuthGuard("jwt")`, `req.user.userId` (existing controller pattern) |

### Policy matrix (v1, conservative)

| Condition | Result |
| --- | --- |
| Route `BLOCKED` or `QUARANTINED_REVIEW`, or `contentStatus` in `quarantined`/`dmca_removed` | denied, reason `source_blocked` / `source_quarantined` / `source_removed` |
| Route `LIMITED_MONITORING` | denied by default, reason `source_under_monitoring` (conservative per issue) |
| Route missing/unknown | denied, reason `source_rights_unknown` |
| Mint exists with `remixable = false` for any selected stem | denied, reason `stem_not_remixable` |
| Eligible source, no qualifying remix license | `allowed = false` with `requiredLicense = "remix"`, reason `license_required` (CTA: license purchase) |
| Eligible source + qualifying remix license | `allowed = true`, `allowedActions = ["private_draft"]` (publish/export stay empty in v1) |

### Response shape

```ts
{
  allowed: boolean;
  requiredLicense: "remix" | null;
  allowedActions: Array<"private_draft" | "publish_resonate" | "export">;
  reasons: Array<{ code: string; message: string }>;
  policyVersion: string;
  source: { trackId: string; rightsRoute: string | null; contentStatus: string };
  stems: Array<{ stemId: string; remixable: boolean | null; licensed: boolean }>;
}
```

Suitable for the three frontend CTA states: enabled, license-required, and
disabled-with-reason.

### Events

- `remix.license_required` published when an eligibility check (or project
  create) fails only on the license requirement.
- `remix.policy_rejected` published when source policy blocks the action.
- Both added to `event_types.ts` and mapped in
  `analytics_domain_event_bridge.service.ts` alongside the existing
  `remix.created` mapping (compact, no raw listener data).

### Tests

- `backend/src/tests/remix-eligibility.policy.spec.ts` (pure unit): blocked,
  quarantined, dmca-removed, limited-monitoring, standard, trusted,
  missing-license, already-licensed, non-remixable-mint, unknown-route cases.
- `backend/src/tests/remix.integration.spec.ts` (Testcontainers): real Prisma
  seed User → Wallet → Artist → Release → Track → Stem (+ `StemNftMint`,
  `StemListing`, `StemPurchase`) with unique `TEST_PREFIX`, verifying
  route/contentStatus/mint/license combinations through the service.

## Slice 2 — #893 Durable RemixProject Models And Project API

### Prisma models (per RFC shape, `schema.prisma` + migration)

- `RemixProject`: id, creatorUserId, sourceTrackId, title, status
  (`draft` default), mode (`stem_mix` v1), licenseType (`remix` default),
  licenseId?, prompt?, generationProvider?, generationJobId?,
  generationMetadata Json?, attribution?, exportPolicy Json?,
  policyVersion, createdAt, updatedAt; relations to User and Track; indexes on
  `creatorUserId` and `sourceTrackId`.
- `RemixProjectStem`: id, remixProjectId, stemId, role?, gainDb?, muted,
  arrangement Json?; relation to RemixProject (cascade delete) and Stem.

`npx prisma generate` + migration in the same commit.

### API (replacing the in-memory experiment)

| Route | Behavior |
| --- | --- |
| `POST /remix/projects` | Runs eligibility first; creates project + stems on allow; returns the explainable eligibility payload with 403 on policy denial; emits `remix.project_created` (and `remix.policy_rejected` / `remix.license_required` on denial) |
| `GET /remix/projects/:id` | Owner-only read (404 for missing, 403 for non-owner) returning project, stems, license context, and policy snapshot |
| `PATCH /remix/projects/:id` | Owner-only edits: title, prompt, stem gain/mute/role/arrangement; status transitions limited to `draft` ↔ `archived` in v1 |
| `GET /remix/projects` | Owner-scoped list (small addition, needed by future studio UI) |
| `POST /remix/create` | Marked legacy: kept as a thin compatibility wrapper that creates a durable project (logged + documented as deprecated) |

`creatorUserId` always comes from the JWT (`req.user.userId`) — never from the
request body (the current experimental endpoint trusts `creatorId` from the
body; this fixes that).

### Events

- `remix.project_created` (new, typed, analytics-bridged) with remixProjectId,
  creatorId, sourceTrackId, stemIds, mode, policyVersion.
- Existing `remix.created` kept for the legacy wrapper until #894+ removes it.

### Tests

- Extend `remix.integration.spec.ts`: create/read/update happy path,
  restart-durability (read through a fresh service instance), ownership
  enforcement (second seeded user gets 403), policy rejection on blocked
  source, license-required rejection, legacy `POST /remix/create` wrapper
  behavior.
- `remix.controller.http.spec.ts`: route contract, auth guard presence,
  status codes (401 unauthenticated, 403 non-owner/policy, 404 missing).

## Docs (same branch, per repo standards)

- `docs/features/remix_studio.md`: status `planned` → `partial`; document the
  eligibility API, project API, events, env (none new), and tests.
- `docs/features/README.md`: update the Remix Studio row.
- `docs/features/remix_studio_backlog.md`: mark workstream A slice
  (eligibility) and workstream B slice (durable projects) as shipped with
  issue/PR links.

## Commit plan

1. `feat(#892): add remix eligibility policy and service with tests`
2. `feat(#892): expose GET /remix/eligibility and remix policy events`
3. `feat(#893): add RemixProject Prisma models and migration`
4. `feat(#893): add authenticated remix project APIs and legacy wrapper`
5. `docs(#891): update remix studio feature docs and backlog state`

## Verification before PR

- `cd backend && npm run lint && npm run test` (unit)
- `cd backend && npm run test:integration -- --testPathPattern='remix'`
- Backend typecheck; diff whitespace check; security best-practices scan via
  the finish workflow.

## Change-impact checklist notes

- API contract: new authenticated remix endpoints documented in feature page.
- Analytics: new `remix.*` events use the governed event bridge with compact
  payloads.
- Privacy: eligibility reveals nothing about other users; license lookup uses
  only the caller's own wallet; project reads are owner-scoped.
- No client-trusted ownership claims: creator identity from JWT, license state
  from server-side purchase/settlement records.
- Partial-feature tracking: #891 remains open; #894–#896 cover the rest.
