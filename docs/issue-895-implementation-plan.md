---
title: "Implementation Plan: Remix Studio Skeleton With Stem Controls"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/891"
  - "https://github.com/akoita/resonate/issues/895"
related:
  - docs/rfc/remix-studio.md
  - docs/features/remix_studio.md
  - docs/features/remix_studio_backlog.md
  - docs/issue-894-implementation-plan.md
---

# Implementation Plan: #895 Remix Studio Skeleton

Branch: `feat/895-remix-studio-skeleton`

Replaces the #894 read-only stub at `/remix/studio/[projectId]` with the first
editable studio: source rights header, stem mute/solo/gain controls, mode
selector, prompt box, draft status panel, and persistent saves through the
#893 project API. Audio preview stays out of scope (backlog C3); generation
stays with #896.

## Backend slice (small, prerequisite)

The studio needs data and one mutation the project API does not provide yet:

1. **Enriched reads**: `GET /remix/projects[/:id]` responses gain
   - `source`: `{ trackId, trackTitle, releaseId, releaseTitle, artistName,
     rightsRoute, contentStatus }` from the `sourceTrack → release` relation —
     powers the header, rights badge, and attribution line without extra
     round-trips or exposing anything non-public.
   - per-stem `type` and `title` from the `RemixProjectStem → stem` relation —
     stem rows show "Vocals — Neon Drift" instead of a UUID.
2. **Mode updates**: `PATCH /remix/projects/:id` accepts `mode`, validated
   against the existing `REMIX_PROJECT_MODES` (`stem_mix`, `variation`,
   `extension`).
3. Tests: extend `remix.integration.spec.ts` (enriched shape, mode update,
   invalid mode rejection) and the HTTP contract spec if shapes change.

## Frontend slices

### 1. API helpers (`web/src/lib/api.ts`)

- Extend `RemixProject` type with `source` and stem `type`/`title`.
- Add `updateRemixProject(token, projectId, patch)` (PATCH helper).

### 2. Studio editor (`web/src/components/remix/RemixStudioEditor.tsx`)

Replaces `RemixStudioProjectView` as the loaded-state body of the page
(the page shell — auth gate, loading, 403/404 states — stays as shipped).

- **Header**: project title (inline editable), source attribution
  ("Remix of <track> — <artist>, from <release>" linking to
  `/release/[releaseId]`), rights badge from `source.rightsRoute` +
  `contentStatus`, license chip, draft/archived status badge.
- **Stem rows**: per stem — name/type, mute toggle, solo toggle, gain slider
  (−24 dB to +6 dB, clamped). Solo is local-only UI state (it derives which
  rows render as audible) and is labeled as preview-only; mute and gain
  persist. No audio playback in this slice (C3).
- **Mode selector**: segmented control for stem mix / variation / extension;
  persists via PATCH.
- **Prompt box**: textarea, shown for variation/extension (disabled with a
  note for stem mix); persists via PATCH.
- **Draft status panel**: shows status, policy version, and an honest
  generation placeholder ("No AI draft yet — generation arrives with #896").
- **Publish/Export**: rendered as unavailable actions with honest reasons
  ("Publishing inside Resonate is not available yet";
  "Export requires a license that explicitly grants export rights") using
  `aria-disabled` so the reasons are keyboard/screen-reader reachable
  (also fixes the #1138 review's accessibility note on the CTA chips).
- **Save flow**: explicit Save button with dirty-state tracking; a pure
  `buildProjectPatch(original, edits)` helper computes the minimal PATCH
  payload (only changed fields/stems). Save errors surface via toast; saved
  state reflects the server response.

### 3. CTA draft-reuse (review follow-up from #1138)

`RemixCta`'s enabled click first checks `listRemixProjects` for an existing
`draft` project with the same `sourceTrackId` (and, when the CTA is
stem-scoped, the same stem set) and opens the most recent one instead of
creating a duplicate; otherwise it creates as today.

### 4. Accessibility follow-up

Blocked/signed-out CTA chips switch from `disabled` to `aria-disabled` +
inert click so denial reasons are focusable/announced.

## Tests (vitest, renderToStaticMarkup + pure helpers)

- `buildProjectPatch`: no-op → empty patch; title/prompt/mode/stem changes →
  minimal payload; gain clamping.
- Editor render: loaded project (header, attribution, rights badge, stem
  rows), publish/export unavailable states with reasons, prompt box
  disabled-for-stem-mix state, solo-is-local labeling.
- CTA draft-reuse: pure resolver picking the most recent matching draft.
- Existing page-shell tests keep passing.

## Docs

- `docs/features/remix_studio.md`: studio surface implemented (minus audio
  preview/generation); update verification list.
- `docs/features/README.md` catalog row.
- `docs/features/remix_studio_backlog.md`: C2 shipped (audio preview stays
  C3); note A1 still open.

## Commit plan

1. `feat(#895): enrich remix project api with source context and mode updates`
2. `feat(#895): add remix studio editor with stem controls and saves`
3. `feat(#895): reuse existing drafts from remix cta and fix chip a11y`
4. `docs(#891): update remix studio docs for studio skeleton`

## Verification

- Backend: `npm run lint`, remix integration tests, HTTP contract spec.
- Web: `npx vitest run` (full), eslint on changed files, `npm run build`.
- Security scan greps + `git diff --check` + audit report entry.
