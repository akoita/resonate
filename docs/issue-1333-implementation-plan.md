# Issue #1333 — marketplace take-rate 10% / 15% (ADR-BM-2 implementation)

> Plan author: Fable; implementation delegated to Codex (working mode).
> Decision basis: ADR-BM-2 (accepted 2026-07-04) — 10% on marketplace sales,
> 15% on x402 personal micro-purchases. Canonical: `docs/rfc/business-model.md`
> Layer 3.

## Design decisions (settled)

1. **Redeploy, not proxy-migrate.** `StemMarketplaceV2` is non-upgradeable and
   serves no real users yet; ADR-BM-2's "upgrade path" clause is satisfied by
   a coordinated redeploy: new constants → deploy script → handoffs → address
   promotion (staging listings on the old address are acceptable orphans;
   note it in the PR). Record this deviation-from-letter on #1333.
2. **Cap 15%, default 10%.** `MAX_PROTOCOL_FEE` 500 → **1500** (hard cap,
   headroom aligned with the x402 micro tier, mirroring ShowCampaignEscrow's
   cap-above-default pattern). Deploy default **1000 bps** via env
   (`STEM_MARKETPLACE_FEE_BPS`, default 1000; recipient env explicit on remote
   chains — mirror the ShowCampaignEscrow deploy-script pattern exactly).
3. **The 15% micro tier lives at the x402 layer** (config/accounting), not in
   the marketplace contract. In contract-settlement mode the on-chain split
   already applies; facilitator-only settlements get a documented accounting
   note (full x402 artist-payout splitting is out of scope — flag as follow-up
   if not already present).
4. **Honest display.** Buyer modal shows the total; the SELLER surfaces show
   net proceeds ("you receive ≈ X after the 10% platform fee and Y% royalty")
   — derived from on-chain `protocolFeeBps` / quote endpoints, never
   hardcoded.

## Stage A — contract + deploy + test ladder

- `contracts/src/core/StemMarketplaceV2.sol`: `MAX_PROTOCOL_FEE = 1500`
  (update the `// 5%` comment). No other behavior changes.
- Deploy script for the marketplace (find it in `contracts/script/`): add
  `STEM_MARKETPLACE_FEE_BPS` (default 1000) + explicit recipient on remote
  chains, per the ShowCampaignEscrow deploy pattern; update the corresponding
  handoff script/JSON + ABI artifacts under `contracts/deployments/` if the
  convention exists for this contract (follow what's there; do not invent).
- Tests (all four layers exist for this contract per repo standards — extend,
  don't weaken):
  - unit: fee math at 1000 bps (buyer pays price; seller = price − royalty −
    fee; recipient receives fee); setProtocolFee bounds at the new cap
    (1500 ok, 1501 reverts); zero-fee and fee+royalty-stacking cases.
  - fuzz: `testFuzz_SetProtocolFee_InvalidReverts` bound updated;
    conservation property `seller + royalty + fee == totalPrice` across
    fuzzed price/royalty/feeBps ≤ 1500 (royalty cap 25% + fee cap 15% still
    < 100% — assert the combined bound explicitly in a test comment).
  - invariant: if the marketplace invariant suite tracks fee accounting,
    update bounds; keep conservation at full strength.
  - formal: update any `check_buy_paymentsAddUp` style checks to the new cap.
- Gates: `cd contracts && forge build && forge fmt && forge test` ALL green.

## Stage B — backend/web/docs alignment

- x402: reconcile `x402.config.ts` defaults with the canonical Layer 3 table
  (personal $0.05/15%, remix $5/10%, commercial $25/10%) — numbers read from
  config/env, single source; add the facilitator-mode accounting note.
- Payments quote surfaces: wherever the buy modal/quote endpoint exposes
  price breakdown, include feeBps/royalty/net-to-seller fields if absent.
- Web: seller-facing net-proceeds line in listing/manage surfaces; buyer
  modal unchanged unless breakdown fields are trivially displayable.
- Docs: `docs/features/marketplace_listing_lifecycle.md` fee note;
  user guide marketplace article (plain language, derived %); environment.md
  for the new env var.
- Gates: backend lint + focused jest (contracts indexer/listing + payments
  specs); web focused vitest + help test if content changed.

## Out of scope

- x402 facilitator-mode artist-payout splitting (follow-up if absent).
- Production address promotion (goes with #1271 go-live ops).
- Punchline drops / collectibles pricing (inherit the marketplace rate).

## Review protocol

Codex implements per stage; Fable reviews diffs, runs gates (incl. anything
the Codex sandbox can't), commits, PRs. No Codex commits.
