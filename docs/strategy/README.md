---
title: "Strategy"
status: living
owner: "@akoita"
---

# Strategy

This directory contains cross-feature product strategy and execution planning
for Resonate. These documents connect the feature catalog, RFCs, architecture
docs, roadmap issues, and implementation milestones into a product direction.

## Current Strategy Artifacts

| Document | Purpose |
| --- | --- |
| [Business Model Review 2026-07](business-model-review-2026-07.md) | Full review of the business model against repo state and researched 2024–2026 industry data (streaming economics, distributor/direct-upload landscape, AI-content flood, web3-music track record, stem/beat marketplace comps). Defines the updated positioning, five sequenced revenue lines, payout doctrine, red lines, and phased activation roadmap. |
| [Business Model Phase-0 Decisions](business-model-phase0-decisions.md) | Six ADR-style monetization decisions (ADR-BM-1…6): Shows campaign fee, marketplace take-rate alignment, AI generation credits, payout doctrine & red lines, monetization identity policy, revenue-line sequencing — with ready-to-file issue commands. |
| [Unit Economics Model 2026-07](business-model-unit-economics-2026-07.xlsx) | Editable scenario spreadsheet (Conservative/Base/Ambitious): revenue-line assumptions → platform MRR/ARR, $ routed to artists, and an 18-month activation ramp aligned to the roadmap phases. |
| [Issue Triage 2026-07](issue-triage-2026-07.md) | Verdict for every issue open on 2026-07-04 against the updated vision (core / keep / updated / closed), with the GitHub actions taken. |
| [Next-Generation Music Platform Analysis](next_generation_music_platform_analysis.md) | Synthesizes the product gap between the current Resonate platform and the stronger music-native product direction across listening, artist economics, creation, rights, Shows, and community. |
| [Next-Generation Music Platform Execution Plan](next_generation_music_platform_execution_plan.md) | Converts the analysis into phased execution: player action layer, durable taste memory, community identity, artist rooms, campaign rooms, remix bridge, artist action cockpit, cohorts, and Discord bridge. |
| [External Agent Application UX](agent_ui_ux_relevance.md) | Defines how outside LLM and agentic applications experience Resonate through MCP, x402, OpenAPI, storefront contracts, quotes, errors, receipts, examples, and registry readiness. |
| [External Agent Application UX Implementation Plan](external_agent_application_ux_implementation_plan.md) | Breaks issue #1006 into contract audit, capability metadata, tool output, stable error, example-client, and registry-readiness slices. |
| [Agent-Mediated Playback](agent_mediated_playback.md) | Decides how owner-authorized external agents should request queue/playback actions through scoped playback intents, active-client confirmation, analytics markers, and abuse controls. |

## Related Planning Anchors

- [Feature Catalog](../features/README.md)
- [Application Architecture](../architecture/application_architecture.md)
- [Resonate Specs](../rfc/RESONATE_SPECS.md)
- [Business Model](../rfc/business-model.md)
- [Agent Commerce Runtime](../features/agent-commerce-runtime.md)
- [Agent Platform Refactor RFC](../rfc/agent-platform-refactor.md)
- [External Agent Application Contract](../architecture/external_agent_application_contract.md)
- [Listener Community Network](../features/listener_community_network.md)
- [Listener Community Network Execution Plan](../features/listener_community_network_execution_plan.md)
- [Listener Community Network RFC](../rfc/listener-community-network.md)
- [Listener Community Network Architecture](../architecture/listener_community_network.md)
- [Epic #996: Listener Community Network](https://github.com/akoita/resonate/issues/996)

## Maintenance Rule

Update these strategy artifacts when a new roadmap direction materially changes
how multiple feature areas should fit together. Keep feature-specific current
behavior in `docs/features/`, design rationale in `docs/rfc/`, and service
boundaries in `docs/architecture/`.
