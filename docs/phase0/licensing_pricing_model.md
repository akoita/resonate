---
title: "Phase 0: Licensing & Pricing Model"
status: draft
owner: "@akoita"
---

# Phase 0: Licensing & Pricing Model

## Objectives

- Define rights tiers for usage of stems and remixes.
- Establish pricing inputs and constraints.
- Document payout split policy and edge cases.

## Rights Matrix

| Right | Description | Duration | Transferable | Notes |
| --- | --- | --- | --- | --- |
| Personal Streaming | Listen in-session with agent | Session-based | No | Non-commercial, budget-limited |
| Remix Usage | Generate and play derivative remixes | Session-based | No | Requires attribution in metadata |
| Commercial Usage | Use in monetized content | Fixed term (e.g., 12 months) | Limited | Subject to additional approval |

## Pricing Inputs

- **Base Play Price:** Per-play cost for personal streaming.
- **Remix Surcharge:** Multiplier applied to base play price.
- **Commercial Multiplier:** Multiplier applied for commercial rights.
- **Volume Discount:** Optional per-session discount after N plays.
- **Floor/Ceiling:** Min/max pricing bounds per track.

## Pricing Rules

- Price is denominated in USDC.
- All pricing changes are versioned and take effect immediately for new sessions.
- Discounts cannot reduce below the floor.

## Payout Split Policy

Default split for each paid event:

- **Artist:** 70%
- **Mixer/Remixer:** 20%
- **Platform:** 10%

Split variations:

- If no mixer is involved, artist share increases to 90%.
- Platform share never exceeds 15%.

## Edge Cases

- **Refunds:** If a payment fails, playback is stopped and no rights are granted.
- **Partial Sessions:** If budget depletes mid-session, the agent stops requesting rights.
- **Price Changes Mid-Session:** Session locks pricing at start time to avoid surprises.

## Open Questions

- Do commercial licenses require explicit artist approval?
- Should remix rights be time-bounded vs. perpetual?
- How are disputes handled for split adjustments?
