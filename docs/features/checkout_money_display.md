---
title: "One way to show prices and payment methods"
status: implemented
owner: "@akoita"
issue: 2724
---

# One way to show prices and payment methods

Issue [#2724](https://github.com/akoita/resonate/issues/2724). Vision-neutral
quality (ADR-BM-6): presentation only. No price, fee, split or settlement
path changes.

## The rule

Every human-facing checkout shows money the same way:

- **The price comes first, in dollars.** A dollar stablecoin amount reads as
  dollars and cents (`$2.00`, `under $0.01` below a cent). A token that is not
  a dollar stablecoin (an older native-coin listing) still shows its own
  amount, with a rough dollar value where the backend supplies one.
- **The token and network are payment details.** "Paid as 2 USDC on Base"
  and the asset and addresses sit under a folded **Payment details**, never
  in the headline or the button.
- **Payment methods are named for what the buyer gets**, never for the
  protocol: in the stem buy dialog, **Quick checkout** (personal license,
  file right away) and **Standard checkout** (every license, added to your
  library). Both pay from the buyer's Resonate wallet. Agent and developer
  surfaces keep the technical names.

## Where it applies

| Surface | What changed |
| --- | --- |
| Stem buy dialog (`BuyModal`) | Method tabs read Quick checkout / Standard checkout; prices, fees and the Pay button in dollars; token, asset, pay-to and payer under Payment details; plain alerts for older listings and wrong network; the receipt line reads "$0.05, paid as 0.05 USDC". |
| Crate quote | Item prices, artist side, platform fee, totals and the receipt list in dollars; the USDC amount under Payment details. |
| Paid moment collect | Button title and progress labels without the token name. |
| Shows pledge card | The Payment term reads "From your Resonate wallet (USDC on …)"; your last pledge shows in dollars. |
| Wallet page | The balance uses the same dollar format. |

## How it works

`web/src/lib/money.ts` holds the shared helpers: `formatDollars`,
`formatTokenAmountForPeople`, `formatUnitsForPeople`, `isUsdPeggedAsset`,
`isUsdStablecoinSymbol` and `paidAsText`. `crateQuote.formatUsdDecimal` and
`walletPlainWords.formatDollars` delegate to it, and `buyPricing.ts` holds
the method labels.

## How to test

- `web/src/lib/money.test.ts`, `buyPricing.test.ts` (the labels never contain
  "x402", "rail", "on-chain", "USDC" or "wallet transaction").
- `BuyModal.test.tsx`, `CrateQuoteView.test.tsx`, `crateQuote.test.ts`,
  `shows.test.ts`.

## Not in this slice

- One purchases-and-receipts list across card and wallet payments (follow-up).
- Showing euros to EU buyers on wallet-paid surfaces, and card checkout for
  fan purchases: later, when real money is planned.
