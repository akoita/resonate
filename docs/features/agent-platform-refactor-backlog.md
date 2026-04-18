# Agent Platform Refactor Backlog

## Goal

Deliver a unified, policy-bounded commerce agent backend that can route
purchases through AgentCash/x402 and ERC-4337 without requiring a frontend
rewrite.

## Workstream A: Runtime Unification

### A1. Make `AgentRuntimeService` the canonical orchestration entrypoint

- remove business ownership ambiguity between sessions and agents modules
- route session-driven agent decisions through the shared runtime

Acceptance:

- session start uses `AgentRuntimeService`
- no direct decision logic remains in `sessions/agent_orchestration.service.ts`

### A2. Collapse duplicated decision logic

- remove direct local pricing defaults from session orchestration
- ensure quote and negotiation data come from shared tools/services

Acceptance:

- session path no longer computes standalone price defaults
- decision outputs match runtime/orchestrator outputs for the same input

### A3. Normalize runtime outputs

- define one runtime result envelope for recommendations and purchases

Acceptance:

- runtime returns a stable structure for picks, quotes, purchases, and receipts

## Workstream B: Payment Rail Abstraction

### B1. Add `PaymentRouterService`

- centralize rail selection
- route by policy and offer type

Acceptance:

- runtime does not directly branch into x402 vs ERC-4337 execution

### B2. Add `AgentCashX402Rail`

- quote via storefront/x402 info surface
- execute x402 purchase
- normalize receipt

Acceptance:

- x402 purchase returns normalized purchase result

### B3. Add `Erc4337MarketplaceRail`

- quote from marketplace/listing context
- execute UserOp purchase
- normalize receipt/proof

Acceptance:

- ERC-4337 purchase returns the same normalized envelope as x402

### B4. Replace agent-side price computation with storefront quote usage

Acceptance:

- agent pricing decisions always use quote/tool outputs, not embedded defaults

## Workstream C: Policy & Evaluation

### C1. Add `PolicyGuardService`

- budget policy
- rail allowlist
- license allowlist
- post-action allowlist

Acceptance:

- purchase attempts are blocked before execution when policy fails

### C2. Add replayable commerce-agent evaluations

- fixed catalog fixtures
- fixed quote fixtures
- rail selection assertions
- budget adherence assertions

Acceptance:

- CI can replay purchase decisions deterministically

### C3. Add regression metrics for commerce decisions

Acceptance:

- evaluation output includes task completion, rail selection, and budget metrics

## Deferred

- frontend redesign of `/agent`
- LangGraph adoption
- ERC-8004 identity/reputation expansion
- multiple named agent product variants
