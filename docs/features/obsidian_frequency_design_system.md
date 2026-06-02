# Obsidian Frequency Design System

## Status: `implemented`

## Audience
Developers building or extending the Resonate frontend, UX/product collaborators.

## What It Is

The **Obsidian Frequency (v2)** design system is Resonate's canonical visual language for the web frontend. It is built on a deep **Obsidian** canvas and a **Resonance Duotone** identity — two frequencies of light on black, which is literally what "Resonate" means.

The system is fully token-driven using the `--r-*` CSS custom property namespace in `web/src/styles/tokens.css`, aliased back to the older `--ds-*` namespace for backward compatibility. A reviewable polish layer lives in `web/src/styles/identity-refresh.css` (loaded last in `web/src/app/layout.tsx`).

---

## Design Language

### The Resonance Duotone — three roles, one rule

Each colour means exactly one thing, so the UI reads as a vocabulary instead of decoration:

| Role | Token | Value | Meaning — where it appears |
|---|---|---|---|
| **Platform** | `--r-primary` | `#7C5CFF` Hyacinth Violet | Navigation, structure, progress, on-chain/commerce, brand chrome. The default interactive colour. |
| **Sound** | `--r-play` | `#FF6B4A` Coral Ember | The act of listening: the play button, now-playing, "Listen Now", the funding-meter heat, live-event energy. |
| **Agent** | `--r-agent` | `#8B5CF6` Electric Violet | The AI DJ / autonomous context only — the orb, session start, agent accents, smart-wallet/session-key trust signals. A saturated sibling of platform violet. |

Supporting tokens: `--r-secondary` `#C4B5FD` (lavender, secondary text/accents), `--r-tertiary` `#E2DCFF` (silver lavender), `--r-on-play` `#1A0800` (text on coral), plus semantic `--r-success/-warning/-error/-info`. Signature gradients and elevation live in the same file (`--r-grad-brand`, `--r-grad-energy`, `--r-grad-agent`, `--r-elev-*`, `--r-glow-*`).

> Note: `--color-accent-rgb` is intentionally aligned to the platform violet (`124, 92, 255`) so every `rgba(var(--color-accent-rgb), …)` border/glow matches `var(--color-accent)`. Coral is reserved for the dedicated `--r-play*` / `--r-grad-energy` tokens only.

### Typography

- **Display & UI**: System sans via `--ds-font-display`
- **Studio & tabular**: `var(--font-mono)` (JetBrains Mono) — used for all pricing values, durations, track numbers, smart contract addresses, balances, and metrics

### Key Principles

1. **Platform = violet, Sound = coral, Agent = electric violet.** When choosing a colour, ask which of the three a surface belongs to. Playback affordances are coral; everything structural/on-chain is violet; anything driven by the AI DJ/autonomous runtime is electric violet.
2. **Coral is for listening, not for "primary CTA".** Buy/list/pledge are on-chain platform actions → violet. The warm coral is the one gem reserved for sound (play/preview/now-playing) and live-event heat (the Shows pledge CTA + funding meter).
3. **No hardcoded colors** — all values should reference `--r-*` tokens (or their `--ds-*` aliases). Hardcoded hex outside `tokens.css` / `identity-refresh.css` is discouraged.

---

## Where It Applies

| View | Key Elements |
|---|---|
| Global shell | Sidebar (logo mark + violet active state), topbar, player bar (coral play button), canvas aurora + grain, scrollbars, focus rings |
| Home | Hero mesh + glow title, coral "Listen Now", recommendation/catalog cards, filter chips |
| Player console | Compact action chips + lock-chips, flex-grown queue, no-track empty state |
| Library | Onboarding empty state, mono durations, violet "now playing" row |
| Artist page | Cinematic release-art backdrop, real avatar/bio/genres, community rooms with live presence pulses |
| Release detail | Balanced artwork/title hero (responsive clamp), track list, rights panel |
| AI DJ Command Center | Electric-violet orb + agent accents, coral next-pick play, "Start with this" CTA |
| Marketplace / Listing Manager | Status-coloured row accent bars, glanceable stat tiles, coral stem-play |
| Shows | Violet platform (`--color-signal`) with **coral** for live energy — the pledge CTA and the funding meter; immersive gallery lightbox (`CampaignGallery`) |

---

## Source Files

| File | Role |
|---|---|
| `web/src/styles/tokens.css` | All `--r-*` and `--ds-*` design tokens (incl. `--r-play*`, `--r-agent*`, gradients, elevation) |
| `web/src/styles/identity-refresh.css` | Duotone polish layer — chrome, per-page refinements; loaded last in `layout.tsx` |
| `web/src/components/shows/CampaignGallery.tsx` | Immersive gallery lightbox (slideshow + filmstrip) |
| `web/src/app/globals.css` | Base styles: mesh backdrop, sidebar, buttons, app shell |
| `web/src/app/layout.tsx` | JetBrains Mono font import and `--font-mono` variable injection |
| `web/src/styles/home-nextgen.css` | Home page components |
| `web/src/styles/stem-pricing.css` | Stem pricing dashboard |
| `web/src/app/aid-1.css` | AI DJ layout, orb, command bar, cards |
| `web/src/app/aid-2.css` | AI DJ finance, taste, history, shared buttons |
| `docs/ui/design.md` | Full design spec and rationale |

---

## How to Use

### Adding a new button
Use `.ui-btn-primary` for coral CTAs, `.ui-btn-ghost` for secondary:
```css
/* ✅ Correct — inherits from token system */
.my-button { background: var(--r-primary); color: var(--r-on-primary); }

/* ❌ Wrong — never hardcode */
.my-button { background: #FF6B4A; }
```

### Adding an AI-context indicator
Use `var(--r-secondary)` only for agent or autonomous actions:
```css
.ai-badge { background: rgba(139, 92, 246, 0.15); color: var(--r-secondary-soft); }
```

### Tabular data (prices, durations, addresses)
```css
.price-value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

---

## Related Docs
- [Design Specification](../../docs/ui/design.md)
- [`tokens.css`](../../web/src/styles/tokens.css)
