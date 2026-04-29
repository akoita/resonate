# x402 HTTP Payment Layer

Machine-to-machine payment surface for AI agents to discover, quote, pay for, and download stems via the [x402 protocol](https://x402.org) using USDC.

## Overview

x402 enables any HTTP client (AI agent, script, etc.) to purchase stems **without an account** — the payment proof is embedded in the HTTP request headers.

```
Agent                     Resonate Backend              x402 Facilitator
  │ GET /api/storefront/stems   │                            │
  │────────────────────────────>│                            │
  │  public discovery results   │                            │
  │<────────────────────────────│                            │
  │ GET /api/stems/:id/x402/info│                            │
  │────────────────────────────>│                            │
  │  storefront-grade quote     │                            │
  │  + rights + payment info    │                            │
  │<────────────────────────────│                            │
  │ GET /api/stems/:id/x402     │                            │
  │────────────────────────────>│                            │
  │  402 + PAYMENT-REQUIRED     │                            │
  │<────────────────────────────│                            │
  │  (pays USDC on Base)        │                            │
  │ GET + PAYMENT-SIGNATURE     │                            │
  │────────────────────────────>│  POST /verify              │
  │                             │───────────────────────────>│
  │                             │  POST /settle              │
  │                             │───────────────────────────>│
  │  200 + receipt headers      │                            │
  │<────────────────────────────│                            │
```

## Endpoints

| Route                              | Auth         | Purpose                                                 |
| ---------------------------------- | ------------ | ------------------------------------------------------- |
| `GET /api/storefront/stems`        | None         | Public storefront discovery for purchasable stems       |
| `GET /api/storefront/stems/:id`    | None         | Public storefront detail for a specific stem            |
| `GET /api/stems/:stemId/x402`      | x402 payment | Download stem after USDC payment                        |
| `GET /api/stems/:stemId/x402/info` | None         | Free discovery — returns storefront-grade metadata, pricing, rights, and x402 config |
| `POST /mcp`                        | Tool-level x402 for paid downloads | MCP tools for catalog search, stem quotes, and paid stem downloads |

The MCP server reuses the same x402 challenge and proof-verification path for
`stem.quote` and `stem.download`. See [MCP Server](mcp_server.md) for client
configuration and the `/.well-known/mcp.json` discovery document.

## Configuration

| Env var                | Default                        | Description                                                                 |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `X402_ENABLED`         | `false`                        | Feature flag                                                                |
| `X402_PAYOUT_ADDRESS`  | —                              | Wallet receiving USDC (required when enabled)                               |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | Verify/settle endpoint; set explicitly for Base mainnet or any custom facilitator |
| `X402_NETWORK`         | `eip155:84532`                 | CAIP-2 chain ID (`eip155:84532` Base Sepolia, `eip155:8453` Base mainnet)   |

### Recommended local/test profiles

Base Sepolia smoke tests:

```env
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org
X402_ENABLED=true
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_PAYOUT_ADDRESS=<base-sepolia-wallet>
```

Base mainnet AgentCash flow:

```env
X402_ENABLED=true
X402_NETWORK=eip155:8453
X402_FACILITATOR_URL=https://facilitator.payai.network
X402_PAYOUT_ADDRESS=<base-mainnet-wallet>
```

Notes:

- `X402_NETWORK=eip155:8453` now requires an explicit `X402_FACILITATOR_URL`; we do not silently reuse the testnet default on mainnet.
- `https://x402.org/facilitator` is suitable for testnet-style flows, not the validated Base mainnet AgentCash path.
- `X402_NETWORK=eip155:11155111` is not currently a supported staging profile. It would require a Sepolia x402 facilitator and a USDC contract that the facilitator accepts.

## Module structure

```
backend/src/modules/x402/
├── x402.config.ts       # Env var configuration with validation
├── x402.public.ts       # Shared public network / asset metadata helpers
├── x402.middleware.ts   # 402 response + facilitator verify/settle
├── x402.controller.ts   # Download + info endpoints
└── x402.module.ts       # NestJS wiring
```

## Dynamic pricing

Public quote and payment challenge pricing resolve in this order:

1. `StemPricing.basePlayPriceUsd` (direct USD from DB)
2. `$0.05` storefront fallback when no canonical USD price is stored

## Discovery contract

`GET /api/stems/:stemId/x402/info` is intended to be sufficient for machine pre-purchase decision making. The response is storefront-grade and includes:

- Canonical USDC `price` and `priceSummary`
- `licenseOptions` for personal, remix, and commercial access
- `preview`, `rights`, and `asset` metadata for discovery tooling
- `payment`, `purchase`, and `x402` endpoint/protocol metadata for checkout clients
- Optional `alternativeOffers` when an ETH marketplace listing exists, while keeping USDC as the canonical storefront price

## Provenance

x402 purchases are recorded as `ContractEvent` entries with `eventName: 'x402.purchase'`, using the chain ID derived from the configured x402 network. This remains separate from on-chain `StemPurchase` records (which require a FK to `StemListing`).

## Network Strategy

Current x402-compatible USDC settlement is available on **Base Sepolia** (testnet)
or **Base** (mainnet). Ethereum Sepolia can remain useful for ordinary contract
development, but it is not enough for end-to-end x402 unless a facilitator also
supports `eip155:11155111`.

For staging, prefer a single-chain Base Sepolia profile:

- deploy `StemNFT`, `StemMarketplaceV2`, and the Phase 2 protocol contracts to Base Sepolia
- build the frontend with `NEXT_PUBLIC_CHAIN_ID=84532`
- point backend contract/indexer RPC at Base Sepolia
- configure x402 with `X402_NETWORK=eip155:84532`

The older split-chain mode (marketplace contracts on Sepolia, x402 on Base
Sepolia) is technically possible for machine clients, but it creates confusing
wallet balances and smart-account addresses for humans. Keep the human checkout
disabled in that mode until the signer, account deployment, and facilitator
simulation all agree on the same authorization path.

## Headers

Successful paid downloads expose:

- `X-Resonate-License`
- `X-Resonate-Receipt`
- `X-Resonate-Receipt-Id`
- `X-Resonate-Receipt-Content-Type`

Challenge responses expose:

- `PAYMENT-REQUIRED`

The `PAYMENT-REQUIRED` challenge mirrors the runtime x402 requirements and now surfaces a USDC-formatted `displayPrice` so the challenge, discovery quote, and OpenAPI contract stay aligned.

Clients should retry paid requests with:

- `PAYMENT-SIGNATURE`
- `X-PAYMENT` (legacy compatibility)

## References

- [x402 Protocol](https://x402.org) — open standard by Coinbase
- [x402 Docs](https://docs.x402.org) — seller/buyer quickstarts
- [Coinbase x402 SDK](https://github.com/coinbase/x402) — TypeScript/Python/Go
- [Registry submission receipt](x402_registry_registration.md) — x402scan / mppscan validation status
- [Issue #371](https://github.com/akoita/resonate/issues/371) — tracking issue
