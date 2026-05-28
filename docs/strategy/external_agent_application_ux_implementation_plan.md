---
title: "External Agent Application UX Implementation Plan"
status: draft
owner: "@akoita"
issue: 1006
source_context:
  - docs/strategy/agent_ui_ux_relevance.md
  - docs/architecture/mcp_server.md
  - docs/architecture/x402_payments.md
  - docs/architecture/x402_registry_registration.md
  - backend/src/modules/mcp/README.md
  - backend/src/modules/mcp/mcp.service.ts
  - backend/src/modules/mcp/mcp-stem.service.ts
  - backend/src/modules/openapi/openapi.service.ts
  - backend/src/modules/storefront/storefront.presenter.ts
---

# External Agent Application UX Implementation Plan

## Goal

Deliver issue #1006 by making Resonate's public machine-facing music commerce
surface predictable for external LLM and agentic applications.

The target agent journey is:

```text
discover -> understand -> quote -> decide -> pay -> execute -> receipt -> recover
```

## Current Contract Audit

| Surface | Current state | Gap for #1006 |
| --- | --- | --- |
| MCP discovery | `GET /.well-known/mcp.json`, `GET /mcp`, and MCP `initialize` expose server info and tool names. | Discovery lists tool names, but not enough capability metadata: tool versions, payment asset, supported license tiers, stable error codes, docs/examples, or receipt semantics. |
| MCP tools | `catalog.search`, `stem.quote`, and `stem.download` exist. | Tool outputs are useful but sparse for planners. They need human summary fields, next-action hints, rights summary, policy constraints, receipt verification hints, and stable recovery guidance. |
| MCP errors | `PAYMENT_REQUIRED`, `QUOTE_FAILED`, and `DOWNLOAD_FAILED` exist in tool output. | Error vocabulary is not standardized enough for agents to recover from disabled x402, missing stem, missing file, unavailable license, invalid proof, facilitator failure, and settlement failure. |
| Storefront discovery | `GET /api/storefront/stems` and `GET /api/storefront/stems/:id` return public stem metadata, license options, quote URL, and purchase URL. | Good foundation. Add explicit agent-facing action availability and docs language so agents can choose between preview, quote, purchase, and later playback/remix paths. |
| x402 info | `GET /api/stems/:stemId/x402/info` returns storefront-grade quote, pricing, rights, payment, purchase, and x402 metadata. | Good free quote/dry-run path. Needs tighter documentation around stable shape, expiration, retry, and receipt linkage. |
| x402 paid download | `GET /api/stems/:stemId/x402` emits 402 challenge and returns receipt headers after payment. | Good protocol path. Acceptance criteria require tested/idempotent documentation and clearer recovery expectations for failed proofs and settlement failure. |
| Receipts | x402 and MCP paid downloads return receipt payloads with receipt ID, settlement status, payment asset, proof hash, and encoded receipt. | Receipt shape is present but needs an agent-facing explanation and verification guide. |
| OpenAPI | `/openapi.json` documents storefront and x402 endpoints, well-known docs, payment info, and receipt headers. | Needs richer external agent metadata: capability versioning, stable error schema, receipt schema, and guidance examples. |
| Registry readiness | `docs/architecture/x402_registry_registration.md` intentionally defers public validation until a hardened public origin exists. | Keep deferral. Add #1006-specific acceptance checklist and make clear that deferred validation is expected, not failure. |
| Example clients | `examples/mcp-client` connects, lists tools, and calls `catalog.search`. | Needs quote, missing-proof/payment-required, receipt parsing, and retry examples. Paid proof insertion can stay documented or fixture-based until a safe validation origin exists. |

## Product Decisions

1. Keep the current public surface narrow: storefront, x402, OpenAPI, and MCP.
   Do not expose `PaymentRouterService` as a generic public command endpoint.
2. Treat MCP and x402 as product UX, not plumbing. Agent-facing responses should
   explain what happened and what to do next.
3. Prefer additive response fields and docs before breaking schema changes.
4. Keep accountless public x402 download separate from owner-scoped playback.
   Playback belongs to #1007.
5. Keep registry validation deferred until a hardened public validation window
   exists with seeded content, rate limits, and observability.

## Implementation Slices

### Slice 1: Contract And Docs Baseline

Purpose: satisfy the audit and planning foundation without changing runtime
behavior.

Changes:

- Add this implementation plan.
- Update MCP and x402 docs with the unified agent journey.
- Document stable error codes and recovery hints.
- Document receipt shape and verification expectations.
- Update the example-client README with planned safe/paid-path flows.

Verification:

- Markdown links resolve.
- Terminology grep does not use speculative roadmap wording.
- No runtime tests required beyond docs checks.

### Slice 2: Capability Metadata

Purpose: make discovery useful before an agent calls tools.

Changes:

- Extend `McpService.getCapabilities()` with:
  - capability schema version;
  - tool versions;
  - supported license tiers;
  - payment protocol and retry headers;
  - x402 network and asset metadata when enabled;
  - docs/example links.
- Extend `buildMcpWellKnownDocument()` with the same high-level metadata.
- Add/update OpenAPI snapshot tests.

Verification:

- `mcp.controller.http.spec.ts`
- `openapi.controller.spec.ts`
- targeted unit tests for x402 public config metadata if needed.

### Slice 3: MCP Tool Response Upgrade

Purpose: let an external agent choose and explain next actions.

Changes:

- Add `summary`, `availableActions`, `rights`, `policy`, and `docs` fields to
  `stem.quote`.
- Add `summary`, `availableActions`, `receiptVerification`, and `docs` fields
  to successful `stem.download`.
- Add `availableActions` and quote/purchase hints to `catalog.search` items
  only if available without expensive per-row lookups. Otherwise document that
  agents should use storefront APIs for stem-level purchase planning.

Verification:

- `catalog.mcp.integration.spec.ts`
- `mcp.stem.integration.spec.ts`
- type/schema coverage from MCP output schemas.

### Slice 4: Stable Error And Recovery Vocabulary

Purpose: make failures actionable.

Recommended stable codes:

| Code | Recovery hint |
| --- | --- |
| `PAYMENT_REQUIRED` | Call `stem.quote`, satisfy the returned x402 challenge, retry `stem.download` with `paymentProof`. |
| `QUOTE_FAILED` | Check `stemId`, `licenseType`, and x402 availability; retry quote after correcting input or server config. |
| `X402_DISABLED` | Do not attempt paid download on this origin; use discovery-only flows or wait for a validation origin. |
| `RESOURCE_NOT_FOUND` | Re-run discovery or use a fresh storefront/stem ID. |
| `RESOURCE_UNAVAILABLE` | The stem exists but is not downloadable through this rail. |
| `LICENSE_UNAVAILABLE` | Choose one of the advertised license tiers. |
| `CHALLENGE_EXPIRED` | Request a fresh `stem.quote`. |
| `PAYMENT_PROOF_INVALID` | Recreate the x402 proof against the current payment requirements. |
| `FACILITATOR_FAILED` | Retry later or surface facilitator/network failure to the human user. |
| `SETTLEMENT_FAILED` | Do not serve the stem; inspect receipt/status and retry only if idempotency permits. |
| `INTERNAL_ERROR` | Retry with backoff and include request/receipt IDs in operator reports. |

Verification:

- MCP missing proof and invalid proof tests.
- x402 controller/http tests for disabled, missing, invalid, and settlement
  failure paths where existing test setup allows.

### Slice 5: Example Client Expansion

Purpose: prove a developer can integrate without bespoke help.

Changes:

- Expand `examples/mcp-client` to run:
  - initialize/tools list;
  - `catalog.search`;
  - optional `stem.quote` when `RESONATE_MCP_STEM_ID` is set;
  - optional `stem.download` missing-proof path to demonstrate
    `PAYMENT_REQUIRED`;
  - fixture/real proof path only when an explicit env var is supplied.
- Add README examples for Codex, Cursor, Claude Desktop, and generic TS client.

Verification:

- `npm --prefix examples/mcp-client run smoke`
- CI can keep paid paths skipped unless configured.

### Slice 6: Registry Validation Window Checklist

Purpose: close acceptance criteria without exposing private staging hosts.

Changes:

- Update `docs/architecture/x402_registry_registration.md` with #1006
  acceptance mapping.
- Add explicit "ready to validate" checklist for public origins.
- Document scanner receipt fields operators must capture.

Verification:

- Docs review only until a public validation window is approved.

## Acceptance Criteria Mapping

| #1006 criterion | Covered by |
| --- | --- |
| External agent contract audit exists | Slice 1 |
| Discovery metadata lists capabilities, versions, docs, payment assets, networks | Slice 2 |
| MCP outputs include enough structured context | Slice 3 |
| Paid flows have free quote/dry-run | Existing x402 info and `stem.quote`, documented in Slice 1 |
| Errors use stable codes plus recovery guidance | Slice 4 |
| Paid download documented and tested as retry-safe/idempotent | Slices 1, 4, 6 plus existing x402 tests |
| Receipt shape documented | Slice 1 |
| Example clients cover discovery, quote, payment-required, receipt parsing, retry | Slice 5 |
| Registry validation remains deferred until hardened public origin | Slice 6 |

## Review Request

Before runtime changes, review this plan and confirm the slice order. The
recommended first implementation PR for #1006 is:

1. Slice 1 docs baseline.
2. Slice 2 metadata.
3. Slice 4 stable errors.
4. Slice 5 example client.

Slice 3 can follow once the stable metadata and error vocabulary are agreed.
