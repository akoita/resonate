---
title: "Phase 0: Requirements & User Stories"
status: draft
owner: "@akoita"
---

# Phase 0: Requirements & User Stories

## Goals

- Define clear MVP requirements aligned with the vision and roadmap.
- Capture user stories for core personas with acceptance criteria.
- Align success metrics for MVP validation.

## MVP Scope (Confirm)

In scope:

- Artist upload with AI stem separation and minting into IP-NFTs.
- Listener sessions with agentic track selection and micro-payments.
- Catalog indexing and basic analytics dashboard.
- Account abstraction wallet with budget cap enforcement.

Out of scope:

- Full DAW-grade remix editor.
- Cross-chain rights transfers.
- Secondary marketplace for stem NFTs.

## Personas

- **Artist:** Uploads stems, sets pricing, and monitors payouts.
- **Listener:** Uses an AI DJ within a fixed budget.
- **Curator:** Stakes on artists and earns from discovery.
- **Partner/Developer:** Integrates catalog/licensing APIs.

## User Stories & Acceptance Criteria

### Artist

1. **Upload a track and receive stem separation results**
   - As an artist, I can upload a track to generate stems automatically.
   - Acceptance:
     - Upload supports common audio formats (wav, mp3, flac).
     - A progress state shows processing status.
     - Stems are stored and linked to a catalog entry.
2. **Set pricing for remix and commercial usage**
   - As an artist, I can set pricing tiers for remix and commercial use.
   - Acceptance:
     - Pricing fields validate numeric input and currency (USDC).
     - Changes are versioned and visible in the catalog.
3. **View transparent payout breakdown**
   - As an artist, I can see payout splits per play/remix.
   - Acceptance:
     - Dashboard shows totals by period and per track.
     - Split percentages and recipients are displayed.

### Listener

1. **Start a session within a monthly budget**
   - As a listener, I can fund a smart wallet and set a monthly budget.
   - Acceptance:
     - Budget cap is enforced during playback.
     - Current spend vs. cap is visible.
2. **Let the AI DJ curate tracks**
   - As a listener, I can set mood and budget preferences for my AI DJ.
   - Acceptance:
     - Preferences are saved for the session.
     - Selected tracks are logged with costs.
3. **Hear seamless transitions**
   - As a listener, I can hear smooth transitions between tracks.
   - Acceptance:
     - Transitions are generated in-session without manual edits.

### Curator

1. **Stake on an emerging artist**
   - As a curator, I can stake stablecoins on a featured artist.
   - Acceptance:
     - Stake amount and lock duration are recorded.
     - Potential yield is displayed with assumptions.
2. **Track discovery performance**
   - As a curator, I can view performance for my staked artists.
   - Acceptance:
     - Metrics include plays, revenue, and yield.
     - Reporting is updated daily.

### Partner/Developer

1. **Integrate catalog and licensing APIs**
   - As a partner, I can access catalog metadata and licensing prices.
   - Acceptance:
     - API returns standardized metadata and pricing.
     - Authentication is required and documented.

## Success Metrics (MVP)

- Time-to-first-track (upload to playable) < 10 minutes.
- 30-day listener retention > 20%.
- % of plays with successful on-chain micro-payments > 95%.
- Artist payout report latency < 24 hours.

## Open Questions

- Which L2 network will be used for MVP testing?
- Target budget defaults for listeners?
- Minimum viable set of analytics for artists?
