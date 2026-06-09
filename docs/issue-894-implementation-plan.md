---
title: "Implementation Plan: Release And Stem Remix CTAs"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/891"
  - "https://github.com/akoita/resonate/issues/894"
related:
  - docs/rfc/remix-studio.md
  - docs/features/remix_studio.md
  - docs/features/remix_studio_backlog.md
  - docs/issue-892-893-implementation-plan.md
---

# Implementation Plan: #894 Remix CTAs

Branch: `feat/894-remix-ctas`

Adds the visible Remix Studio entry points backed by the #892 eligibility API
(`GET /remix/eligibility`) and the #893 project API (`POST /remix/projects`).

## Sequencing decision: minimal studio destination stub

The enabled CTA must "create/open remix project", but the studio page is #895.
To avoid an enabled CTA that navigates to a 404, this slice includes a
deliberately minimal, read-only `/remix/studio/[projectId]` page: auth-gated,
loads the project via `GET /remix/projects/:id`, shows title, source, stems,
draft status, and a clear "studio editing arrives next" note with no
publish/export affordances. #895 replaces its body with the real studio.

## Slices

### 1. API helpers (`web/src/lib/api.ts`)

- `RemixEligibilityResponse` and `RemixProject` types mirroring the backend
  response shapes.
- `getRemixEligibility(trackId, stemIds | undefined, token)`.
- `createRemixProject({ sourceTrackId, stemIds, title, mode? }, token)`.
- `getRemixProject(projectId, token)`.
- Follows the existing `apiRequest` + Bearer-token pattern; no new fetch stack.

### 2. Shared CTA component (`web/src/components/remix/RemixCta.tsx`)

Props: `trackId`, `stemIds?`, `variant: "button" | "chip"`, optional
`trackTitle` (used for the default project title).

States (driven by the eligibility API, never inferred client-side):

| Eligibility | CTA |
| --- | --- |
| signed out | compact disabled chip "Sign in to remix" (no eligibility call without a token) |
| loading | nothing (no layout shift), chip variant shows skeleton |
| `allowed` | enabled "Remix" button → `POST /remix/projects` → navigate to `/remix/studio/<id>`; double-submit guarded; API errors surface via toast |
| `requiredLicense: "remix"` | "Get remix license" → routes to `/marketplace` (the existing BuyModal already offers the remix tier there); copy says a remix license unlocks the studio |
| denied | disabled chip with the first user-facing reason from `reasons[]` (full list in `title` tooltip), reusing the lock-chip pattern from `PlayerActionPanel` |

Copy stays rights-aware: no mention of export, monetization, or voice/likeness;
the studio stub states drafts are private.

### 3. Surfaces

- **Release detail** (`web/src/app/release/[id]/page.tsx`): per-track Remix CTA
  (chip variant) in the track row for tracks with stems; one eligibility call
  per stemmed track (typical releases are small; no batch endpoint yet — noted
  as a follow-up if releases grow).
- **Stem detail** (`web/src/app/stem/[tokenId]/page.tsx`): button-variant CTA
  near the existing listing actions, scoped to that stem
  (`stemIds=[stemId]`).
- **Marketplace listing cards**: intentionally unchanged — per-card eligibility
  calls would fan out N requests; the existing `Remixable` badge stays the
  discovery signal and the stem/release pages are the authoritative entry
  points. Documented as a deliberate scope boundary.
- **Player action layer**: unchanged; its heuristic `remix` action already
  links to the release page, which now carries the authoritative CTA.

### 4. Studio destination stub (`web/src/app/remix/studio/[projectId]/page.tsx`)

- Auth-gated; loads `GET /remix/projects/:id`; 403/404 render friendly states.
- Shows: project title, draft status badge, source track link, selected stems
  with mute/gain values (read-only), policy version, "Private draft —
  publishing and export are not available yet" note.
- No editing controls in this slice (#895 owns them).

### 5. Tests (vitest)

- `RemixCta.test.tsx`: enabled, license-required, and blocked states (mocked
  api module), signed-out state, and create-project navigation handoff.
- Studio stub: loading/forbidden/loaded render states.
- Follows the `renderToStaticMarkup` + `vi.mock` conventions used by
  `PlayerActionPanel.test.tsx`.

### 6. Docs

- `docs/features/remix_studio.md`: CTA + stub routes move from planned to
  implemented; UI usage notes.
- `docs/features/README.md`: catalog row updated.
- `docs/features/remix_studio_backlog.md`: C1 shipped; C2 noted as stub-only.

## Commit plan

1. `feat(#894): add remix eligibility/project api helpers`
2. `feat(#894): add RemixCta component with eligibility-driven states`
3. `feat(#894): wire remix CTAs into release and stem surfaces with studio stub`
4. `docs(#891): update remix studio docs for CTA slice`

## Verification

- `cd web && npx vitest run src/components/remix src/app/remix` (focused)
- `cd web && npm run lint` (scoped eslint on changed files if full lint is slow)
- `cd web && npm run build` (new route added → build validation applies)
- Backend untouched → no backend gates beyond existing CI.
