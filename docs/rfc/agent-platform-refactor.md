# RFC: Agent Platform Refactor for Multi-Rail Commerce

## Status

Draft

## Summary

Resonate should redefine its in-app agent from an "AI DJ with payments" into a
policy-bounded audio commerce agent that can discover, evaluate, acquire, and
operationalize licensed audio assets across multiple payment rails.

The AI DJ remains a valid product surface, but it should no longer define the
core architecture. The core loop should be:

1. Understand user goal
2. Retrieve candidate assets and offers
3. Score fit, rights, and cost
4. Select the correct payment rail
5. Acquire rights
6. Trigger post-purchase action
7. Emit receipt, provenance, and evaluation signals

This RFC proposes a slimmer first pass:

- unify agent orchestration behind one runtime entrypoint
- add a payment rail abstraction with AgentCash/x402 and ERC-4337 as first rails
- make evaluation and regression testing first-class
- keep the current DJ UI during the backend refactor

## Why Now

Recent work has made Resonate's machine-first storefront real:

- public discovery and quote surfaces
- x402 / AgentCash-compatible checkout
- receipt-bearing paid responses
- canonical USDC pricing

At the same time, the current agent implementation is split across two
orchestration centers:

- `backend/src/modules/sessions/agent_orchestration.service.ts`
- `backend/src/modules/agents/agent_orchestrator.service.ts`

That split creates three problems:

1. pricing logic is inconsistent with storefront quote logic
2. payment decision logic is embedded in agent flows instead of routed through a
   payment abstraction
3. the in-app agent remains framed as a session/player feature instead of a
   useful asset-acquisition system

## Existing Work Audit

### Reusable

- `x402` and AgentCash-compatible storefront stack
- ERC-4337 wallet and session-key infrastructure
- ADK-based runtime adapter and adapter abstraction
- agent event model and evaluation hooks
- wallet security model and budget controls

### Needs Refactoring

- duplicate orchestration paths between sessions and agents modules
- direct pricing computation in the session agent path
- tight coupling between UI session flow and backend decision flow
- internal/admin runtime endpoints that are not aligned with the app-facing
  product contract

### Current Strategic Direction To Preserve

- machine-first storefront framing in `docs/rfc/RESONATE_SPECS.md`
- account abstraction as one payment rail, not the only rail
- x402 as the default HTTP-native commerce path for agents

## Non-Goals (First Pass)

- introducing LangGraph or a second orchestration framework
- redesigning the DJ frontend before backend unification
- shipping ERC-8004 identity and reputation as a dependency
- introducing multiple named agent classes as first-class product objects
- building a large new service graph before the existing orchestration split is fixed

## Product Definition

The product is one agent loop with different tool allowlists and policy
profiles, not multiple disconnected agent products.

Examples of goals:

- "Find stems under $10 with remix rights"
- "Build a low-cost late-night listening session"
- "Acquire vocals and drums for a house remix"
- "Prefer accountless checkout, fall back to onchain marketplace if needed"

The "AI DJ" becomes one presentation layer for this loop, not the architectural
center.

## Proposed Architecture

### First-Pass Core Services

Keep the initial split intentionally small:

1. `AgentRuntimeService`
2. `PaymentRouterService`
3. `PolicyGuardService`

Additional services should emerge only when pressure is real.

Implementation note (May 2026): the first in-backend slices have landed for
this shape. `SessionsService.agentNext()` calls
`AgentRuntimeService.runCommerce()`, runtime results are normalized before
session response shaping, and `PolicyGuardService` / `PaymentRouterService`
cover pre-execution policy checks plus ERC-4337 marketplace and x402 rail
routing. Standalone runtime extraction remains follow-up work.

### Responsibilities

#### `AgentRuntimeService`

Owns:

- goal execution
- tool invocation
- planner/runtime adapter selection
- orchestration state
- emitting decision and evaluation events

It should replace the current dual center of gravity and become the canonical
entrypoint for any agent workflow.

#### `PaymentRouterService`

Owns:

- payment rail selection
- quote normalization
- purchase execution routing
- receipt normalization

Initial rails:

- `AgentCashX402Rail`
- `Erc4337MarketplaceRail`

#### `PolicyGuardService`

Owns:

- budget enforcement
- allowed license types
- allowed payment rails
- allowed post-purchase actions
- user/account policy checks

This service should gate execution before a purchase is attempted.

## Payment Architecture

The agent must not compute commerce terms first. It should ask the storefront
and commerce layers first.

Canonical flow:

1. search catalog
2. fetch normalized quote
3. let payment router choose rail
4. execute purchase
5. receive normalized receipt

### Payment Rail Interface

Each rail should implement the same shape:

- `quote(input)`
- `authorize(input, policy)`
- `execute(input)`
- `receipt(result)`

### Routing Rules

Initial routing policy:

- prefer `x402` / AgentCash for HTTP-native storefront purchases
- prefer `ERC-4337` for active marketplace listings requiring onchain execution
- reject purchase if no rail satisfies policy constraints

### Normalized Purchase Result

All rails should return the same app-facing envelope:

- `assetId`
- `licenseType`
- `rail`
- `price`
- `receipt`
- `proof`
- `postActionStatus`

## Runtime Strategy

Keep the runtime adapter abstraction. Do not add a second orchestration
framework yet.

Recommended near-term runtime policy:

- keep ADK as the primary runtime
- keep local deterministic fallback
- treat `Vertex` as legacy compatibility
- do not expand `LangGraph` beyond a stub until a specific workflow proves ADK
  insufficient

## Deployment Strategy

### Near Term

Keep the control plane in the NestJS monolith, but separate responsibilities
logically:

- API surface
- agent runtime execution
- payment rail adapters
- evaluation pipeline

### Target Deployment Shape

#### API Service

- storefront
- quote
- receipts
- agent config
- app-facing session endpoints

#### Agent Worker

- runtime execution
- asynchronous planning
- post-purchase actions
- evaluation replay jobs

#### Payment Adapter Layer

- x402 / AgentCash adapter
- ERC-4337 marketplace adapter

This can stay in-process initially, but the interface should assume later extraction.

### Environment Strategy

#### Local

- x402 via local backend
- AgentCash-compatible mainnet/testnet profiles
- local or forked AA setup

#### Staging

- public machine-readable storefront
- sandboxed budgets
- real quote and receipt flows

#### Production

- explicit facilitator/payment-rail config
- audit logging
- replayable evaluation harness
- isolated worker scaling

## Agent Autonomy

Keep autonomy simple in the first RFC.

Supported modes:

- `recommend`
- `auto_purchase_under_budget`

Those modes are enough for the initial product and map directly to user value.

Autonomy is bounded by:

- budget policy
- license policy
- payment-rail policy
- catalog/source policy
- post-purchase action policy

## System Integration

### Backend

Unify these paths behind `AgentRuntimeService`:

- `backend/src/modules/sessions/agent_orchestration.service.ts`
- `backend/src/modules/agents/agent_orchestrator.service.ts`

The session module should become an app-facing shell over the shared runtime,
not a separate decision engine.

### Frontend

Keep the current `/agent` UI for now, but change its backend contract over time:

- start session with a goal + mode
- surface quote/purchase/receipt events
- stop assuming only "DJ session" semantics

No frontend redesign is required in the first pass.

### Event Model

Preserve and extend the existing event bus:

- planning events
- payment routing decisions
- quote retrieval
- purchase attempts
- purchase completion/failure
- receipt issuance
- evaluation outcomes

## Evaluation Harness

This is first-class, not phase four.

Any agent that can spend real USDC needs regression coverage for decision
quality and payment correctness.

### Required Evaluation Capabilities

- replayable session and purchase scenarios
- fixed catalog snapshots
- fixed quote snapshots
- deterministic policy replay
- expected rail selection assertions
- expected budget adherence assertions
- expected rights/license selection assertions

### Core Metrics

- task completion rate
- budget adherence
- wrong-rail selection rate
- quote/purchase mismatch rate
- repeat avoidance for session mode
- purchase latency

## Migration Plan

### Phase A: Runtime Unification

- make `AgentRuntimeService` the canonical entrypoint
- expose the same runtime through a standalone worker process at
  `POST /agent-runtime/execute`, with `AgentRuntimeExecutorService` preserving
  the in-process ADK / Vertex / LangGraph / deterministic fallback path
- move session agent flow behind the shared runtime
- remove direct price computation from session orchestration

### Phase B: Payment Rail Abstraction

- introduce `PaymentRouterService`
- add `AgentCashX402Rail`
- add `Erc4337MarketplaceRail`
- normalize receipts and purchase results

### Phase C: Evaluation Hardening

- add replay fixtures for commerce decisions
- add regression tests for rail selection and budget behavior
- require eval pass before major runtime changes

## Risks

### Over-abstracting Too Early

Mitigation:

- limit the first pass to three core services

### Divergent Pricing Logic

Mitigation:

- agent must consume storefront quote outputs, not local pricing defaults

### Rail-Specific Logic Leaking Back Into Agent Code

Mitigation:

- keep rail logic behind `PaymentRouterService`

### UI Coupling Slowing Refactor

Mitigation:

- keep current DJ UI and change backend contracts first

## Success Criteria

The first pass is successful when:

- there is one canonical orchestration entrypoint
- the agent consumes normalized quotes instead of computing price itself
- AgentCash/x402 and ERC-4337 both work through one payment router
- purchase decisions are covered by replayable evaluations
- the current DJ UI continues to function without a frontend rewrite

## References

- `docs/account-abstraction/account-abstraction.md`
- `docs/account-abstraction/agentic_ai_orchestration.md`
- `docs/architecture/x402_payments.md`
- `docs/rfc/RESONATE_SPECS.md`
- `backend/src/modules/agents/agent_runtime.service.ts`
- `backend/src/modules/agents/agent_orchestrator.service.ts`
- `backend/src/modules/sessions/agent_orchestration.service.ts`
