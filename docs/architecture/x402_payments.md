# x402 HTTP Payment Layer

Machine-to-machine payment endpoint for AI agents to purchase stems via the [x402 protocol](https://x402.org) (Coinbase open standard) using USDC.

## Overview

x402 enables any HTTP client (AI agent, script, etc.) to purchase stems **without an account** — the payment proof is embedded in the HTTP request headers.

```
Agent                     Resonate Backend              x402 Facilitator
  │ GET /api/stems/:id/x402     │                            │
  │────────────────────────────>│                            │
  │  402 { price, payTo, ... }  │                            │
  │<────────────────────────────│                            │
  │  (pays USDC on Base)        │                            │
  │ GET + X-PAYMENT header      │                            │
  │────────────────────────────>│  POST /verify              │
  │                             │───────────────────────────>│
  │                             │  POST /settle              │
  │                             │───────────────────────────>│
  │  200 (audio/mpeg)           │                            │
  │<────────────────────────────│                            │
```

## Endpoints

| Route                              | Auth         | Purpose                                                 |
| ---------------------------------- | ------------ | ------------------------------------------------------- |
| `GET /api/stems/:stemId/x402`      | x402 payment | Download stem after USDC payment                        |
| `GET /api/stems/:stemId/x402/info` | None         | Free discovery — returns metadata, pricing, x402 config |

## Configuration

| Env var                | Default                        | Description                                   |
| ---------------------- | ------------------------------ | --------------------------------------------- |
| `X402_ENABLED`         | `false`                        | Feature flag                                  |
| `X402_PAYOUT_ADDRESS`  | —                              | Wallet receiving USDC (required when enabled) |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | Payment verify/settle endpoint                |
| `X402_NETWORK`         | `eip155:84532`                 | CAIP-2 chain ID (Base Sepolia)                |

## Module structure

```
backend/src/modules/x402/
├── x402.config.ts       # Env var configuration with validation
├── x402.middleware.ts    # 402 response + facilitator verify/settle
├── x402.controller.ts   # Download + info endpoints
└── x402.module.ts       # NestJS wiring
```

## Dynamic pricing

The middleware resolves price in this order:

1. `StemPricing.basePlayPriceUsd` (direct USD from DB)
2. `StemListing.pricePerUnit` (Wei → estimated USD at $2000/ETH)
3. `$0.02` fallback

## Provenance

x402 purchases are recorded as `ContractEvent` entries with `eventName: 'x402.purchase'`, separate from on-chain `StemPurchase` records (which require a FK to `StemListing`).

## Network

x402 uses USDC on **Base Sepolia** (testnet) / **Base** (mainnet), not Ethereum Sepolia where the marketplace contracts live. This is a separate payment rail — the existing `StemMarketplaceV2.buy()` on-chain flow is unchanged.

## References

- [x402 Protocol](https://x402.org) — open standard by Coinbase
- [x402 Docs](https://docs.x402.org) — seller/buyer quickstarts
- [Coinbase x402 SDK](https://github.com/coinbase/x402) — TypeScript/Python/Go
- [Issue #371](https://github.com/akoita/resonate/issues/371) — tracking issue
