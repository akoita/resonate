# Issue #898: Shows Campaign And Pledge Models

## Goal

Add the backend data foundation for Resonate Shows so campaigns, pledge tiers,
pledge receipts, and lifecycle events can be persisted before the public API and
wallet flows land.

## Implementation Plan

1. Extend Prisma with `ShowCampaign`, `ShowCampaignTier`, `ShowPledge`, and
   `ShowCampaignEvent`.
2. Use Prisma enums plus backend constants for campaign, pledge, confirmation,
   and lifecycle event statuses.
3. Keep chain, contract, and payment asset data configurable per record; do not
   hardcode production addresses or payment assets.
4. Add a migration and verify it applies cleanly to a fresh Postgres database.
5. Add Testcontainer-backed integration coverage for campaign -> tiers ->
   pledges -> events.
6. Update Shows feature docs and the security best-practices report.

## Verification

- `cd backend && npx prisma validate`
- `cd backend && npx prisma generate`
- `cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='shows_campaign_models.integration'`
- `cd backend && npm run lint`
- `cd backend && npm run test`
- `DATABASE_URL='postgresql://test:test@localhost:<throwaway-port>/resonate_test' npx prisma migrate deploy`
- `git diff --check`
