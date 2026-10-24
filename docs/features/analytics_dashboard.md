---
title: "Analytics Dashboards"
status: partial
owner: "@akoita"
issues: [25, 982, 1121]
---

# Analytics Dashboards

## Goal

Provide high-fidelity visual dashboards for Resonate artists and operators to
track catalog performance, settlement earnings, content-protection history, and
AI DJ recommendation quality.

The dashboard follows the **Obsidian Frequency (v2)** design system guidelines, reserving **Electric Violet** for AI-agent autonomous context and leveraging **Hyacinth Blue** for standard human-initiated metrics.

---

## Audience & Value

- **For Artists**: Provides clear visual tracking of plays over time, gross settled sales rollups (labelled **Gross sales**, not payout; see below), content protection route decision counts (Marketplace Ready vs Restricted/Blocked), first-slice recommended action cards, and detailed EVM staking escrow histories (Coup De Goule, Ah W Nass, etc.).
- **For Operators/Product Owners**: Provides aggregate AI DJ recommendation quality metrics so analytics-powered taste changes can be monitored before model promotion.
- **For Developers**: Demonstrates how to map versioned analytics facts from the BigQuery/Postgres ledger directly to standard React UI layers using performant, responsive SVG charting without heavy external chart libraries.

---

## How to Use

### As an End User
1. Log in to the Resonate portal and connect your EVM smart wallet.
2. Click **Analytics** in the left sidebar menu to navigate to `/artist/analytics`.
3. Toggle date ranges between **7d**, **30d**, and **90d** using the pill controls at the top right.
4. Hover over the **Plays over time** spline chart to reveal active tooltips showing daily metrics.
5. Review the **Sources breakdown progress bars** and the **Track Performance table**.
6. Use the **Action Cockpit** cards to open the player, marketplace management,
   artist community tab, or catalog review flow when aggregate signals support
   an action.
7. Monitor active escrow allocations under the **Content Protection Staking & escrow overview**.
8. Operators can open `/analytics/agent-quality` to review aggregate AI DJ
   acceptance, first-pick skip, session duration, save, playlist-add, purchase,
   strategy, taste-source, and model/materialization-version metrics.

### As a Developer
The frontend page [page.tsx](../../web/src/app/artist/analytics/page.tsx) automatically reads the authenticated wallet address and JWT token, queries [api.ts](../../web/src/lib/api.ts), and executes:
- `GET /analytics/artist/:id/v1?days=N` — returns the plays/payout fact aggregates grouped by tracks, sessions, and sources.
- `GET /analytics/agent/quality?days=N` — returns aggregate AI DJ quality
  metrics for `admin` and `operator` roles only.
- `GET /api/metadata/stakes/analytics/:address` — fetches EVM smart contract staking counts, active/refunded stakes, and historical deposits.

The backend derives the KPI totals, track-performance rows, source breakdown,
and plays-over-time chart from the same bounded `analytics_facts` slice. Daily
`analytics_views` remain available for warehouse consumers, but the artist
dashboard does not prefer them over facts so partial current-day windows cannot
drift from the rest of the report.

**Gross sales, not payout (#2144).** `summary.totalPayoutUsd`, the per-track,
per-session and plays-over-time `payoutUsd`, and `export.totalPayoutUsd` keep
their field names for API compatibility, but they sum the gross settled
stablecoin sale amount (`commerce.settled`, see
[analytics_event_ledger.md](analytics_event_ledger.md#settled-commerce-facts-1894)).
They are taken before the on-chain marketplace platform fee and the royalty
splits. Native-token sales count in `payoutsByAsset`, but they add nothing to
the USD sums. They are not the artist's net share. `GET /analytics/artist/:id`
and `GET /analytics/artist/:id/v1` state this explicitly with
`summary.payoutBasis: "gross_settled"` (also on `export.payoutBasis` in the v1
response). The dashboard labels the KPI and the track-table column **Gross
sales**. The KPI shows the line "Settled stablecoin sales before the platform
fee and royalty splits. Native-token sales are counted but not converted to
USD." The fee percentage appears only after the page has read the live on-chain
marketplace fee. Paid stem downloads through the agent payment router and MCP
count toward gross sales from #2144 on.

### Net received (#2172)

Beside the gross KPI, `GET /analytics/artist/:id/v1` returns a `netReceived`
block and the dashboard shows a **Net received** KPI plus a **Marketplace sales:
gross and net** table (gross, platform fee, net, or **Pending**, per recent
sale). It is read-only reporting: no fee, split or payout changes, and the
artist share stays at least 85% (ADR-BM-4). Revenue line: ADR-BM-6 Line 3
(marketplace).

- **Design.** The gross `commerce.settled` fact is left exactly as emitted (an
  immutable ledger row; no new event name, so the warehouse mappings and the
  Dataflow transform are untouched). The net is derived from the settlement
  record the indexer already keeps: `StemPurchase` now carries the real split,
  finalised by `finalizeMarketplaceSaleSplit`
  (`backend/src/modules/contracts/marketplace_sale_split.ts`) from facts the
  indexer holds: the `RoyaltyPaid` log that precedes the `Sold` log in the same
  transaction (matched by token and log position, so a batched transaction keeps
  each sale's royalty apart) and `protocolFeeBps()` read at the Sold block, so a
  later fee change never rewrites a past sale. The amounts follow the contract's
  arithmetic (`fee = floor(total x bps / 10000)`; the seller keeps the
  remainder). The three amount columns are `"0"` until `splitFinalizedAt` is set:
  `"0"` there means "not known yet", never "zero".
- **What counts as received.** The part of a sale paid to the artist's own
  addresses (artist payout address, the owning user's wallet, the stem's
  creator address): the seller proceeds when the artist was the seller, plus the
  royalty when the artist was its recipient. A first sale by the artist nets the
  gross minus the platform fee (the royalty returns to them); a collector's
  resale nets the royalty only; a royalty paid to another creator is not the
  artist's. Per asset, net + platform fee + other parties = the gross of the
  finalised sales, so the figures reconcile with the canonical fee table in
  [`docs/rfc/business-model.md`](../rfc/business-model.md) (10% on-chain take on
  marketplace sales, ADR-BM-2).
- **Pending.** A sale whose split is not final is `pending` and carries no net.
  It is counted apart (`pendingSales`, `pendingGrossUnits`), never as zero or
  as the gross, and the UI says so. A sale is pending when its `RoyaltyPaid` log
  is not indexed yet (with no log, the royalty is proven zero by asking the
  StemNFT `royaltyInfo` at the Sold block before it is believed), when the fee or
  royalty cannot be read from the chain, when the StemNFT is unknown, or when
  the row predates `logIndex`. The `RoyaltyPaid` handler and a replay of the Sold
  log both retry a pending sale. Rows indexed before this change are retried at
  backend start (the 50 most recent pending sales, via
  `ContractsService.finalizePendingSaleSplits`); one whose block the RPC node
  can no longer serve stays pending rather than guessing.
- **Not covered.** x402 sales that settle outside the marketplace contract are
  paid to the platform payout address and no per-sale artist payout is recorded,
  so they are never part of Net received (`coverage.x402: "entitled_only"`):
  they are reported apart as **entitled net** (below). Native-token sales are
  reported in their own units (no invented USD price). Up to 2000 of the newest
  sales in the window are summed (`truncated` flags more).
- **Legacy pending sales (#2344).** Sales indexed before #2172 finalise at
  startup only for the 50 most recent, and only if the RPC node still serves the
  old block. The dry-run-first backfill finalises the rest with the same logic
  (see [Backfilling pending sale splits](#backfilling-pending-sale-splits-2344)).
- **`RoyaltyPayment` batches (#2344).** `RoyaltyPayment` is now keyed on the
  `RoyaltyPaid` log, (`transactionHash`, `logIndex`), not on (`transactionHash`,
  `tokenId`): a batched transaction with two sales of one token used to keep only
  the first royalty row, so royalty reports undercounted. The migration
  `20261024140000_royalty_payment_log_index` adds a nullable `logIndex` and
  backfills every existing row from the raw `RoyaltyPaid` event (matched by
  transaction, chain, token, recipient and amount; lowest position). A row with
  no match keeps a null position (a Postgres unique key treats nulls as
  distinct); the indexer then **adopts** it when the same payment arrives again
  instead of adding a duplicate. The split logic (#2172) reads the raw events and
  was never affected.

### Entitled net for x402 sales (#2344)

`netReceived.entitled` (and the dashboard's **Entitled net (x402)** card and
**x402 sales: gross and entitled net** table) report what x402 sales entitle the
artist to. Revenue line: ADR-BM-6 x402 rail; reporting only, no fee, split or
payout change (the artist share stays at least 85%, ADR-BM-4).

- **What it is.** The quoted `netToSeller`: the price minus the platform fee at
  the license's rate (`floor(amount x feeBps / 10000)`, the rounding of the
  quote). It is an **entitlement** ("Entitled — owed to you"), never a
  received figure and never added to the on-chain Net received or to its
  totals: the block has its own totals, assets and sales. Resonate does not
  record a per-sale payout to the artist yet; if one is added later, that fact
  replaces this quote.
- **Recorded at the time of sale.** The rails write the quote with the sale:
  `receipt.payment.quote` on the `X402Settlement` receipt (facilitator route and
  Punchline moment editions) and `quote` in the `x402.purchase` event args of the
  direct rails (agent payment router, MCP `stem.download`), built by
  `quoteEntitledNet` in `x402.quote.ts` with the configured `X402_*_FEE_BPS` of
  the license. A later change of the configured rate never rewrites a past sale.
- **Which sales.** The same x402 sales the gross `commerce.settled` facts count:
  final settlements outside the marketplace contract, for the artist's stems and
  Punchline moments, plus direct agent/MCP purchases (a payment already recorded
  by the HTTP rail is counted once). Contract-backed x402 sales are counted by
  the marketplace rail.
- **Unquoted.** A sale settled before the quote was recorded (or whose record
  does not add up to the gross) is `unquoted`: counted in `unquotedSales` and
  shown as **Not recorded**, with no net. The rate is not reconstructed from
  today's configuration, and it is never shown as zero or as the gross.
- **USD.** Exact only for the stablecoin (as for the gross); other assets are in
  their own units.
- **Tests.** `analytics_entitled_net.spec.ts`,
  `analytics_entitled_net.integration.spec.ts` (real Postgres: all four rails,
  exclusions, windows, artist scoping), the recorded quote asserted in
  `x402.controller.spec.ts`, `payment_router_x402.integration.spec.ts`,
  `mcp.stem.integration.spec.ts` and `punchline-collect-paid.integration.spec.ts`,
  plus the web `artistNetReceived.test.ts` and `ArtistAnalyticsDashboard.test.tsx`.

### Backfilling pending sale splits (#2344)

`backend/src/scripts/backfill_sale_splits.ts` finalises sales still pending after
#2172, with exactly the live path's logic (royalty from the indexed `RoyaltyPaid`
log or proven zero by `royaltyInfo` at the Sold block; fee rate from
`protocolFeeBps()` at the Sold block). A final split is never rewritten, so it
is idempotent, and it writes only the split columns of `StemPurchase`.

```
npm run contracts:backfill-sale-splits -- [--dry-run | --apply] [--limit N] [--before ISO_TIMESTAMP]
node dist/scripts/backfill_sale_splits.js  [same flags]   # built image: npm run contracts:backfill-sale-splits:prod
```

- **Dry run is the default.** It makes the same reads, including the read-only
  chain calls, and writes nothing. `--apply` together with `--dry-run` is
  rejected.
- **Report.** Pending sales examined, would finalise (or finalised), the sales
  that stay pending by reason (`no_log_index`: indexed before the Sold log
  position was kept, never guessed; `royalty_not_indexed`; `stem_nft_unknown`;
  `fee_unreadable` / `royalty_unreadable`: the RPC did not serve the block;
  `split_inconsistent`), failures and the number deferred.
- **Bounded.** `--limit` (default 200) examines the newest pending sales first;
  when more remain the report prints `nextBefore`: pass it as `--before` (inclusive)
  to continue.
- **Needs** the database and the chain RPC the backend already uses, and an RPC
  that serves the sale blocks. Running it on an environment is the deployment
  half, tracked in resonate-iac#321 (this repository documents the procedure
  only).
- **Test.** `backfill_sale_splits.integration.spec.ts` (Anvil: dry run writes
  nothing; finalised splits equal what the chain paid; each pending reason;
  idempotent second run; paging).

- **Tests.** `marketplace_sale_split.integration.spec.ts` (Anvil: recorded split
  and net equal the balances each address gained on-chain; fee pinned to the
  sale block; pending then final when `RoyaltyPaid` arrives; proven-zero royalty;
  batched transaction), `marketplace_sale_split.spec.ts`,
  `analytics_net_received.spec.ts`, `analytics_net_received_dashboard.spec.ts`,
  `artistNetReceived.test.ts` and `ArtistAnalyticsDashboard.test.tsx`. The chain
  fixture is a test-only contract that reproduces `StemMarketplaceV2._buy`'s
  payments and logs (`backend/src/tests/fixtures/SplitMarketplaceHarness.sol`).

The same `GET /analytics/artist/:id/v1?days=N` response now includes an
`actions` array with stable artist action cards:

- `promote_top_track` opens `/player?trackId=<track-id>` when a top track has at
  least five aggregate plays in the selected window.
- `review_marketplace_readiness` opens `/marketplace/manage` when content
  protection data shows marketplace-ready releases.
- `start_listener_community` opens `/artist/:id?tab=community` when aggregate
  playback demand reaches the five-signal floor.
- `prepare_marketplace_catalog` points artists to `/artist/catalog` when no
  marketplace-ready release is visible in the current analytics slice.
- `review_show_city_demand` opens `/shows/:campaignIdOrSlug` when aggregate
  city-demand joins for a Shows campaign meet the five-signal floor.
- `propose_show_city` opens an editable Shows draft prefilled with coarse city
  and release context when qualified listening demand meets both the unique
  audience threshold and the five-signal floor. It uses fixed seven/28-day
  demand windows; thin data says **Not enough listening yet**. See
  [Scene Scout](scene_scout.md) for consent, resonance and source constraints.
- **Unmet demand:** qualified categorical crate and short-session gaps suggest
  publishing a stem or listing a license through the existing release controls.
  Cards require enough distinct requesters and at least five requests; identities
  and request text stay out of the artist response.
- **First-week reception:** after seven catalog days, qualified discovery
  placements can produce aggregate heard, full-play and save totals. Actual
  listening is required; small audiences and subcounts stay suppressed.
- `post_campaign_update` opens `/shows/:campaignIdOrSlug` when aggregate
  supporter update views meet the five-signal floor.
- `create_holder_benefit` opens `/artist/:id?tab=community` when aggregate
  holder-room joins meet the five-signal floor and the selected analytics
  window has no holder-benefit rule creation signal.
- `invite_holder_collectors` opens `/artist/:id?tab=community` when aggregate
  holder-room joins meet the five-signal floor.
- `reward_early_supporters` opens `/artist/:id?tab=community` when aggregate
  supporter role grants, or fallback supporter-room joins, meet the five-signal
  floor.
- `prepare_remix_challenge` opens `/marketplace/manage?status=active` when
  aggregate Remix Studio drafts (`remix.project_created`, attributed to the
  source artist) plus legacy remix creations (`remix.created`) meet the
  five-signal floor. The card is prepare-scoped guidance: the artist reviews
  remix supply (remixable mints, listed remix-tier licenses) before drafting
  a challenge. A true "launch remix challenge" action stays deferred until
  artist remix opt-in settings and a challenge surface exist (remix backlog
  A1, issue #1121).
- `review_remix_supply_pricing` opens `/marketplace/manage?status=active` when
  attributed aggregate remix demand (`remix.project_created` and legacy
  `remix.created` facts — server-attributed only; `remix.cta_*` product events
  carry no artist attribution by design and are excluded) reaches the
  five-signal floor and an artist-owned `marketplace.owner_inventory_viewed`
  snapshot shows no active owner inventory. The card uses the existing owner inventory aggregate only;
  it does not infer supply coverage from missing inventory analytics.
- `triage_fan_questions` opens `/artist/:id?tab=community` when attributed
  `community.message_created` fan-message facts in the artist's rooms meet the
  five-signal floor and no `announcement` or `campaign_update` message signal
  is visible in the selected window. Message bodies, authors, room membership,
  and per-fan drilldowns are excluded.
- `relist_expired_inventory` opens `/marketplace/manage?status=expired` when
  owner-visible marketplace inventory reports expired or cancelled listings
  that can use the existing relist workflow.
- `improve_marketplace_conversion` opens
  `/marketplace/manage?status=active` when aggregate marketplace purchase
  intent meets the five-signal floor but no settled commerce is visible in the
  selected window.
- `review_marketplace_pricing` opens `/marketplace/manage?status=active` when
  attributed aggregate marketplace purchase intent reaches the five-signal
  floor and settled commerce is visible in the selected window.

Each card includes `id`, `type`, `title`, `description`, `reason`, `priority`,
`confidence`, `sourceSignal`, `cta`, and `privacy`. Listener-derived cards use
aggregate counts only and apply a minimum signal threshold before surfacing
counts. Shows, holder-room, remix, community fan-message, and purchase-intent
cards follow the same aggregate floor before counts are surfaced. Marketplace owner-inventory cards
use artist-owned seller workspace summaries and do not expose seller wallet
addresses in the artist analytics DTO. The DTO does not include listener
identities, wallet addresses, raw play history, cohort membership, private room
membership, or per-listener drilldowns.

Action cockpit product analytics are emitted through `POST /analytics/product/event`:

- `artist.action_card_impression`
- `artist.action_card_clicked`
- `marketplace.owner_inventory_viewed`

The payload is intentionally compact: `cardId`, `cardType`, `priority`,
`sourceCategory`, and `disabled` for action-card events; artist-scoped listing
inventory events contain counts such as `activeCount`, `expiredCount`,
`expiringSoonCount`, `relistableCount`, and `totalListings`.

Artist dashboard authorization and default rollups remain manager/owner scoped
through the compatibility `artistId` dimension. Catalog metadata enrichment now
also preserves credited public-artist dimensions for future claim/grant-aware
artist analytics, but those credited dimensions are not yet the dashboard access
boundary.

The AI DJ quality dashboard derives aggregate metrics from bounded
`analytics_facts` windows. It includes only event-level rollups and segment
breakdowns by Session Intent, recommendation strategy, taste-signal source, and
model/materialization version. It explicitly excludes raw listener histories,
actor ids, wallet addresses, and per-user drilldowns.

---

## Technical Reference

### UI Routes & Entry Points
- Page Component: `/artist/analytics` -> `web/src/app/artist/analytics/page.tsx`
- Artist Action Cockpit:
  `web/src/components/analytics/ArtistAnalyticsDashboard.tsx`
- AI DJ Quality Page: `/analytics/agent-quality` ->
  `web/src/app/analytics/agent-quality/page.tsx`
- Layout Wrapper: `web/src/app/artist/analytics/layout.tsx`
- AI DJ Quality Component:
  `web/src/components/analytics/AgentQualityDashboard.tsx`
- Staking Widget: `web/src/components/analytics/StakingOverview.tsx`

### Styling Tokens Applied
- Background surface low: `var(--r-surface-low)` (#11101E)
- Canvas background: `var(--r-canvas)` (#08080F)
- Glowing overlays: `.premium-kpi-card:hover` utilizing `var(--r-primary-glow)` and `var(--r-secondary-glow)`
- Monospace tabular font: `var(--font-mono)` (JetBrains Mono)
- Date pill toggle controllers: `.date-selector-pill-row`

### Unit Tests
- Verification Suite: `web/tests/` (Vitest)
- Command: `npm --prefix web run test:unit`
- Artist action cockpit frontend check:
  `cd web && npx vitest run src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- Focused frontend check:
  `cd web && npx vitest run src/components/analytics/AgentQualityDashboard.test.tsx`
- Focused backend check:
  `cd backend && npx jest --runInBand src/tests/analytics.spec.ts src/tests/analytics.controller.http.spec.ts`

## Remaining P7 Work

Issue [#1121](https://github.com/akoita/resonate/issues/1121) remains the
tracking source for broader artist action recommendations. The deterministic
holder-benefit creation card is implemented as a deep link into the existing
artist community benefit-rule manager; it does not auto-create benefits or
inspect private holder proofs. The deterministic early-supporter reward card is
implemented as a deep link into the same manual benefit-rule/community surface;
it does not auto-send rewards, messages, payouts, or benefits. Deferred slices
now focus on full Remix Studio challenge/contributor workflows, deeper pricing
optimization beyond intent-without-settlement and checkout-intent review,
fan-question triage, and reviewed agent draft actions. Those should keep the
same privacy boundary: artist-owned data or aggregate-only listener/community
signals with explicit thresholds.

### Pledge demand qualification

Scene Scout can include indexer-confirmed, release-linked pledges when the
authenticated backer supplied a user-declared city under the current analytics
consent policy. Optional city context expires after 28 days and never appears
in artist or pledge responses. Refunds, cancellations, current consent and taste
reset controls govern eligibility. The Shows pledge panel offers an optional,
consent-gated city field, and canonical follows (`artist.followed`, see
[Artist follows](artist_follows.md)) now count as demand when they carry a
user-declared city.
See [Scene Scout](scene_scout.md#city-demand) for the full qualification rules.
