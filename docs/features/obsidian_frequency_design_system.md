# Obsidian Frequency Design System

## Status: `implemented`

## Audience
Developers building or extending the Resonate frontend, UX/product collaborators.

## What It Is

The **Obsidian Frequency (v2)** design system is Resonate's canonical visual language for the web frontend. It replaces the legacy "Stitch" purple palette with a deep cinematic identity built around warm Coral Ember accents, an Obsidian canvas, and Electric Violet reserved exclusively for AI-agent-driven context.

The system is fully token-driven using the `--r-*` CSS custom property namespace in `web/src/styles/tokens.css`, aliased back to the older `--ds-*` namespace for backward compatibility.

---

## Design Language

### Color Roles

| Token | Value | Role |
|---|---|---|
| `--r-canvas` | `#0A0A0F` | Page canvas — deep cinematic black |
| `--r-surface-low` | `#151320` | Card and panel backgrounds |
| `--r-primary` | `#FF6B4A` | **Coral Ember** — primary interactive elements |
| `--r-primary-soft` | `#FF8F6B` | Hover/soft state of primary |
| `--r-secondary` | `#8B5CF6` | **Electric Violet** — AI-agent and autonomous contexts only |
| `--r-tertiary` | `#FFB782` | **Warm Amber** — complementary gradient tail |
| `--r-on-primary` | `#1A0800` | Text on coral surfaces |

### Typography

- **Display & UI**: System sans via `--ds-font-display`
- **Studio & tabular**: `var(--font-mono)` (JetBrains Mono) — used for all pricing values, durations, track numbers, smart contract addresses, and metrics

### Key Principles

1. **Electric Violet is agent-only** — `var(--r-secondary)` and `var(--r-secondary-glow)` should only appear where the AI DJ, agent session keys, smart wallet badges, or recommendation scoring is presented. This visual distinction reserves the color as a trust signal for autonomous actions.
2. **Warm Coral for human actions** — user-initiated CTAs (save, buy, start session, upload) use Coral Ember.
3. **No hardcoded colors** — all values must reference `--r-*` tokens or their `--ds-*` aliases. Hardcoded hex values outside of `tokens.css` are not allowed.

---

## Where It Applies

| View | Key Elements |
|---|---|
| Global shell | Sidebar icon rail (72px → 260px hover), player bar, focus rings |
| Home | Hero mesh, recommendation cards, filter chips, catalog browser |
| Release detail | Track list, stem mixer, status badges, rights panel |
| AI DJ Command Center | Orb, cards, toggle button, transaction list, taste profile |
| Stem Pricing Dashboard | Template cards, range sliders, payout donut, save CTA |
| Shows | Teal-scoped (`shows.css`); isolated — not affected by Obsidian tokens |

---

## Source Files

| File | Role |
|---|---|
| `web/src/styles/tokens.css` | All `--r-*` and `--ds-*` design tokens |
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
