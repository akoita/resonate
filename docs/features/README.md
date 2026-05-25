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
| [Agent Commerce Runtime](agent-commerce-runtime.md) | `implemented` | listeners, backend developers, agent developers | Home "Recommended for You", `/agent` Next AI Pick, marketplace purchase modal, `GET /recommendations/:userId`, `POST /sessions/agent/next`, storefront x402/MCP, `PaymentRouterService`, `AGENT_RECOMMENDATION_STRATEGY=model-assisted`, `npm run eval:recommendations` | Runtime-commerce boundary, policy guard, payment-router envelope, stablecoin-first listener checkout, Home recommendations, deterministic and model-assisted recommendation adapters, scored explanations, versioned metadata-derived feature vectors, and replayable recommendation evals are live; creator listing flows default to configured marketplace stablecoins, marketplace checkout presents x402 and direct on-chain as rails, displays ERC-20/stablecoin listing assets via `paymentToken` including late listing-intent reconciliation, plans ERC-20 direct buys as approval plus marketplace purchase, enforces marketplace listing `licenseType` when quoting/buying, disables unavailable license tiers, disables listed-stem x402 when contract-backed settlement is unavailable, and records idempotent `X402Settlement` receipts with explicit contract-settlement status. External clients use storefront x402/MCP while the router remains a trusted backend boundary. Public registry validation stays deferred until an approved hardened validation or launch origin exists. |
| [Agent Taste Intelligence](agent_taste_intelligence.md) | `partial` | listeners, agents, backend developers, data/ML developers | `AgentSelectorService`, `AgentBigQueryTasteSignalService`, `AGENT_TASTE_SIGNAL_SOURCE=bigquery`, BigQuery `user_track_recommendation_scores`, `workers/analytics-dataflow/sql/agent_taste_intelligence_baseline.sql` | Optional BigQuery-backed user-track taste scores now blend into agent recommendation scoring as an additive, explainable signal. The default deterministic selector remains unchanged when the feature is disabled, BigQuery is unavailable, or no score exists for a candidate. Baseline warehouse materialization SQL and an optional BigQuery ML matrix-factorization template are documented; scheduled execution and offline ML promotion remain follow-up work. |
| [AI Music Generation](ai_music_generation.md) | `implemented` | artists, backend developers, agents | `/create`, `POST /generation/create`, `PATCH /generation/:trackId/publish`, release detail rights cards, `npm run test:integration -- generation.integration.spec.ts` | Lyria-backed prompt generation creates catalog releases with durable generation metadata. Resonate-generated releases record system rights provenance automatically instead of asking artists for manual proof-of-control evidence. AI-work payout policy remains separate follow-up work. |
| [Stake Visibility Views](stake_visibility_views.md) | `implemented` | artists, listeners | release/stem pages, wallet stake dashboard | Public trust signals and artist stake management. |
| [Playback Session MVP](playback_session_mvp.md) | `draft` | listeners, backend developers | `/sessions/start`, `/sessions/play`, `/sessions/stop` | Earlier session API reference; confirm current behavior before relying on it. |
| [Resonate Shows](resonate_shows.md) | `partial` | listeners, artists, promoters | Home campaign hero, `/shows`, `/shows/sennarin-paris`, Shows Prisma models/APIs, ShowCampaignEscrow deployment handoffs, [production plan](resonate_shows_production_plan.md), [trust and escrow RFC](../rfc/show-campaign-trust-escrow.md), `web/tests/shows.spec.ts`, `backend/src/tests/shows_campaign_models.integration.spec.ts`, `backend/src/tests/shows.service.integration.spec.ts` | Fan-funded artist-booking campaigns turn city-level demand into escrow-backed signals. The backend truth layer now has campaign, tier, pledge receipt, trust, authority, release-policy, and lifecycle-event models plus public reads, signals, activation, pledge receipts, cancellation, booking confirmation, and fulfillment confirmation APIs; funding success remains distinct from payout release. |
| [Wallet Funding And Budget Cap](wallet_funding_budget_cap.md) | see page | listeners, developers | wallet and agent budget surfaces | Budget controls used by autonomous agent spend. |
| [Artist Upload Flow MVP](artist_upload_flow_mvp.md) | see page | artists | `/artist/upload` | Upload, processing, metadata, and publish flow. |
| [Catalog Indexing MVP](catalog_indexing_mvp.md) | see page | listeners, agents, developers | Home catalog browser, `/artist/catalog`, release pages, catalog/storefront endpoints | Discovery surface for app and machine clients; public artist discovery is credited-artist based while authenticated managed catalog views remain uploader-profile based. Home release rows can save release tracks to the library or add them to playlists without opening the release page, while `/artist/catalog` provides full managed release and track inventory beyond the home preview. |
| [Mood And Vibe Discovery](mood_vibe_discovery.md) | `in-progress` | listeners, artists, backend developers | Home filter chips and vibe sessions, artist upload mood tags, `GET /recommendations/:userId` | Mood chips now drive recommendation overrides and Home vibe sessions; artist upload can tag releases with moods for catalog and AI DJ matching. |
| [Community Curation Disputes](community_curation_disputes.md) | see page | curators, admins, reporters | dispute dashboard | Human curation and dispute workflows. |
| [Rights Verification Workflow](rights_verification_workflow.md) | `partial` | artists, operators, backend developers, protocol agents | release detail marketplace-rights modal, admin dispute queue, trusted-source APIs, `upload-rights-policy.ts` | Upload routing now distinguishes `unverified_uploader`, `verified_independent`, `trusted_creator`, and `trusted_source_account`; trusted-source requests are visible in the admin queue and approval/revocation feeds route decisions and reassessments. Artist-side trusted-source request management and broader policy analytics remain follow-up work. |
| [Payment Splitter Integration](payment_splitter_integration.md) | see page | artists, protocol developers | contracts/backend payment flow | Revenue split and settlement integration. |
| [Artist Analytics Dashboard](analytics_dashboard.md) | `implemented` | artists, admins, developers | `/artist/analytics`, `GET /analytics/artist/:id/v1`, `ANALYTICS_REPORT_SOURCE=bigquery` | Premium visual reporting dashboard showing responsive SVG play splines, stablecoin payout rollups, content protection route decisions, and EVM staking history. |
| [Analytics Pipeline Observability](analytics_pipeline_observability.md) | `partial` | operators, analytics developers, product analytics owners | `GET /admin/analytics/pipeline/health`, structured logs, warehouse load metrics | Admin health report and structured logs for rejected product analytics, Pub/Sub publish failures, quarantine growth, missing expected identifiers, clean-to-fact coverage, and stale reporting freshness. Managed alert dashboards remain follow-up infrastructure work. |
| [Analytics Consent And Retention Policy](analytics_consent_retention_policy.md) | `partial` | listeners, artists, operators, compliance, developers | analytics settings/export/delete planning, governance jobs, BigQuery retention reviews, yearly summary design | Product and technical policy for analytics consent, user controls, raw/fact/view retention windows, deletion propagation, and Wrapped-style listener/artist summary boundaries. Backend governance jobs exist; user-facing controls and automated warehouse tombstone propagation remain follow-up work. |
| [Analytics Event Ledger](analytics_event_ledger.md) | `partial` | product, artists, operators, agents, backend developers | analytics event RFC, event taxonomy, backend event envelope SDK, Postgres raw event ledger, Pub/Sub event publisher, Dataflow processor, Flex Template publish workflow, BigQuery-backed artist reports, warehouse export/load layers, post-Dataflow report marts | Long-term analytics platform for versioned domain events, pseudonymous facts, governed retention, future reports, exports, audits, agent datasets, listener summaries, and dashboards. Shared event envelope validation, Postgres raw event persistence, disabled-by-default Pub/Sub envelope publishing, Apache Beam/Dataflow Flex Template processing and artifact publishing with immediate stateful event-id dedupe, warehouse/fact/view exports, rights-route dimensions for protection metrics, idempotent JSONL warehouse loading/backfill, BigQuery-backed current artist report reads, API-backed artist dashboard UI, listener/user, artist, marketplace, product, replay, funnel, and coverage marts, pipeline health observability, producer helpers, pseudonymous playback lifecycle instrumentation, first-party product funnel instrumentation for onboarding, wallet/budget, upload, playlist, search, marketplace, and settings flows, upload/catalog EventBus bridge emissions, expanded identity/playlist/commerce/contract/x402/wallet/agent/generation/recommendation/curation domain bridge emissions, expanded domain-family support for existing Resonate events, and governance jobs are implemented. |
| [Desktop App](desktop_app.md) | `partial` | listeners, artists, developers | `desktop/`, `npm run desktop:dev`, `npm --prefix desktop run package:dir`, `Desktop Release Artifacts` workflow | Electron shell reuses the existing web experience with native windowing, external-link handling, save prompts, packaging scripts, and downloadable CI-built artifacts. Signing, notarization, auto-update, and full OS QA remain follow-up work. |
| [Obsidian Frequency Design System](obsidian_frequency_design_system.md) | `implemented` | frontend developers, UX contributors | All web views; `web/src/styles/tokens.css`, `web/src/app/globals.css` | v2 visual language — Coral Ember primary, Electric Violet agent-only accent, Obsidian canvas, JetBrains Mono tabular typography. All values centralized in `--r-*` CSS tokens; backward-compat `--ds-*` aliases maintained. Electric Violet is reserved exclusively for AI-agent context (AI DJ orb, wallet badges, session keys). |
| [Remix Studio](remix_studio.md) | `planned` | listeners, producers, artists, backend developers, agent developers | planned release/stem Remix CTA, `/remix/studio/:projectId`, remix eligibility API, AI remix generation provider, [backlog](remix_studio_backlog.md) | Rights-aware AI-assisted remix workflow inspired by the May 2026 licensed AI-remix market signal. The planned MVP focuses on opt-in stem remixing, remix license validation, durable remix projects, AI draft generation, attribution, and provenance. Voice/likeness covers and off-platform export stay deferred until explicit consent and exportable license terms exist. |
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
| Remix Studio and AI derivatives | [Remix Studio RFC](../rfc/remix-studio.md), [AI Derivative Rights Policy](../rfc/ai-derivative-rights-policy.md) |
| Analytics event ledger | [Analytics Event Taxonomy v1](../architecture/analytics_event_taxonomy_v1.md), [Long-Term Analytics Event Ledger RFC](../rfc/analytics-event-ledger.md), [Analytics Consent And Retention Policy](analytics_consent_retention_policy.md), [Analytics Pipeline Observability](analytics_pipeline_observability.md) |
| Deployment environment | [Environment Variables](../deployment/environment.md) |

## Maintenance Rule

When a feature is added, materially changed, exposed to users, hidden, or
removed, update this catalog and the feature's dedicated page in the same PR.
If a feature only exists as an RFC, keep it in the RFC until it becomes a
user-facing or developer-facing capability, then add it here.
