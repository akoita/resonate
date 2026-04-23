---
name: Resonate — Next-Gen Music Platform
colors:
  surface: "#15121c"
  surface-dim: "#15121c"
  surface-bright: "#3c3743"
  surface-container-lowest: "#100c16"
  surface-container-low: "#1e1a24"
  surface-container: "#221e28"
  surface-container-high: "#2c2833"
  surface-container-highest: "#37333e"
  on-surface: "#e8dfef"
  on-surface-variant: "#cdc2d8"
  inverse-surface: "#e8dfef"
  inverse-on-surface: "#332e3a"
  outline: "#968da1"
  outline-variant: "#4b4455"
  surface-tint: "#d4bbff"
  primary: "#d4bbff"
  on-primary: "#41008b"
  primary-container: "#8a3ffc"
  on-primary-container: "#faf1ff"
  inverse-primary: "#7825ea"
  secondary: "#d4bbff"
  on-secondary: "#3d1a74"
  secondary-container: "#55348c"
  on-secondary-container: "#c6a5ff"
  tertiary: "#ffb782"
  on-tertiary: "#4f2500"
  tertiary-container: "#ad5900"
  on-tertiary-container: "#fff2eb"
  error: "#ffb4ab"
  on-error: "#690005"
  error-container: "#93000a"
  on-error-container: "#ffdad6"
  primary-fixed: "#ebdcff"
  primary-fixed-dim: "#d4bbff"
  on-primary-fixed: "#270058"
  on-primary-fixed-variant: "#5d00c2"
  secondary-fixed: "#ebdcff"
  secondary-fixed-dim: "#d4bbff"
  on-secondary-fixed: "#270058"
  on-secondary-fixed-variant: "#55348c"
  tertiary-fixed: "#ffdcc5"
  tertiary-fixed-dim: "#ffb782"
  on-tertiary-fixed: "#301400"
  on-tertiary-fixed-variant: "#703800"
  background: "#15121c"
  on-background: "#e8dfef"
  surface-variant: "#37333e"
  chrome-glass: rgba(255, 255, 255, 0.04)
  chrome-border: rgba(255, 255, 255, 0.10)
  text-high-contrast: rgba(255, 255, 255, 0.92)
typography:
  display-xl:
    fontFamily: Space Grotesk
    fontSize: 56px
    fontWeight: "700"
    lineHeight: "1.1"
    letterSpacing: -0.02em
  display-md:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: "600"
    lineHeight: "1.2"
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: "400"
    lineHeight: "1.5"
    letterSpacing: "0"
  body-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: "400"
    lineHeight: "1.5"
    letterSpacing: "0"
  kicker:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: "700"
    lineHeight: "1"
    letterSpacing: 0.15em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  stack-xs: 8px
  gutter: 24px
  stack-md: 24px
  margin: 40px
  stack-lg: 48px
---

## Brand & Style

Resonate is a music platform for the agent era — where listeners discover and pay for music through on-chain primitives, artists reach fans everywhere, and a fan-funded booking layer turns passion into live shows. The design system is built to make all of that legible at the same time without any one feature dominating the surface.

The visual language is **Hyper-Fidelity Digital** — the transparency of glassmorphism on top of the structural precision of a Web3 interface. Mesh gradients and blurring evoke the fluid nature of sound; strict geometry and vibrant accents keep the platform tech-forward. The UI reads like a high-end hardware interface reimagined for a digital, AI-driven era — tactile yet ethereal.

Tone: direct, low-ego, confident. Copy is engineering-precise, never marketing-fluffy. Numbers (pledge amounts, stake sizes, contract addresses) are first-class content, rendered with monospace digits. Deep-tech capabilities (stems, smart-contract escrow, AI DJ agents, on-chain identity) appear as **metadata** on content, not as labeled features — the platform _is_ the tech, it doesn't _advertise_ it.

## Colors

A deep-space dark canvas with two chromatic anchors:

- **Primary (purple)** — the platform's core identity and the dominant accent. Used for headlines' kickers, primary CTAs, focus rings, stem highlights, progress bars outside the Shows surface, and any "agentic" / "AI" context (AI DJ, generated mixes, taste profile).
- **Tertiary (amber)** — reserved for **live events and real-time commitment**. Shows campaigns, "Live in 2h" badges, fan-funded pledge progress. The amber must never appear on a non-Shows surface; if it does, the semantic promise breaks.

**Chrome** is a scale of white tints (4 % to 92 % opacity):

- 4–12 % — glass panels, borders, divider lines.
- 64–92 % — primary text, icons, high-contrast interactive states.

Mesh gradients blend primary purple with deep indigo and near-black to create depth behind glass panels. Solid fills are avoided on content surfaces — every panel maintains translucency so album art, generated artwork, and city imagery can bleed through.

**Tokens**: the Stitch palette is the canonical source (`--ds-*` in `web/src/styles/tokens.css`). Legacy `--color-*` tokens are thin aliases of the `--ds-*` equivalents so every surface gets the palette for free without per-component edits.

## Typography

A two-family pairing:

- **Space Grotesk** — geometric, technical, slightly rounded. Display headlines, section titles, kickers, numeric stats, buttons, navigation. Every `h1`..`h4` inherits Space Grotesk app-wide via a single global rule.
- **Be Vietnam Pro** — humanist, warm, highly legible at body sizes. Long-form copy, card descriptions, form labels, tooltips.

**Roles**:

| Role       | Face           | Size | Weight | Tracking | Line-height |
| ---------- | -------------- | ---- | ------ | -------- | ----------- |
| display-xl | Space Grotesk  | 56px | 700    | -0.02em  | 1.1         |
| display-md | Space Grotesk  | 28px | 600    | -0.01em  | 1.2         |
| body-lg    | Be Vietnam Pro | 16px | 400    | 0        | 1.5         |
| body-sm    | Be Vietnam Pro | 14px | 400    | 0        | 1.5         |
| kicker     | Space Grotesk  | 11px | 700    | 0.15em   | 1           |

The **kicker** is a navigational element: always uppercase, wide letter-spacing, placed _above_ section titles to categorize content ("Featured Campaign", "Continue your journey", "Granular breakdowns", "Real-time performance", "AI generated sessions", "Pioneer network"). Color-coded by surface — primary purple for AI/agent contexts, tertiary amber for Shows/live, muted violet for personal/library contexts.

**Numerics**: every stat with a unit (€67,200, 127 backers, 14 days left, BPM 124, 67 %) uses `font-variant-numeric: tabular-nums` so values align vertically in tables and avoid jitter during live updates.

## Layout & Spacing

Desktop uses a 12-column fluid grid with a 1280 px reference, scaling to a 4-column grid below 768 px. Every element aligns to a 4 px baseline grid so waveforms, stem indicators, and on-chain data line up at small sizes.

**Spacing scale**:

| Token           | Value  | Use                                                     |
| --------------- | ------ | ------------------------------------------------------- |
| `--ds-unit`     | 4 px   | Atomic baseline                                         |
| `--ds-stack-xs` | 8 px   | Tight metadata (artist-name under title, BPM under mix) |
| `--ds-gutter`   | 24 px  | Card gutters inside a row                               |
| `--ds-stack-md` | 24 px  | Vertical rhythm between a section header and its grid   |
| `--ds-margin`   | 40 px  | Horizontal gutters of the content column                |
| `--ds-stack-lg` | 48 px+ | Major-section separation                                |

Large margins (40 px+) let the mesh gradients "breathe" around the edges of the central content. Phone viewports drop margins to 16 px; tablets 24 px.

**Home layout contract**: the home page is a row-based hub. Every discovery row follows the same structure — `kicker` + `section-title` + optional "view-all" link, followed by a grid or horizontal scroller. Adding a new feature adds a new row; nothing requires a surface-level redesign.

## Elevation & Depth

Depth is communicated through **glassmorphism**, not traditional drop shadows.

- **Base layer** — `--ds-surface` (#15121c) or a mesh-gradient backdrop.
- **Panel layer** — `.glass-panel` / `.ng-glass`: 4 % white fill + 1 px border at 10 % white + `backdrop-filter: blur(32px) saturate(140%)`. Subtle inner-glow on hover.
- **Floating layer** — 12 % white fill + `backdrop-filter: blur(64px)` for menus, popovers, and modals. Add a subtle primary-tinted outer glow to suggest "energy".

Solid fills are avoided on content surfaces. Every surface should maintain a level of translucency so album art, campaign artwork, or mesh gradients can bleed through — preserving spatial awareness.

Drop shadows are used sparingly and only on the bottom player bar (`0 -10px 50px rgba(138,63,252,0.2)`) to signal its persistent-chrome role.

## Shapes

The shape language is **The Rounded Edge**: 0.5 rem (8 px) default radius — modern without becoming playful.

Shape is semantic; each content type has a signature geometry:

- **Releases** — perfect squares with a 1 px inner stroke. Discover and library grid units.
- **Stems** — rectangles with a waveform-visualization header (height 96 px, 10 colored bars, peak bar glows with the stem's tone color).
- **Campaigns (Shows)** — 16 : 9 widescreen cards. The aspect ratio communicates "cinematic / event" vs "album".
- **Artist pills** — fully pill-shaped (capsule) containers with a 40 px avatar + name; act as a tag for the creator.
- **Agent mixes** — circles with a 4 px violet-tinted ring; evoke a disc, distinguish from square releases.
- **Progress bars** — 8 px-tall rounded capsules with animated gradient sheen on the fill.
- **Interactive badges** — 4 px radius rectangles for status tags ("LIVE IN 2H", "DRUMS", "NEW"). Lower radius = more structured / informative feel.

## Components

### Buttons

- **Primary** — solid `--ds-primary` fill, `--ds-on-primary` text, 14 px border-radius, `translateY(-1px)` on hover, subtle primary-tinted box-shadow for ambient glow. Used for the single hero CTA on a page.
- **Glass (secondary)** — 6 % white fill, 16 % white 1 px border, backdrop-blur 12 px. Used for secondary actions ("View Campaign", "View Stems", "Isolate").
- **Chip (filter)** — pill-shaped, Space Grotesk kicker case, active state takes solid primary fill. Used on the home filter row; genre/mood selection elsewhere.
- **Icon-only** — 40 × 40 px min touch target; download, upload, mixer affordances. Material Symbols Outlined at 16–20 px.

### Cards

| Card          | Surface                             | Aspect                                   | Interaction                                    |
| ------------- | ----------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Release card  | `.ng-play-card`                     | 1 : 1 art + 2-line caption               | Hover reveals a centered `play_circle` overlay |
| Stem card     | `.ng-stem-card`                     | Waveform header + body                   | "Isolate" primary action + icon download       |
| Campaign hero | `.campaign-hero`                    | 21 : 9 with glass-card overlay           | Live countdown + CTA pair + escrow link        |
| Campaign card | `.campaign-card`                    | 16 : 9 art + progress block              | Entire card is a link to `/shows/[id]`         |
| Event card    | `.ng-event-card` (on Shows surface) | 16 : 9 with gradient-up-to-black overlay | "Live in 2h" badge top-left                    |
| Artist pill   | `.ng-artist-pill`                   | Capsule                                  | Click opens `/artist/[id]`                     |
| Agent mix     | `.ng-mix`                           | Circle                                   | Click opens `/agent`                           |

### Persistent chrome

- **Sidebar** — 256 px fixed, `bg-black/20` with 32 px backdrop blur. Nav entries use kicker-case labels. "NEW" pill (amber) marks newly-shipped surfaces.
- **Topbar** — 80 px transparent with blur. Search in the left slot, notifications + user chip on the right.
- **Player bar** — fixed bottom, 96 px tall, 12 % white fill + 64 px backdrop blur + primary-tinted outer glow. Controls use the white-on-dark primary play button + muted side controls.

### Input fields

Minimalist under-lines or 4 % white tint fills; focus state glows with the primary purple (`ring-violet-500/40` equivalent).

### Waveform

A dedicated component for track / stem breakdowns. Transparent background, 1 px border, 10 vertical bars at varying heights (seeded deterministically from the stem id to avoid render jitter). The peak bar glows with the tone color of the stem category:

- `data-tone="primary"` — violet (default synth / electronic).
- `data-tone="tertiary"` — amber (vocals / lead).
- `data-tone="secondary"` — light purple (drums / bass).

### Progress bar (Shows + generation)

8 px-tall capsule; fill uses a gradient sheen animated at 3 s (`shows-progress-sheen`). Above the bar: large display-md raised amount + muted goal. Below the bar: tabular-nums backer count + days-left + threshold.

### Surfaces

- **`.home-ng`** — scopes the home page's design-system classes so they don't leak into surfaces still on the legacy styling.
- **`.shows-surface`** — scopes the amber Shows accent. Applied to `/shows`, `/shows/[id]`, and the home's Active Campaigns / Upcoming Live Events rows. The amber token (`--color-signal`) is an alias of `--ds-tertiary`.
- **`.glass-panel`** — global class for any glass-effect surface across the app. Matches `.ng-glass` by design (same blur / saturate / tint values).

### Iconography

**Material Symbols Outlined** — the full-weight-variable font. Loaded app-wide. Per-surface rules:

- Nav: 20 px.
- Inline text icons: 14–16 px.
- Buttons: 20 px.
- Play-circle overlay on release art: 54 px, `FILL 1`.
- Secondary actions (upload, notifications): 22 px.

Favor icons with metaphoric clarity (`library_music`, `graphic_eq`, `play_arrow`) over abstract glyphs. Legacy inline-SVG icons in the sidebar remain until that chrome is migrated.

### Kicker palette

The kicker color is a subtle navigational cue — readers use it to tell surfaces apart at a glance:

| Kicker color    | Semantic               | Example                 |
| --------------- | ---------------------- | ----------------------- |
| `--ds-primary`  | AI / agent / generated | "AI Generated Sessions" |
| `--ds-tertiary` | Live / real-time       | "Real-time Performance" |
| muted violet    | Personal / continuity  | "Continue your journey" |

## Out-of-scope for this document

- Navigation information architecture (see [docs/ui/ux_research_ia.md](./ux_research_ia.md)).
- Usability test plan (see [docs/ui/usability_test_plan.md](./usability_test_plan.md)).
- Per-page layout specs — each page owns its layout within these tokens.

## Source of truth

- `web/src/styles/tokens.css` — all design-system tokens (`--ds-*`).
- `web/src/styles/home-nextgen.css` — Stitch-aligned component classes (`.ng-*`).
- `web/src/styles/shows.css` — Shows surface amber scoping.
- `web/src/app/globals.css` — base typography, `.glass-panel`, `--studio-*` glass vocabulary.
- This document is the human-readable mirror of those files. If a token value here disagrees with the code, **the code wins** and this file must be updated.
