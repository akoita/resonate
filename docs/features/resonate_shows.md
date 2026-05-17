---
title: "Resonate Shows"
status: partial
owner: "@akoita"
---

# Resonate Shows

## Status

`partial`

The fan-funded Shows wedge is visible in the web app through the home campaign
hero, `/shows`, and `/shows/sennarin-paris`. The current implementation uses
client-side seeded campaign data and links to an existing Sepolia
`RevenueEscrow` contract as an honest stand-in. The production campaign backend,
campaign creation flow, pledge transaction flow, and purpose-built campaign
contract are follow-up work.

## Who It Is For

- Listeners who want to bring an artist to their city.
- Artists and teams who need credible demand before committing tour budget.
- Promoters, venues, and agents who need more than likes or comments before
  holding a date.

## Value

Resonate Shows is one early expression of Resonate's broader thesis: AI,
agent-native interfaces, and blockchain rails should unlock better music
experiences, not just add crypto checkout to a streaming app. In this case, the
new experience is fan coordination with programmable escrow. Other expressions
already include agentic commerce, MCP catalog access, x402 checkout, and
machine-readable receipts. Shows turns soft fandom into an economic booking
signal:

> **Fans bring the show. Artists get a booking signal backed by money, not likes.**

Fans coordinate around an artist, city, deadline, and threshold. Funds are
intended to sit in smart-contract escrow until the campaign clears or fails. If
the campaign clears, the artist has a public, money-backed demand signal for
booking and production planning. If it misses, the refund-first design protects
fans from vague donation risk.

## External Market Evidence

On May 17, 2026,
[NANO-ナノ-OFFICIAL](https://x.com/nanonano_me/status/2055828277185687878)
published a public English-language post to international Japanese music fans
describing why more Japanese artists do not do overseas shows: the cost and risk
of selling enough tickets abroad, especially without major label or agency
support. Public X metadata observed at review time identified the account as a
Tokyo-based musician account with roughly 172k followers, so this is a
directional market signal from a meaningful artist account rather than an
abstract product assumption.

The post maps directly to Shows:

- artists may want to tour but cannot justify losing money;
- overseas fans exist but are hard to aggregate into credible demand;
- follows, comments, streams, and shares help but remain soft signals;
- fans need a concrete action that proves intent before a show is booked.

Treat the follower count as time-sensitive and refresh it before investor, press,
or launch material. The durable insight is the demand-risk problem, not the exact
count.

## How It Works

1. A campaign defines an artist, city, venue target, deadline, funding goal, and
   minimum fan threshold.
2. Fans join through pledge tiers that represent intent.
3. Campaign progress is public: amount raised, percentage funded, backer count,
   days left, and threshold.
4. When the threshold clears, the artist receives a credible booking signal.
5. When the threshold misses, the intended production flow refunds pledges
   automatically.

## Current UI Surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Home campaign hero | implemented | Featured campaign card links into the Shows route. |
| `/shows` | implemented | Campaign explorer with three seeded examples. |
| `/shows/sennarin-paris` | implemented | Detail page with funding progress, signal tiers, and how-it-works copy. |
| Escrow contract link | partial | Links to deployed Sepolia `RevenueEscrow` as a placeholder until campaign-specific escrow ships. |
| Pledge flow | planned | Current UI communicates tiers; wallet transaction path is not live. |
| Campaign backend | planned | `web/src/lib/shows.ts` preserves API-shaped functions for future `/api/campaigns` integration. |

## Verification

- `web/tests/shows.spec.ts` covers the home hero, sidebar Shows nav, `/shows`
  explorer, and `/shows/sennarin-paris` detail page.
- `web/src/lib/shows.ts` defines the current seeded campaign model and the
  planned async shape for a future backend API.
- `web/src/styles/shows.css` scopes the Shows presentation layer.

## Product Notes

Shows should stay focused on demand formation rather than ticketing alone. The
same escrow-backed campaign primitive can later validate:

- tour stops;
- listening parties;
- merch or vinyl drops;
- fan-funded live sessions;
- remix contests;
- city-specific collector rewards.

The strategic wedge is international niche demand: passionate, distributed fan
bases that are visible in social feeds but hard for artists to convert into
production-safe booking decisions.
