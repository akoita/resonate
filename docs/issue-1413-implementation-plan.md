# Issue #1413 — Creation→Commerce Bridge: list an in-app remix as a sellable ownership product

**Sprint:** Vision Sprint 5 (generation-to-ownership). **Revenue line:** (3) marketplace take-rate — reuses the existing 10% marketplace path; grows artist take-home (north star). **Vision label:** vision:core.

## Goal

Close the **create → own → sell** loop: a completed, rights-clean in-app remix can be minted + listed on the existing marketplace as an ownership product (the remix **master** stem NFT), rights-gated so only commercially-licensed remixes can be sold.

## Key findings (from reconnaissance — the design rests on these)

1. **No new Solidity needed.** `StemNFT.mintAuthorized` treats remixes as first-class (`parentIds`, `remixable`, per-token EIP-2981 `royaltyReceiver`) with **no** uploader/role/ipnft restriction; `useMintAndListStem` is generic over any authorized stem. A remix master (DB `Stem type:"master"` on a `track→release→artist(userId)` chain) satisfies the mint authorizer's ownership check.
2. **The load-bearing prerequisite is on-chain attestation**, and the existing **"Protect Release"** client flow (`useAttestAndStake`, `web/src/hooks/useContracts.ts:875-1131`) is generic to any owned release and already reachable on `/release/[id]`. Attest-only (no stake) is sufficient to list — an unstaked release has an uncapped `getMaxListingPrice` (`ContentProtection.sol:589-594`). **We do not build attestation; we route users through it.**
3. **The release page already surfaces the remix master for minting.** The owner-only "NFT Marketplace" section filters mintable stems by `type !== "original"` (`web/src/app/release/[id]/page.tsx:2188`), so `type:"master"` is included; "Mint & List" auto-runs attestation first.
4. **The rights hole:** `mint-authorization.service.ts:269` enforces only `assertMarketplaceAllowedForStem` (rights route), never the `export`/commercial gate. Selling a remix (a derivative) requires the eligibility engine's **`export`** action = **all** source stems commercial-licensed, **or** `creatorOwner` (`remix-eligibility.service.ts:225-254`, policy `:214-224`). This must be enforced at mint authorization for remix masters.
5. **Royalty (confirmed decision):** remix master mints with the standard single EIP-2981 receiver = the **remix creator**. Recursive royalty flow-through to the original source artist(s) is **deferred to #891-E3 / RFC #310** (needs an unbuilt splits contract). Tracked, not silently dropped.

## Design decisions (locked)

- **Ownership product** = the remix master stem NFT, minted+listed via the existing `mintAuthorized`→`listLastMint` pipeline. No new contract.
- **Sell-rights gate** = eligibility `export` action, enforced **at mint authorization** for remix-master stems (the chokepoint: no token is created without commercial rights). This also hardens the existing release-page flow automatically.
- **Attestation** = reuse the existing "Protect Release" flow; the bridge routes the user there.
- **Royalty** = creator now; recursive→source deferred to E3.
- **No dead buttons** (user standard): the "List this remix for sale" CTA renders only when sell-eligible; otherwise an honest disabled state names the reason.

---

## Work items

### WI-1 — Backend: sell-rights gate + remix sell-eligibility + pricing seed  *(one worker, Sonnet)*
Files: `backend/src/modules/contracts/mint-authorization.service.ts`, `backend/src/modules/remix/remix-project.service.ts`, `backend/src/modules/remix/remix.controller.ts` (or eligibility service), + `backend/src/tests/*`.

1. **Detect remix-master stems.** In `MintAuthorizationService.prepareAuthorization` (after `assertMarketplaceAllowedForStem`, `:269`), determine whether the target stem is a published remix master: resolve `RemixProject` by `publishedReleaseId === stem.track.releaseId` (schema `RemixProject.publishedReleaseId`, back-relation `Release.publishedRemixProject`), and confirm the stem is the master (`stem.type === "master"`). Reuse the lineage on `track.generationMetadata` (`kind:"remix_publish"`, `sourceTrackId`, `sourceStemIds`) as the fallback signal.
2. **Enforce the export gate.** For a remix master, call `RemixEligibilityService.checkEligibility({ userId, trackId: sourceTrackId, stemIds: sourceStemIds })` and require `allowedActions.includes("export")`. If not, throw `ForbiddenException` with an honest, specific message (e.g. `"Listing a remix for sale requires a commercial license on every source stem (or owning the source artist)."`) and a stable `code: "remix_sell_rights_required"`. Non-remix stems keep today's behavior unchanged.
3. **Reusable sell-eligibility for the UI.** Add `RemixProjectService.getSellEligibility(userId, projectId)` returning `{ sellable: boolean; reasonCode: string | null; reason: string | null; publishedReleaseId: string | null; masterStemId: string | null }`. `sellable` mirrors the export gate (published + export-eligible). Surface it on the existing `GET /remix/projects/:id` response under a `commerce` block: `commerce: { sellable, reasonCode, reason, publishedReleaseId, masterStemId }` (nullable/absent for unpublished projects). Keep the field additive/backward-compatible.
4. **Pricing seed.** At publish (`publishProject`), create a `StemPricing` row for the master stem with default `remixLicenseUsd` / `commercialLicenseUsd` so the existing List modal prefills (source the defaults from existing pricing defaults/config — do NOT hardcode a new number without reconciling `docs/rfc/business-model.md`; if unclear, mirror the source track's pricing or the existing StemPricing default and note it). Idempotent (skip if a row exists).
5. **Tests** (`.integration.spec.ts` against Testcontainer Postgres — never mock Prisma): (a) mint authorization **rejects** a remix master when source stems are only remix-licensed (no export) with `remix_sell_rights_required`; (b) **allows** when export-licensed or `creatorOwner`; (c) non-remix stem authorization unchanged; (d) `getSellEligibility` returns the right shape for published-eligible / published-ineligible / unpublished. Reuse the seeding patterns in `backend/src/tests/remix.integration.spec.ts`.

### WI-2 — Frontend: the bridge CTA  *(one worker, Sonnet; codes against WI-1's `commerce` contract)*
Files: `web/src/components/remix/RemixStudioEditor.tsx`, `web/src/lib/api.ts`, `web/src/app/release/[id]/page.tsx` (label only), + tests.

1. **api.ts**: add the `commerce` block to `RemixProject`'s type (`sellable`, `reasonCode`, `reason`, `publishedReleaseId`, `masterStemId`), matching WI-1 exactly.
2. **Studio published banner** (`RemixStudioEditor.tsx`, the `remix-published-banner` section ~1284): add a **"List this remix for sale"** CTA next to "View release page". Render as an enabled button linking to `/release/{publishedReleaseId}#nft-marketplace` **only when** `project.commerce?.sellable`. When published but `!sellable`, render a disabled control with the honest `commerce.reason` (e.g. commercial-license-required) — no dead button. Extract a small exported pure component (e.g. `RemixSellCta`) so it can be unit-tested via `renderToStaticMarkup` (mirror the #1342 `RemixGenerationAttributionBadge` pattern).
3. **Release page**: give the remix master row in the "NFT Marketplace" section a clear **"Remix master"** label so the owner knows what they are minting/listing (small, display-only). Add an `id="nft-marketplace"` anchor to that `<section>` (`page.tsx:2129`) so the studio CTA can deep-link.
4. **Tests** (`.test.tsx`, Vitest + `renderToStaticMarkup`): CTA renders + links when `sellable`; renders disabled with reason when published-not-sellable; renders nothing when unpublished.

### WI-3 — Docs + User Guide  *(maestro owns; drafted in parallel)*
- `docs/features/remix_studio.md` + `docs/features/README.md`: document the create→own→sell bridge, the `export` sell-gate, royalty (creator), and the recursive→source **deferral to #891-E3**.
- In-app **User Guide** (`web/src/lib/help/content.ts`): new/extended article "List your remix for sale" (user-visible artist action) — plain language, `appLinks`, `related`, honest `status`; keep `help.test.ts` green.
- Keep #891 open with a remaining-work note: recursive-royalty/ancestry (E3), stake-to-raise-price-cap UX.

## Verification (run by maestro on each worker's diff)
- Backend: `cd backend && npm run lint && npx jest --silent mint-authorization` and the new `*.integration.spec.ts` via `npm run test:integration -- --testPathPattern='...'`.
- Frontend: `cd web && npx vitest run src/components/remix && npx vitest run src/lib/help` + eslint on changed files + `npx tsc --noEmit` (no NEW errors vs the known pre-existing baseline).

## Business-model / change-impact
- Revenue line (3) marketplace take-rate; reuses the 10% path (ADR-BM-2) — no new fee/split/price introduced (pricing seed must reconcile with `docs/rfc/business-model.md`).
- Artist 85%+ preserved (ADR-BM-4). Rights/permission boundary **tightened** (closes the export hole). Feature docs + User Guide updated in-branch. No analytics-schema change required beyond reusing existing marketplace events (note if a `remix.listed`-style event is wanted — defer unless trivial).
