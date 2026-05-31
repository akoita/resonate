---
title: "External Agent Application Contract"
status: draft
owner: "@akoita"
issue: 1006
---

# External Agent Application Contract

This document is the implementation-facing contract for outside LLM and
agentic applications that use Resonate without a bespoke integration.

## Supported Public Surfaces

| Surface | Auth | Purpose |
| --- | --- | --- |
| `GET /.well-known/mcp.json` | none | Discover MCP transport, tools, license tiers, x402 metadata, docs, and stable error codes. |
| `GET /mcp` | none | Curl-friendly MCP capability object with the same high-level metadata. |
| `POST /mcp` | none | MCP Streamable HTTP transport for `catalog.search`, `stem.quote`, and `stem.download`. |
| `GET /openapi.json` | none | Machine-readable HTTP contract for catalog, storefront, and x402 endpoints. |
| `GET /api/storefront/stems` | none | Discover purchasable public stems. |
| `GET /api/storefront/stems/:stemId` | none | Inspect public stem metadata, rights, quote URL, purchase URL, and license options. |
| `GET /api/stems/:stemId/x402/info` | none | Free quote/dry-run path before payment. |
| `GET /api/stems/:stemId/x402` | x402 proof | Paid download path after satisfying the x402 challenge. |

`PaymentRouterService` is not a public external-agent endpoint. It remains a
trusted backend boundary for app, session, and worker flows that already know
the user, budget, policy, rail, and proof context.

Owner-authorized playback is intentionally separate from these accountless
public surfaces. The first authenticated playback-intent contract is documented
in [Agent-Mediated Playback Intents](../features/agent_mediated_playback_intents.md)
and uses `/sessions/playback/*` endpoints behind the existing owner JWT guard.
It does not expose a generic public MCP `play_music` tool, does not grant
payment or licensing authority, and does not report `playing` until an active
Resonate client confirms audio execution.

## Recommended Agent Flow

```text
discover -> understand -> quote -> decide -> pay -> execute -> receipt -> recover
```

1. Discover capabilities through `/.well-known/mcp.json`, `/mcp`, or
   `/openapi.json`.
2. Search catalog with `catalog.search` or discover purchasable stems through
   `/api/storefront/stems`.
3. Inspect a concrete stem with `stem.quote` or
   `/api/stems/:stemId/x402/info`.
4. Explain price, rights, payment asset, network, expiration, and alternatives
   to the human user.
5. Satisfy the x402 payment challenge.
6. Retry `stem.download` or `GET /api/stems/:stemId/x402` with the proof.
7. Store the receipt ID, encoded receipt, settlement status, license key, and
   payment asset.
8. On failure, use the stable error code and recovery hint before retrying.

## Capability Metadata

Agent clients should expect discovery metadata to include:

- `capabilitySchemaVersion`;
- `serverInfo`;
- tool details and versions;
- supported license tiers: `personal`, `remix`, `commercial`;
- x402 payment metadata: enabled flag, network, chain ID, facilitator URL,
  retry headers, settlement mode, and asset;
- public endpoints;
- documentation links;
- stable error codes with recovery hints;
- a note that there is no generic public payment-router endpoint.

## MCP Tool Response Context

MCP tool responses are designed for both machine planning and human
explanation:

- `catalog.search` returns a top-level `summary`, release cards, per-release
  `availableActions`, and a storefront action hint. Agents should use storefront
  APIs to choose concrete stem IDs before payment planning.
- `stem.quote` returns a top-level `summary`, `availableActions`, `rights`,
  `policy`, `docs`, quote expiration, price, stem context, and the x402 payment
  challenge.
- successful `stem.download` returns `summary`, `availableActions`,
  `receiptVerification`, `docs`, a full receipt with encoded form, and resource
  metadata alongside the embedded audio resource.

These fields are additive guidance. The durable proof of purchase remains the
receipt returned by a successful paid path.

## Stable Error Codes

MCP tool errors return structured content shaped as
`{ code, message, recovery, context? }`. Payment failures may also include
`reason` and a fresh `challenge` so clients can decide whether to retry,
recreate a proof, or stop and explain the failure to the human user.

| Code | Recovery |
| --- | --- |
| `PAYMENT_REQUIRED` | Call `stem.quote`, satisfy the returned x402 challenge, then retry with `paymentProof`. |
| `QUOTE_FAILED` | Check `stemId`, `licenseType`, and x402 availability. |
| `DOWNLOAD_FAILED` | Retry with backoff if transient and report persistent failures with stem and receipt context. |
| `X402_DISABLED` | Do not attempt paid download on this origin. |
| `RESOURCE_NOT_FOUND` | Re-run discovery or use a fresh storefront/stem ID. |
| `RESOURCE_UNAVAILABLE` | Choose another public storefront item or supported rail. |
| `LICENSE_UNAVAILABLE` | Choose one of the advertised license tiers. |
| `CHALLENGE_EXPIRED` | Request a fresh quote before paying. |
| `PAYMENT_PROOF_INVALID` | Recreate the proof against the current payment requirements. |
| `FACILITATOR_FAILED` | Retry later or surface network/facilitator failure to the human user. |
| `SETTLEMENT_FAILED` | Do not serve the stem; inspect settlement status before retrying. |
| `INTERNAL_ERROR` | Retry with backoff and include request or receipt identifiers in reports. |

## Receipt Expectations

Successful paid paths should provide enough information for machine storage and
human explanation:

- receipt ID;
- encoded receipt payload when available;
- license key;
- stem, track, artist, and release context;
- payment amount and canonical USD amount;
- settlement asset, token address, decimals, and network;
- payment proof hash;
- settlement status;
- contract settlement transaction/event when present;
- resource metadata such as URI, mime type, and byte length.

Agents should store receipts even when they also pass the purchased audio
resource to a local application. Receipts are the durable proof of what was
paid, which license was requested, and whether the settlement created a
contract-backed entitlement or only a download authorization.

## Registry Validation

Public registry validation remains intentionally deferred until an approved
hardened public validation origin exists. A valid validation window requires:

- x402 enabled;
- a funded payout address;
- a Base Sepolia or Base x402 profile;
- seeded public purchasable stems with canonical USDC pricing;
- rate limits and abuse ownership;
- observability for challenge, proof, settlement, and receipt outcomes;
- scanner receipts recorded without publishing private staging URLs.

Until those conditions are met, registry status should be reported as
`Deferred`, not `Failed`.
