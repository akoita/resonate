---
title: "Feature Catalog"
status: living
owner: "@akoita"
---

# Feature Catalog

This catalog is the human-readable entry point for implemented, in-progress,
planned, and retired Resonate features. Use it before reading RFCs or scanning
the codebase.

Each durable product or platform capability should have one short feature page
that answers:

- what the feature is for
- who uses it
- current status
- how to use or test it
- main API/UI surfaces
- links to deeper RFC, architecture, issue, and code references

## Status Legend

| Status | Meaning |
| --- | --- |
| `implemented` | Available in the app, API, or platform runtime. |
| `partial` | Available in a limited form; known follow-up work remains. |
| `in-progress` | Active implementation work is underway. |
| `planned` | Designed or prioritized, but not yet available. |
| `retired` | Removed, replaced, or intentionally paused. |

## Implemented And Partial Features

| Feature | Status | Audience | Where To Use/Test | Notes |
| --- | --- | --- | --- | --- |
| [Agent Commerce Runtime](agent-commerce-runtime.md) | `implemented` | listeners, backend developers, agent developers | `/agent` Next AI Pick, `POST /sessions/agent/next`, storefront x402/MCP, `PaymentRouterService` | Runtime-commerce boundary, policy guard, payment-router envelope, scored recommendation explanations, and metadata-derived audio feature seeds are live; external clients use storefront x402/MCP while the router remains a trusted backend boundary. |
| [Stake Visibility Views](stake_visibility_views.md) | `implemented` | artists, listeners | release/stem pages, wallet stake dashboard | Public trust signals and artist stake management. |
| [Playback Session MVP](playback_session_mvp.md) | `draft` | listeners, backend developers | `/sessions/start`, `/sessions/play`, `/sessions/stop` | Earlier session API reference; confirm current behavior before relying on it. |
| [Wallet Funding And Budget Cap](wallet_funding_budget_cap.md) | see page | listeners, developers | wallet and agent budget surfaces | Budget controls used by autonomous agent spend. |
| [Artist Upload Flow MVP](artist_upload_flow_mvp.md) | see page | artists | `/artist/upload` | Upload, processing, metadata, and publish flow. |
| [Catalog Indexing MVP](catalog_indexing_mvp.md) | see page | listeners, agents, developers | catalog/storefront endpoints | Discovery surface for app and machine clients. |
| [Community Curation Disputes](community_curation_disputes.md) | see page | curators, admins, reporters | dispute dashboard | Human curation and dispute workflows. |
| [Payment Splitter Integration](payment_splitter_integration.md) | see page | artists, protocol developers | contracts/backend payment flow | Revenue split and settlement integration. |
| [Analytics Dashboard v0](analytics_dashboard_v0.md) | see page | artists, admins | analytics dashboard | Reporting surface for usage and revenue. |
| [Punchline Drops](punchline_drops_mvp.md) | `planned` | artists, listeners | planned drop/shows surfaces | See also [execution plan](punchline_drops_execution_plan.md). |

## Architecture And Protocol Entry Points

| Area | Start Here |
| --- | --- |
| Agent runtime extraction | [Agent Platform Refactor RFC](../rfc/agent-platform-refactor.md) |
| Runtime worker deployment | [Agent Runtime Worker](../architecture/agent-runtime-worker.md) |
| x402 payments | [x402 Payments](../architecture/x402_payments.md) |
| MCP server | [MCP Server](../architecture/mcp_server.md) |
| Account abstraction | [Account Abstraction](../account-abstraction/account-abstraction.md) |
| Rights and content protection | [Content Protection Architecture](../rfc/content-protection-architecture.md) |
| Deployment environment | [Environment Variables](../deployment/environment.md) |

## Maintenance Rule

When a feature is added, materially changed, exposed to users, hidden, or
removed, update this catalog and the feature's dedicated page in the same PR.
If a feature only exists as an RFC, keep it in the RFC until it becomes a
user-facing or developer-facing capability, then add it here.
