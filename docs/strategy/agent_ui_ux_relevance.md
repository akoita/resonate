---
title: "External Agent Application UX"
status: draft
owner: "@akoita"
source_context:
  - docs/features/agent-commerce-runtime.md
  - docs/architecture/mcp_server.md
  - docs/architecture/x402_payments.md
  - docs/architecture/x402_registry_registration.md
  - backend/src/modules/mcp/README.md
  - backend/src/modules/mcp/mcp.service.ts
  - backend/src/modules/mcp/mcp-stem.service.ts
---

# External Agent Application UX

## Summary

For external LLM and agentic applications, "UI/UX" is not mainly a visual
interface. It is the experience an outside agent has when it tries to discover,
understand, pay for, execute, verify, and recover from actions on Resonate.

MCP and x402 are therefore highly relevant. They are not just technical
integrations. They are a product surface that can make Resonate usable by
software agents without a bespoke partnership or a human dashboard session.

The product question is:

> Can an external agent safely understand what Resonate offers, choose the right
> music action, pay when necessary, prove the result, and explain it back to the
> human who sent it?

## Current Foundation

Resonate already has the right first primitives:

- `GET /.well-known/mcp.json` for MCP discovery metadata;
- `POST /mcp` for Streamable HTTP MCP clients;
- `catalog.search(query, limit)` for free catalog discovery;
- `stem.quote(stemId, licenseType)` for free pricing and payment challenge
  discovery;
- `stem.download(stemId, licenseType, paymentProof)` for paid x402-backed stem
  delivery through MCP;
- `GET /.well-known/x402` and `GET /api/stems/:stemId/x402/info` for direct
  x402 discovery;
- `GET /api/stems/:stemId/x402` for accountless paid stem download;
- structured receipts with settlement status, payment asset, proof hash,
  receipt ID, and license information;
- idempotent x402 redemptions by payment proof or smart-account transaction
  hash;
- an explicit deferral posture for public registry validation until a hardened
  public origin exists.

This is enough to prove that Resonate can become an agent-operable music
platform, not only a human-operated app.

## Why This Matters

External agents are a new distribution surface for music actions.

An LLM app, coding assistant, creator tool, wallet assistant, music research
agent, remix workflow, or commerce bot should be able to:

- find public Resonate releases;
- request owner-authorized playback or queue actions when a scoped active
  playback session exists;
- inspect whether a stem is licensable;
- compare license tiers;
- quote a price in stablecoin terms;
- ask the user for payment approval in its own interface;
- submit an x402 proof;
- receive the purchased resource;
- store and cite the receipt;
- tell the user what rights were obtained;
- retry safely when a network or facilitator step fails.

That creates direct value:

| Audience | Outcome |
| --- | --- |
| Listeners | Their preferred agent can discover, buy, and explain Resonate music without forcing them through a new manual workflow. |
| Artists | Their stems and rights become available to a broader market of agentic creator tools, assistants, and automated workflows. |
| Developers | Resonate becomes composable through stable schemas, payment challenges, and receipts instead of private integration work. |
| Resonate | Catalog, licensing, and marketplace activity can grow through protocol-native distribution. |

## The Agent Experience Loop

Design the external agent experience as this loop:

```text
discover -> understand -> quote -> decide -> pay -> execute -> receipt -> recover
```

Each step has a UX equivalent:

| Step | Agent-facing UX question |
| --- | --- |
| Discover | Can the agent find Resonate and know which capabilities exist? |
| Understand | Are tool names, schemas, descriptions, constraints, and examples clear enough to choose the right action? |
| Quote | Can the agent get a dry-run price, rights summary, expiration, and payment requirements before spending? |
| Decide | Can the agent explain cost, rights, and alternatives to its human user? |
| Pay | Can the agent satisfy x402 through a standard wallet/payment flow? |
| Execute | Is the paid action idempotent, bounded, and tied to a specific resource/license? |
| Receipt | Can the agent store a machine-readable and human-readable proof of what happened? |
| Recover | Do errors explain the next valid action instead of only saying the call failed? |

## Product Direction

External agent UX should be treated as a first-class surface beside the web app.
The work is not only adding more MCP tools. It is making each tool easy and safe
for another model or agent runtime to operate.

Recommended principles:

1. **Capability-first discovery.** Publish clear machine-readable capability
   metadata for catalog search, quote, paid download, rights, receipts, and
   future generation/remix actions.
2. **Quote before spend.** Any paid or irreversible operation should have a free
   quote or dry-run shape with price, rights, expiration, and constraints.
3. **Actionable errors.** Errors should use stable codes, include the failed
   field or policy, and describe the next valid tool call when possible.
4. **Receipts as product.** Receipts should be durable, verifiable, easy to
   summarize to humans, and consistent across MCP, direct x402, and browser
   checkout.
5. **Idempotency by default.** Paid operations should be retry-safe and should
   never double-spend because an agent repeated a call.
6. **Versioned contracts.** Tool schemas, receipt schemas, and capability docs
   need explicit versions and compatibility expectations.
7. **Sandbox before registry.** Provide local and testnet examples that let
   external agent developers validate discovery, quote, payment-required, and
   receipt flows before pointing scanners at a public origin.
8. **Rights clarity.** Agent responses should clearly distinguish discovery,
   preview, personal license, remix license, commercial license, ownership, and
   contract-backed entitlement.
9. **Policy visibility.** The agent should know limits such as rate limits,
   license availability, payment asset, settlement network, proof expiration,
   and disabled routes.
10. **Human relayability.** Every response should contain enough plain-language
    context for the calling agent to explain the result to a listener, artist,
    creator, or developer.

## Current Gaps

The current implementation is a strong MVP, but these gaps matter before
external agent integrations become a serious distribution channel:

- `catalog.search` is useful, but external agents need clearer action
  availability: which releases have stems, which stems are licensable, which
  license tiers are active, and which payment route is supported.
- `stem.download` returns `PAYMENT_REQUIRED`, but the broader error vocabulary
  should be standardized across quote, download, unavailable license,
  expired challenge, invalid proof, facilitator failure, settlement failure,
  missing seeded data, and disabled x402.
- The example MCP client currently verifies discovery and search only. It does
  not walk agents through quote, unpaid download challenge, payment-proof
  insertion, or receipt validation.
- Registry validation is correctly deferred, but the roadmap needs a clear
  "public validation window" milestone with seeded purchasable content, rate
  limits, observability, and scanner receipts.
- MCP tool output should become more intent-rich for agent planners: rights
  summary, available next actions, human summary, policy constraints, and
  canonical docs links.
- Agent-facing evaluation is missing. Resonate should test whether common
  agent clients can complete core jobs without custom help.
- Future `generate.track`, remix, campaign, and community tools should not be
  added until their rights, payment, moderation, and abuse boundaries can be
  expressed in the same quote -> execute -> receipt pattern.
- Playback tools need a different trust model from search, quote, and download.
  They should be owner-scoped, device-aware, and confirmation-capable rather
  than accountless public tools. See [Agent-Mediated Playback](agent_mediated_playback.md).

## Recommended Roadmap

| Phase | Outcome |
| --- | --- |
| E1 External Agent Contract Audit | Inventory MCP, x402, OpenAPI, storefront, receipt, and error contracts; document the current agent journey end to end. |
| E2 Capability Metadata Upgrade | Add richer discovery metadata for capabilities, license tiers, payment assets, networks, docs, and examples. |
| E3 Quote And Error UX | Standardize quote, dry-run, policy block, expired challenge, payment-required, verification failed, and settlement failed responses. |
| E4 Receipt Verification UX | Add a simple receipt verification endpoint or documented verifier, plus examples for storing and explaining receipts. |
| E5 Agent Client Examples | Expand examples for Codex, Claude Desktop, Cursor, and a generic TypeScript agent client; include the unpaid and paid paths where safe. |
| E6 Sandbox And Public Validation Window | Seed test content, enable x402 in a hardened environment, run registry/scanner checks, and record receipts without exposing private staging hosts. |
| E7 Agent-Mediated Playback | Add owner-authorized playback intents, queue/control/status contracts, active-client confirmation, and analytics markers before any external agent can start sound. |
| E8 New Agent Tools | Add generation, remix, campaign, or community tools only after quote, policy, consent, and receipt semantics are ready. |

## Success Metrics

Track external agent UX with operational metrics, not vague adoption language:

- time to first successful `catalog.search` from a new MCP client;
- quote success rate;
- unpaid paid-route challenge success rate;
- payment proof verification success rate;
- paid download success rate;
- receipt parse/verification success rate;
- retries that return the same idempotent receipt;
- top stable error codes and recovery paths;
- number of external agent clients validated in smoke tests;
- number of registered public paid resources after the validation window;
- artist revenue attributable to MCP/x402 surfaces.

## Product Rule

Treat MCP, x402, OpenAPI, receipts, examples, and registry metadata as Resonate
product UX. For external agents, these are the interface.

The web app remains the human emotional and creative surface. The protocol
surface should make those same music assets discoverable, payable, licensable,
verifiable, and safe to operate from other agentic applications.
