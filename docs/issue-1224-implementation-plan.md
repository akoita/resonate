# Issue #1224 — Rich Show Sample Campaigns

## Outcome

Create a repeatable, clearly fictional demo dataset for **Sennarin in Paris**,
**Felicia Farrer in Dublin**, **Leona Lewis in Lagos**, and **Aya Nakamura in
Montréal**. Each sample should pair a source-grounded artist presentation with
a compelling city/show pitch and a licensed, immersive visual set. One
idempotent command should create or refresh the complete dataset without
affecting unrelated records.

The samples must not imply that an artist, venue, or representative has
endorsed or confirmed a campaign.

## Proposed implementation

1. **Research and rights review**
   - Disambiguate each artist using official artist/label/venue profiles first,
     then reputable editorial and music-database sources.
   - Keep factual artist biography separate from fictional campaign narrative.
   - Use only imagery that is owned/provided by the artist with reusable terms,
     openly licensed, or generated specifically for the fictional show setting.
   - Record every factual source and every asset's creator, license, source URL,
     retrieval date, and permitted use in the fixture manifest.

2. **Dedicated fixture package**
   - Add `backend/prisma/fixtures/show-campaigns/` with a typed manifest, one
     profile per campaign, local media assets, and a README explaining provenance
     and refresh rules.
   - Use stable fixture IDs/slugs and relative asset paths. Keep runtime URLs,
     storage provider selection, chain configuration, and public base URLs in
     existing environment-backed configuration.
   - Include artist summary/social links, campaign pitch, city/venue/date/deadline,
     tier definitions, progress values, hero/card/gallery media, captions, and
     credits. Treat dates as offsets or refreshable values so the demo does not
     silently expire.

3. **Idempotent creation command**
   - Add a focused TypeScript command (exposed as an npm script) that validates
     the manifest, upserts the fixture artists and campaigns, replaces only the
     fixture-owned tiers/visuals, and uploads/copies media through the configured
     storage path.
   - Add explicit safety controls: local/dev by default, a clear opt-in for any
     shared environment, stable ownership metadata, dry-run support, and useful
     per-campaign output.
   - Keep the existing E2E seed independent; optionally call the sample command
     only from an explicitly named demo seed path.

4. **Presentation and API fit**
   - Reuse the existing campaign hero, card visual, and immersive gallery APIs.
   - Expose the artist summary/image/social presentation on the campaign detail
     response and page only if the current response shape does not already carry
     enough artist context.
   - Preserve graceful fallbacks and accessible image captions/credits.

5. **Verification and documentation**
   - Unit-test manifest validation and date/amount normalization.
   - Add a Testcontainer integration test proving first-run creation, repeat-run
     idempotency, and isolation from non-fixture records.
   - Add/update web tests if artist presentation changes UI behavior.
   - Run backend/web lint and targeted test suites.
   - Update `docs/features/README.md` and `docs/features/resonate_shows.md` with
     the command, fixture status, provenance boundary, and verification steps.

## Change-impact review

- **Product/lifecycle:** demo records are recognizable and refreshable; no
  accidental claim that a real booking is active.
- **Privacy/permissions:** public-source biographical facts only; no private
  contact data, scraped audience data, or inferred sensitive traits.
- **Analytics/events:** fixture creation is operational seed work, not fan demand;
  avoid emitting production campaign events during direct fixture upserts.
- **API/contracts:** additive artist-presentation fields only if needed; no smart
  contract deployment or protocol-state mutation in this issue.
- **Deployment/config:** no hardcoded environment URLs or secrets; document any
  new opt-in environment variable in `docs/deployment/environment.md`.
- **Deferred boundary:** real artist authorization, venue holds, ticket inventory,
  and on-chain escrow activation remain outside this sample-content issue.

## Validation commands (expected)

```bash
cd backend
npm run lint
npm run test
npm run test:integration -- --runInBand --testPathPattern='show.*fixture'

cd ../web
npm run lint
npx vitest run
```

The final exact command names may change after fitting the implementation to the
existing storage provider and Jest configuration.
