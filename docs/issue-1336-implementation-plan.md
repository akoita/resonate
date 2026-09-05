# Issue #1336 — DDEX-aligned AI disclosure and fully-AI promotion policy

> Status: implemented and locally verified in the issue worktree.
> Branch: `feat/1336-ddex-ai-labeling`
> Parent policy: ADR-BM-5 (accepted 2026-07-05) and AI Music Integrity epic
> [#1164](https://github.com/akoita/resonate/issues/1164).

## Outcome

Every new release declares AI involvement at track level, Resonate-native
generation records that declaration automatically, and public/API surfaces use
one normalized disclosure contract. Fully AI-generated music remains available
in the catalog and marketplace with honest labeling, but is not promoted as
human-artist work by recommendations, AI DJ, trending, or top-artist rankings.

The human-verification payout gate is already implemented by #1498 and is not
reimplemented here.

## Business-model conformance

- **Revenue line / phase:** `vision:core` trust infrastructure supporting
  revenue line (3), marketplace take-rate, and the cross-phase AI Music
  Integrity program. It does not add or change a fee, split, price, or payout
  amount.
- **ADR-BM-4:** marketplace proceeds remain transaction-funded and
  user-centric; there is no pro-rata royalty pool, platform-subsidized payout,
  fan income-share product, recoupment, or artist-share reduction.
- **ADR-BM-5:** upload remains open; declared fully-AI work may be sold with
  disclosure; human verification still gates payout destinations independently
  through the existing payout-eligibility service.

## Standards baseline

Use DDEX ERN 4.3.1 semantics, retained by the current ERN 4.3.2 publication:

- `SoundRecording.ContainsAI`: `None`, `Partly`, or `All`;
- contributor-level `AiContribution`: `None`, `Partly`, or `All`;
- `SpecialContributor=GenerativeAI` when an AI system is represented as the
  contributor, with roles describing the affected contribution.

Resonate stores a fourth internal state, `Undeclared`, for legacy or incomplete
records. It is never exported as a DDEX assertion and is never displayed as
"human-made." Sources:
[DDEX SoundRecording data dictionary](https://service.ddex.net/dd/DD-ERN-431/dd/ern_SoundRecording.html),
[DDEX Contributor data dictionary](https://service.ddex.net/dd/DD-ERN-431/dd/ern_Contributor.html),
[DDEX ERN 4.3.2 publication](https://service.ddex.net/doc/Standards/ERN432/ERN-3305%20-%20ERN%20Part%201%20Definition%20of%20messages%20v4.3.2.pdf).

## Settled design decisions

1. **Track-level source of truth.** DDEX attaches `ContainsAI` to a sound
   recording, so the persisted declaration belongs on `Track`, not on
   `Release.type`. Release-level API/UI state is a derived summary across its
   tracks.
2. **Do not overload `Release.type`.** Existing `ai_generated` release typing
   remains supported for native generation and legacy compatibility, while the
   new disclosure fields carry interoperable AI meaning for uploaded singles,
   EPs, albums, and remixes.
3. **Required for new uploads, honest for legacy data.** Human, AI-assisted,
   and fully-AI choices map to DDEX `None`, `Partly`, and `All`. Existing
   records without reliable provenance backfill to `Undeclared`, not `None`.
4. **Facets are declarations, not detection verdicts.** Contribution facets
   cover vocals, instruments, composition/lyrics, production, and
   post-production. Detection confidence/model output remains owned by #347
   and later #1164 slices.
5. **Promotion policy is centralized and fail-closed for `All`.** A shared
   backend predicate excludes fully-AI tracks from algorithmic/human-artist
   promotional candidate sets. `Partly` remains eligible and labeled.
   `Undeclared` remains visible during migration but is labeled and measured;
   moderation/enforcement of undeclared legacy content stays in #1164.
6. **Marketplace remains open with disclosure.** `All` does not itself block
   listing or mint authorization. Existing rights, trust, content-protection,
   and payout-eligibility checks still apply unchanged.

## Implementation stages

### A. Persistence, migration, and normalized policy

- `backend/prisma/schema.prisma`
  - Add an enum equivalent to `UNDECLARED | NONE | PARTLY | ALL`.
  - Add track fields for disclosure level, declared contribution facets,
    declaration source (`artist`, `resonate_native`, `remix_derived`, or
    `migration`), disclosure schema/version, and declaration timestamp.
  - Index the disclosure level used by discovery filters.
- `backend/prisma/migrations/<timestamp>_add_ai_disclosure/`
  - Backfill Resonate-native `Release.type = "ai_generated"` tracks to `ALL`.
  - Backfill published remixes from their existing grounding metadata where
    the mapping is unambiguous (`stem_audio -> NONE`, mixed/conditioned
    generation -> `PARTLY`, prompt-only -> `ALL`).
  - Leave all other legacy records `UNDECLARED`.
- Add `backend/src/modules/catalog/ai-disclosure.policy.ts` with pure helpers
  for validation, DDEX mapping, release-summary derivation, listener-safe label
  text, and the promotional-eligibility predicate. Do not duplicate these
  rules in catalog, recommendation, agent, or marketplace services.

### B. Write paths and declaration contract

- `backend/src/modules/catalog/catalog.controller.ts` and
  `backend/src/modules/catalog/catalog.service.ts`
  - Extend create/update input with a required declaration for every new track.
  - Validate contribution facets: `NONE` has none; `PARTLY` requires at least
    one; `ALL` may optionally identify affected roles but is always labeled
    fully AI-generated.
  - Permit owner correction before publication; post-publication changes must
    be explicit/auditable rather than silently overwritten.
- `backend/src/modules/ingestion/ingestion.service.ts` carries the normalized
  declaration through the multipart upload path.
- `backend/src/modules/generation/generation.service.ts` writes `ALL` with
  `resonate_native` source without asking the artist to self-declare known
  platform provenance.
- `backend/src/modules/remix/remix-project.service.ts` derives `NONE`,
  `PARTLY`, or `ALL` from the existing grounding mode and records
  `remix_derived`.
- Emit a compact domain event such as `catalog.ai_disclosure_recorded` through
  `backend/src/events/event_types.ts` and the analytics bridge. Payloads contain
  only ids, level, source, and facet codes—never prompts or free text.

### C. Public, web, and agent-facing contracts

- `backend/src/modules/catalog/catalog.service.ts` returns a normalized
  track-level disclosure and derived release summary from owner and public
  reads; no raw generation metadata or prompts are exposed.
- `backend/src/modules/contracts/metadata.controller.ts` and relevant
  marketplace/agent contracts expose the same stable disclosure shape instead
  of deriving only a boolean `isAiGenerated`.
- `web/src/lib/api.ts` defines one typed `AiDisclosure` contract used by all
  screens.
- `web/src/app/artist/upload/page.tsx`
  - Require Human-made / AI-assisted / Fully AI-generated per track, with a
    release-wide apply-to-all shortcut.
  - Show facet controls for AI-assisted tracks and plain-language consequences
    before upload.
- Add a shared `web/src/components/content/AiDisclosureBadge.tsx` and use it on
  release detail, catalog/home cards, player context, artist catalog, and
  marketplace/listing surfaces. Distinguish "AI-assisted", "AI-generated",
  and "AI disclosure unavailable"; do not display `Undeclared` as verified
  human work.
- Preserve the disclosure in recommendation/home-feed responses so web and
  external agent consumers can honor it even when the backend has already
  applied promotion policy.

### D. Fully-AI promotion policy

- `backend/src/modules/recommendations/recommendations.service.ts` and
  `backend/src/modules/recommendations/home-feed.service.ts`: exclude `ALL`
  tracks from recommendation and personalized promotional rails at query time.
- `backend/src/modules/agents/agent_selector.service.ts` and
  `backend/src/modules/agents/tools/tool_registry.ts`: apply the same predicate
  to AI DJ/catalog-tool candidates so alternate agent paths cannot bypass the
  policy.
- `backend/src/modules/catalog/discovery-popularity.service.ts`: exclude `ALL`
  tracks from trending and from engagement used to rank human top artists.
- Keep direct catalog/search, artist pages, owned playlists, release links,
  playback, and marketplace discovery available with labels. The policy is an
  exclusion from human-artist promotion, not a delisting or monetization ban.

### E. Tests, docs, and rollout truth

- Backend pure tests in `backend/src/tests/ai-disclosure.policy.spec.ts` cover
  DDEX mapping, facet validation, mixed-release summaries, and promotional
  eligibility.
- Backend integration/HTTP tests use Testcontainers and cover:
  - missing declaration rejected for a new upload;
  - native generation and remix derivation;
  - legacy `UNDECLARED` remains honest;
  - owner/public API redaction and response shape;
  - `ALL` excluded from recommendations, AI DJ, trending, and top artists;
  - `ALL` still available in direct catalog and marketplace paths;
  - `PARTLY` remains promotable and labeled.
- Web tests cover required upload choices, facet validation, shared badge copy,
  and badges on the primary listener surfaces.
- Update `docs/features/README.md`; add
  `docs/features/ai_music_integrity.md`; update
  `docs/features/payout_eligibility.md` so the completed/deferred ledger is
  accurate.
- Update the in-app User Guide in `web/src/lib/help/content.ts`, add/refresh the
  upload and listener-facing screenshots, and keep
  `web/src/lib/help/help.test.ts` green.
- Update the #1164 checklist after implementation. If detection, sanctions,
  appeals, or DDEX XML export remain deferred, keep them explicitly open rather
  than claiming the epic complete.

## Verification commands

```bash
cd backend
npx prisma generate
npm run lint
npx jest --runInBand --testPathPattern='ai-disclosure.policy|catalog.controller|generation|remix'
npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='ai-disclosure|recommendations|discovery-popularity'

cd ../web
npm run lint
npx vitest run src/components/content/AiDisclosureBadge.test.tsx src/lib/help/help.test.ts
```

Run additional focused agent, marketplace, upload, and route tests named by the
actual diff. CI retains the broad suite.

## Local verification result

- Prisma schema validation and client generation passed.
- Backend TypeScript lint passed.
- Focused backend unit suites passed (policy, analytics bridge/taxonomy, agent
  selection, and catalog controller coverage).
- Testcontainers integration suites passed for catalog, recommendations,
  popularity, native generation, remix publication, and agent catalog search.
- Web ESLint passed with pre-existing warnings and the focused disclosure/User
  Guide tests passed.
- Full web TypeScript reports only the same pre-existing test-fixture errors
  present on `main`; this change introduces no additional type errors.
- `git diff --check` passed.

## Explicitly deferred

- Classifier/detector selection, confidence, model versions, re-scans, and
  declaration mismatch handling (#347/#1164).
- Automated sanctions, demonetization, delisting, moderation queues, and
  appeal flows (#1164/#404).
- C2PA and on-chain generation credentials (#349).
- General-purpose DDEX XML import/export. This slice aligns the internal/public
  contract with ERN semantics so export can be added without remapping product
  truth.
- Proof-of-personhood integrations; the existing verified-human payout gate
  remains the authority for payout destinations.
