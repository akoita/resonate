---
name: "Resonate — Design System v2: Obsidian Frequency"
status: proposed
owner: "@akoita"
revision: "2026-05-20"
colors:
  canvas: "#0A0A0F"
  canvas-warm: "#0D0B12"
  surface-lowest: "#0F0D14"
  surface-low: "#151320"
  surface-mid: "#1A1826"
  surface-high: "#22202E"
  surface-highest: "#2C2A38"
  on-surface: "#E8E0F0"
  on-surface-variant: "#A8A0B8"
  on-surface-muted: "#6E6880"
  outline: "#3A3548"
  outline-variant: "#2A2636"
  primary: "#FF6B4A"
  primary-soft: "#FF8F6B"
  primary-glow: "rgba(255, 107, 74, 0.35)"
  on-primary: "#1A0800"
  primary-container: "#C84A2A"
  secondary: "#8B5CF6"
  secondary-soft: "#A78BFA"
  secondary-glow: "rgba(139, 92, 246, 0.30)"
  on-secondary: "#1A0042"
  tertiary: "#FFB782"
  tertiary-soft: "#FFDCC5"
  on-tertiary: "#4F2500"
  signal: "#5EEAD4"
  signal-soft: "rgba(94, 234, 212, 0.12)"
  signal-glow: "rgba(94, 234, 212, 0.35)"
  error: "#FF6B6B"
  success: "#34D399"
  chrome-glass: "rgba(255, 255, 255, 0.03)"
  chrome-border: "rgba(255, 255, 255, 0.06)"
  chrome-hover: "rgba(255, 255, 255, 0.08)"
  chrome-active: "rgba(255, 255, 255, 0.12)"
typography:
  display-hero:
    fontFamily: "Space Grotesk"
    fontSize: "clamp(40px, 5.5vw, 72px)"
    fontWeight: "800"
    lineHeight: "1.02"
    letterSpacing: "-0.03em"
  display-xl:
    fontFamily: "Space Grotesk"
    fontSize: "48px"
    fontWeight: "700"
    lineHeight: "1.08"
    letterSpacing: "-0.025em"
  display-lg:
    fontFamily: "Space Grotesk"
    fontSize: "32px"
    fontWeight: "700"
    lineHeight: "1.15"
    letterSpacing: "-0.015em"
  display-md:
    fontFamily: "Space Grotesk"
    fontSize: "24px"
    fontWeight: "600"
    lineHeight: "1.2"
    letterSpacing: "-0.01em"
  body-lg:
    fontFamily: "Be Vietnam Pro"
    fontSize: "16px"
    fontWeight: "400"
    lineHeight: "1.6"
    letterSpacing: "0"
  body-md:
    fontFamily: "Be Vietnam Pro"
    fontSize: "14px"
    fontWeight: "400"
    lineHeight: "1.5"
    letterSpacing: "0"
  body-sm:
    fontFamily: "Be Vietnam Pro"
    fontSize: "12px"
    fontWeight: "400"
    lineHeight: "1.4"
    letterSpacing: "0.01em"
  kicker:
    fontFamily: "Space Grotesk"
    fontSize: "10px"
    fontWeight: "700"
    lineHeight: "1"
    letterSpacing: "0.18em"
  mono:
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace"
    fontSize: "13px"
    fontWeight: "400"
    lineHeight: "1.4"
    letterSpacing: "0"
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  hero: "32px"
  full: "9999px"
spacing:
  unit: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
  section: "80px"
---

# Resonate — Design System v2: Obsidian Frequency

> **Status**: Proposed redesign. This document replaces the prior Stitch-era
> design.md and defines a new visual identity for the entire Resonate app.

---

## 1. Design Philosophy

### 1.1 Identity: "Obsidian Frequency"

Resonate is not another Spotify wrapper. It is an **AI-native music studio
and marketplace** where stems, smart-contract escrow, autonomous agents, and
fan-funded campaigns are first-class product surfaces — not feature labels.

The new identity, **Obsidian Frequency**, communicates this through three
visual pillars:

1. **Cinematic Depth** — Deep obsidian-black canvases with layered mesh
   gradients that drift like slow-moving nebulae. Every surface has depth;
   flat cards do not exist. The app feels like looking into an infinite
   recording studio suspended in space.

2. **Ember Warmth** — A warm coral-to-amber primary accent replaces the
   prior cold purple-only palette. Coral (#FF6B4A → #FF8F6B) is the new
   dominant action color — it reads as energy, creativity, and heat. Violet
   (#8B5CF6) shifts to a supporting role for AI/agent contexts. This
   two-accent pairing gives Resonate its own chromatic fingerprint that no
   competitor uses.

3. **Studio Precision** — Grid-aligned typography, tabular numerics,
   monospace contract data, waveform visualizations, and fader-style UI
   elements echo a professional recording console. The interface
   communicates that music production, not just consumption, happens here.

### 1.2 Competitive Differentiation

| Platform     | Signature Look              | Resonate Difference                              |
| ------------ | --------------------------- | ------------------------------------------------ |
| Spotify      | Green + white on dark gray  | Coral ember warmth, glass depth, stem faders      |
| Apple Music  | Pastel gradients, light/dark toggle | Always-dark cinematic canvas, no light mode |
| Tidal        | Teal on black               | Richer layered glass, AI visualizations           |
| Deezer       | Purple gradients            | Dual coral+violet accent system, studio precision |
| SoundCloud   | Orange on white             | Deep-dark premium feel, on-chain metadata         |

### 1.3 Tone & Copy

Direct. Engineering-precise. Never marketing-fluffy.

- Numbers (€67,200 raised, 127 backers, BPM 124, 2.5% fee) are **first-class
  content** rendered in tabular monospace.
- On-chain primitives (stakes, escrow, attestation hashes, token IDs) appear
  as **inline metadata**, not as labeled "blockchain features."
- The AI DJ and agent surfaces feel like **mission control**, not chatbots.

---

## 2. Color System

### 2.1 Canvas & Surfaces

The background is pure obsidian with a subtle blue-violet undertone — warmer
than pure black, cooler than charcoal.

| Token              | Value     | Use                                        |
| ------------------ | --------- | ------------------------------------------ |
| `--r-canvas`       | `#0A0A0F` | Root `<body>` background                   |
| `--r-canvas-warm`  | `#0D0B12` | Alternate canvas with warmer cast           |
| `--r-surface-lowest` | `#0F0D14` | Deepest panel insets                      |
| `--r-surface-low`  | `#151320` | Sidebar, bottom player bar                 |
| `--r-surface-mid`  | `#1A1826` | Standard card/panel backgrounds            |
| `--r-surface-high` | `#22202E` | Hover states, raised interactive elements  |
| `--r-surface-highest` | `#2C2A38` | Modal/dialog backgrounds, active tabs   |

### 2.2 Chrome (Glass) Scale

Glass surfaces use white-tint overlays at precise opacities:

| Opacity | Use                                           |
| ------- | --------------------------------------------- |
| 3%      | Default glass panel fill                      |
| 6%      | Borders, dividers                             |
| 8%      | Hover state fill                              |
| 12%     | Active/pressed state fill, floating panels    |
| 18%     | High-emphasis interactive (selected tab)      |

### 2.3 Accent Colors — the Resonance Duotone (three roles, one rule)

Each colour means exactly one thing, so the UI reads as a vocabulary, not
decoration. "Resonate" = two frequencies of light on obsidian.

```
PLATFORM:  Hyacinth Violet   (--r-primary  #7C5CFF → --r-primary-soft #9880FF)
           The default interactive colour. Navigation, structure, progress,
           on-chain/commerce (buy, list, pledge), brand chrome, active states.

SOUND:     Coral Ember       (--r-play #FF6B4A → --r-play-soft #FF8F6B, grad --r-grad-energy)
           The act of listening ONLY: play/preview buttons, now-playing,
           "Listen Now", and live-event heat (Shows pledge CTA + funding meter).

AGENT:     Electric Violet    (--r-agent #8B5CF6 → --r-agent-soft #A78BFA, grad --r-grad-agent)
           AI/autonomous context only — the AI DJ orb, session start, agent
           accents, smart-wallet/session-key trust signals. A saturated
           sibling of platform violet.

SUPPORT:   Lavender --r-secondary #C4B5FD (secondary text/accents) ·
           Silver Lavender --r-tertiary #E2DCFF
```

> Note: `--color-accent-rgb` is aligned to platform violet (`124, 92, 255`)
> so every `rgba(var(--color-accent-rgb), …)` border/glow matches the violet
> `var(--color-accent)` fill. There is no "teal/signal" accent — Shows uses
> platform violet (`--color-signal` = `#7C5CFF`) with coral for live energy.

### 2.4 Semantic Colors

- **Error**: `#FF6B6B` — warm red that harmonizes with the coral primary.
- **Success**: `#34D399` — emerald green for confirmations, "complete" states.
- **Warning**: `#FBBF24` — gold for attention without alarm.
- **Info**: `#60A5FA` — cool blue for neutral notices.

### 2.5 Accent Rules

> [!IMPORTANT]
> Ask which of the three roles a surface belongs to, then pick the colour:
> - **Platform = violet (`--r-primary`)** is the *default* interactive accent:
>   nav, structure, progress, and on-chain/commerce actions (buy, list, pledge).
> - **Sound = coral (`--r-play`)** is reserved for the *act of listening* —
>   play/preview, now-playing, "Listen Now" — plus live-event heat on Shows
>   (the pledge CTA and the funding meter). Coral is NOT a generic "primary CTA".
> - **Agent = electric violet (`--r-agent`)** is reserved for AI/autonomous
>   context (AI DJ, session keys, smart-wallet trust). It means "autonomous".
> - No teal. Shows is violet platform + coral live energy.

---

## 3. Typography

### 3.1 Font Pairing

| Face               | Role       | Load Strategy                         |
| ------------------ | ---------- | ------------------------------------- |
| **Space Grotesk**  | Display    | `next/font/google`, weights 300–700, `--font-display` |
| **Be Vietnam Pro** | Body       | `next/font/google`, weights 300–600, `--font-body`    |
| **JetBrains Mono** | Monospace  | `next/font/google`, weight 400, `--font-mono`         |

Space Grotesk is geometric but slightly rounded — technical without being
cold. Be Vietnam Pro is humanist and warm at body sizes. JetBrains Mono
renders contract addresses, hashes, and BPM values with fixed-width clarity.

### 3.2 Type Scale

| Role          | Face           | Size                       | Weight | Tracking  | Line-height |
| ------------- | -------------- | -------------------------- | ------ | --------- | ----------- |
| `display-hero`| Space Grotesk  | clamp(40px, 5.5vw, 72px)   | 800    | -0.03em   | 1.02        |
| `display-xl`  | Space Grotesk  | 48px                       | 700    | -0.025em  | 1.08        |
| `display-lg`  | Space Grotesk  | 32px                       | 700    | -0.015em  | 1.15        |
| `display-md`  | Space Grotesk  | 24px                       | 600    | -0.01em   | 1.2         |
| `body-lg`     | Be Vietnam Pro | 16px                       | 400    | 0         | 1.6         |
| `body-md`     | Be Vietnam Pro | 14px                       | 400    | 0         | 1.5         |
| `body-sm`     | Be Vietnam Pro | 12px                       | 400    | 0.01em    | 1.4         |
| `kicker`      | Space Grotesk  | 10px                       | 700    | 0.18em    | 1           |
| `mono`        | JetBrains Mono | 13px                       | 400    | 0         | 1.4         |

> **Fluid scale (canonical):** the UI must not be sized in fixed px tuned for
> one screen — that read oversized on laptops and at 100% on large displays.
> Use the `clamp()`-based tokens in `tokens.css` and reference them, don't
> hardcode px:
>
> | Token | Range | Use |
> |---|---|---|
> | `--r-text-hero` | clamp(1.9rem, 1rem + 2.1vw, 3rem) | hero / display headlines |
> | `--r-text-h2` | clamp(1.35rem, 1.05rem + 0.85vw, 1.75rem) | section titles |
> | `--r-text-h3` | clamp(1.1rem, 0.98rem + 0.4vw, 1.35rem) | card / sub headings |
> | `--r-text-lead` | clamp(0.95rem, 0.88rem + 0.35vw, 1.06rem) | lead paragraphs |
> | `--r-text-body` | clamp(0.9rem, 0.84rem + 0.3vw, 1rem) | body |
>
> Rollout is staged surface-by-surface; new/changed surfaces should adopt these.

### 3.3 Headline Gradient

Hero and display-xl headlines use a CSS gradient fill for visual richness:

```css
.text-gradient-warm {
  background: linear-gradient(
    135deg,
    #ffffff 0%,
    #FFD4C7 45%,
    #FF8F6B 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### 3.4 Numerics

All numeric displays with units (€67,200, 127 backers, 14 days, BPM 124)
use `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum"`.
Financial amounts and contract values render in `--font-mono`.

---

## 4. Layout & Spacing

### 4.1 Grid System

Desktop uses a **fluid 12-column grid** at 1440px max-width, collapsing to
4 columns below 768px. Content aligns to a **4px baseline grid**.

### 4.2 Spacing Tokens

| Token           | Value  | Use                                          |
| --------------- | ------ | -------------------------------------------- |
| `--r-unit`      | 4px    | Atomic baseline                              |
| `--r-xs`        | 8px    | Tight metadata gaps                          |
| `--r-sm`        | 12px   | Interior card padding, chip gaps             |
| `--r-md`        | 16px   | Standard component padding                   |
| `--r-lg`        | 24px   | Card gutters, section header margins         |
| `--r-xl`        | 32px   | Panel padding, major component spacing       |
| `--r-2xl`       | 48px   | Section separation                           |
| `--r-3xl`       | 64px   | Content column horizontal margins            |
| `--r-section`   | 80px   | Major section vertical separation            |

### 4.3 Responsive Breakpoints

| Name     | Width    | Columns | Margin  |
| -------- | -------- | ------- | ------- |
| Phone    | < 640px  | 1       | 16px    |
| Tablet   | 640–1023 | 2       | 24px    |
| Desktop  | 1024–1439| 12      | 48px    |
| Wide     | ≥ 1440   | 12      | 64px    |

---

## 5. Elevation & Depth

### 5.1 The Glass Idiom

Depth is communicated through **translucent glass layers**, not drop shadows.
Every surface maintains translucency so album art, mesh gradients, and
campaign artwork bleed through — preserving spatial awareness.

| Layer       | Fill                          | Blur          | Border                        | Use                          |
| ----------- | ----------------------------- | ------------- | ----------------------------- | ---------------------------- |
| **Canvas**  | `--r-canvas`                  | none          | none                          | Root background              |
| **Panel**   | `rgba(255,255,255, 0.03)`     | `blur(32px) saturate(140%)` | `1px solid rgba(255,255,255, 0.06)` | Cards, sidebar, sections |
| **Raised**  | `rgba(255,255,255, 0.06)`     | `blur(40px) saturate(150%)` | `1px solid rgba(255,255,255, 0.10)` | Hover states, popups     |
| **Floating**| `rgba(255,255,255, 0.10)`     | `blur(64px) saturate(180%)` | `1px solid rgba(255,255,255, 0.14)` | Modals, menus, toasts    |

### 5.2 Mesh Gradient Backdrop

The root canvas uses a slow-drifting mesh gradient that creates ambient
depth without distracting from content:

```css
.mesh-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse at 15% 5%, rgba(255, 107, 74, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 85% 15%, rgba(139, 92, 246, 0.04) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 95%, rgba(255, 183, 130, 0.03) 0%, transparent 40%);
  background-color: var(--r-canvas);
  animation: mesh-drift 30s ease infinite;
}
```

The coral radial in the top-left creates a warm "sunrise" feel that
distinguishes Resonate from every dark-mode competitor's neutral gray.

### 5.3 Glow Effects

Interactive elements emit **ambient glow** in their accent color on hover
and focus. This replaces traditional box-shadows:

```css
/* Primary button hover glow */
.btn-primary:hover {
  box-shadow:
    0 8px 32px rgba(255, 107, 74, 0.30),
    0 0 0 1px rgba(255, 107, 74, 0.15);
}

/* Violet AI-context glow */
.agent-card:hover {
  box-shadow:
    0 8px 32px rgba(139, 92, 246, 0.25),
    0 0 0 1px rgba(139, 92, 246, 0.12);
}
```

---

## 6. Shapes & Geometry

Each content type has a signature geometry that lets users identify it at a
glance without reading labels:

| Content Type      | Shape               | Radius  | Aspect Ratio | Signature Detail                    |
| ----------------- | ------------------- | ------- | ------------ | ----------------------------------- |
| **Release card**  | Rounded square      | 16px    | 1:1 art      | 1px inner stroke, hover play icon   |
| **Stem card**     | Rectangle + header  | 14px    | Auto         | Waveform header (colored bars)      |
| **Campaign card** | Wide rectangle      | 20px    | 16:9 art     | Progress bar, backer count          |
| **Campaign hero** | Full-width banner   | 28px    | 21:9         | Glass overlay card, live dot        |
| **Artist pill**   | Capsule             | 9999px  | Auto         | 40px avatar + name                  |
| **Agent mix**     | Circle              | 50%     | 1:1          | 3px violet ring                     |
| **Filter chip**   | Pill                | 9999px  | Auto         | Active = coral gradient fill        |
| **Status badge**  | Small rectangle     | 6px     | Auto         | Monospace, uppercase kicker         |
| **Button**        | Rounded rectangle   | 14px    | Auto         | Subtle inner-top highlight          |

---

## 7. Components

### 7.1 Buttons

#### Primary (Coral)
```
Background: linear-gradient(135deg, #FF6B4A 0%, #FF8F6B 100%)
Text:       #1A0800
Radius:     14px
Padding:    14px 28px
Shadow:     0 8px 24px rgba(255, 107, 74, 0.25)
Hover:      translateY(-1px), brightness(1.08), shadow intensify
Active:     translateY(0), scale(0.98)
```

Top-edge inner highlight: `inset 0 1px 0 rgba(255, 255, 255, 0.25)` — gives
the button a subtle 3D bevel that reads as premium hardware.

#### Ghost (Glass)
```
Background: rgba(255, 255, 255, 0.06)
Border:     1px solid rgba(255, 255, 255, 0.14)
Text:       #E8E0F0
Blur:       backdrop-filter: blur(12px)
Hover:      background 0.10, border 0.22
```

#### Chip (Filter)
```
Inactive:   rgba(255, 255, 255, 0.04), border rgba(255, 255, 255, 0.08)
Active:     linear-gradient(135deg, #FF6B4A, #FF8F6B), text #1A0800
Font:       Kicker case (10px, 700, 0.18em tracking, uppercase)
Shape:      Pill (border-radius: 9999px)
```

#### Icon Button
```
Size:       40 × 40px (minimum touch target 44px on coarse pointers)
Radius:     12px
Background: rgba(255, 255, 255, 0.04)
Hover:      rgba(255, 107, 74, 0.15), border rgba(255, 107, 74, 0.20)
```

### 7.2 Cards

| Card Type          | Surface Class        | Layout                        | Interaction                          |
| ------------------ | -------------------- | ----------------------------- | ------------------------------------ |
| Release card       | `.r-release-card`    | 1:1 art + 2-line caption     | Hover: centered play overlay, glow   |
| Recommendation card| `.r-rec-card`        | Art + body + score badge      | "Start session" CTA, score ring      |
| Stem row           | `.r-stem-row`        | Icon + title + type badge     | Click opens mixer                    |
| Campaign hero      | `.r-campaign-hero`   | 21:9 banner, glass info card  | CTA pair, live pulse dot             |
| Campaign card      | `.r-campaign-card`   | 16:9 art + progress block     | Full-card link to `/shows/[id]`      |
| Artist pill         | `.r-artist-pill`    | Avatar circle + name          | Click opens `/artist/[id]`           |
| Agent mix          | `.r-agent-mix`       | Circle with violet ring       | Click opens `/agent`                 |

### 7.3 Persistent Chrome

#### Sidebar: Icon Rail + Expandable Drawer

The sidebar uses a **narrow icon rail** (72px) as its default state — not a
wide panel like Spotify. This maximizes content area and feels more like a
professional tool.

```
COLLAPSED (default):
  Width:    72px
  Content:  App logo (small), icon-only nav, user avatar at bottom
  Surface:  rgba(255, 255, 255, 0.02), border-right rgba(255, 255, 255, 0.04)

EXPANDED (hover or pin):
  Width:    260px
  Content:  Logo + "Resonate", icon + label nav, playlist shortcuts, user chip
  Surface:  Same glass, smooth 300ms slide transition
  Trigger:  Hover (auto-collapse on leave) or pin toggle

Active indicator: 3px coral pill on the left edge of the active nav item
```

On mobile: the sidebar becomes a bottom tab bar (5 primary items) with the
rest accessible via a "More" sheet.

#### Topbar

```
Height:     64px
Background: rgba(10, 10, 15, 0.55)
Blur:       backdrop-filter: blur(48px) saturate(140%)
Border:     bottom 1px solid rgba(255, 255, 255, 0.04)
Position:   sticky top: 0

Left:       Breadcrumb / page title
Center:     Global search (expandable, glass input)
Right:      Notification bell, wallet connect button
```

#### Player Bar

The player bar is the most-touched surface in the app. It should feel like a
**physical mixing console** — weighty, tactile, always-present.

```
Height:     88px
Position:   fixed bottom
Background: rgba(15, 13, 20, 0.85)
Blur:       backdrop-filter: blur(64px) saturate(180%)
Border-top: 1px solid rgba(255, 255, 255, 0.06)
Glow:       0 -12px 48px rgba(255, 107, 74, 0.08) (when playing)

Layout:     3-column grid
  Left:     Album art (56px, rounded 10px) + title + artist
  Center:   Transport controls (prev, play/pause, next, shuffle, repeat)
            + progress bar (4px tall, coral fill, hover expands to 8px)
  Right:    Volume slider, stem mixer toggle, queue toggle, fullscreen

Play button: 48px circle, coral gradient fill, white play icon
             Hover: scale(1.08), glow pulse
```

### 7.4 Input Fields

```
Background: rgba(0, 0, 0, 0.25)
Border:     1px solid rgba(255, 255, 255, 0.08)
Radius:     12px
Padding:    12px 16px
Font:       body-md
Focus:      border-color var(--r-secondary), box-shadow 0 0 0 3px rgba(139, 92, 246, 0.20)
```

### 7.5 Waveform Visualization

Each stem type has a signature color for its waveform bars:

| Stem     | Color                   | Hue  |
| -------- | ----------------------- | ---- |
| Vocals   | `#FF6B4A` (coral)       | Warm |
| Drums    | `#8B5CF6` (violet)      | Cool |
| Bass     | `#34D399` (emerald)     | Cool |
| Guitar   | `#FBBF24` (gold)        | Warm |
| Piano    | `#60A5FA` (blue)        | Cool |
| Other    | `#A78BFA` (light violet)| Cool |

Bars: 10 vertical bars per stem, heights seeded deterministically from stem
ID. Peak bar glows with the stem's assigned color. On hover, bars animate
a subtle upward pulse.

### 7.6 Progress Bars

```
Track:  height 4px, rounded 9999px, fill rgba(255,255,255, 0.06)
Fill:   coral gradient with animated sheen (3s cycle)
Hover:  track expands to 8px, fill brightens
Thumb:  hidden by default, appears on hover as 14px coral circle
```

### 7.7 Kicker Palette

The kicker color is a navigational cue — readers use it to tell surfaces
apart at a glance:

| Kicker Color           | Semantic                | Example                    |
| ---------------------- | ----------------------- | -------------------------- |
| `--r-primary` (coral)  | Featured / promoted     | "Featured Campaign"        |
| `--r-secondary` (violet) | AI / agent / generated | "Personalized Picks"     |
| `--r-tertiary` (amber) | Personal / continuity   | "Release Queue"            |
| `--r-signal` (teal)    | Live / real-time / Shows| "Active Campaigns"         |
| `--r-on-surface-muted` | Neutral / informational | "Global Catalog"           |

---

## 8. Page Layouts

### 8.1 Home Page

The home page is the catalog discovery hub. It is a **vertically-scrolling
feed of discovery rows**, each following the same `kicker → title → grid`
structure.

**Sections (top to bottom):**

1. **Hero Banner** — 21:9 aspect ratio, cinematic mesh gradient background
   with floating concentric ring motif. Glass info card overlaid with
   featured campaign or release. Two CTAs: coral primary + glass ghost.
   Live pulse dot before the kicker.

2. **Filter Chips** — Horizontal scrollable row of pill-shaped genre/mood
   filters. Active chip takes coral gradient fill. Tapping a non-"All"
   chip surfaces a "Vibe Session" strip with a "Start Vibe Session" CTA.

3. **Recommended For You** — 4-card horizontal grid (only shown when
   authenticated). Each card: album art, title, artist, match score badge
   (circular ring fill), explanation signals, "Start session" action. Cards
   use panel-layer glass with coral-tinted hover glow.

4. **Browse Everything** — Full-width glass panel containing:
   - Search bar (glass input with icon)
   - Stat counters (Releases / Artists / Stems)
   - Segmented tab control (releases / artists / stems)
   - Content grid/list below

5. **Upload Operations** — Two-column glass panel grid:
   - Left: Managed Catalog (artist rows, upload link)
   - Right: Your Releases (recent uploads with status pills)

6. **Upcoming Shows** — Campaign cards in 3-column grid with teal accent
   (`.shows-surface` scoping). Only visible when campaigns exist.

7. **AI DJ Presets** — Intent-led session cards ("Focus Flow", "Hype Mix",
   etc.) with mood-colored borders.

8. **Top Artists** — Horizontal scrollable pill row.

### 8.2 Release Detail Page

```
┌─────────────────────────────────────────┐
│ ← Back to Browse                        │
├─────────────────────────────────────────┤
│ ┌──────────┐                            │
│ │          │  Album Title (display-xl)   │
│ │  280×280 │  Artist Name (link)         │
│ │  Artwork │  Genre · Year · Tracks      │
│ │          │                             │
│ │          │  [▶ Play All] [Buy Stems]   │
│ └──────────┘  ✓ Rights Verified          │
├─────────────────────────────────────────┤
│ TRACK LIST                              │
│ ┌─ # │ Title          │ Status │ Stems ┐│
│ │ 1  │ Track One      │ ●      │ 6/6   ││
│ │ 2  │ Track Two      │ ◐      │ 3/6   ││
│ └────┴────────────────┴────────┴───────┘│
├─────────────────────────────────────────┤
│ STEM MIXER (expandable per track)       │
│ [VOC] [DRM] [BAS] [GTR] [PNO] [OTH]    │
│  ║     ║     ║     ║     ║     ║        │
│  ║     ║     ║     ║     ║     ║        │ ← vertical faders
│  M S   M S   M S   M S   M S   M S     │ ← mute/solo
│                                         │
│ [List on Marketplace ►]                 │
├─────────────────────────────────────────┤
│ STAKE & RIGHTS                          │
│ Glass card: stake amount, escrow status │
└─────────────────────────────────────────┘
```

### 8.3 AI DJ Page

```
┌─────────────────────────────────────────┐
│ AMBIENT HEADER                          │
│ Pulsing concentric rings visualization  │
│ "Your AI DJ" (display-xl, centered)     │
│ Session status indicator                │
├──────────────────┬──────────────────────┤
│ NEXT AI PICK     │ DJ CONFIGURATION     │
│ (60% width)      │ (40% width)          │
│                  │                      │
│ Album art        │ Agent name input     │
│ Track + Artist   │ Vibe chips           │
│ License badge    │ Budget slider        │
│ Price (USD/USDC) │ Mode toggle          │
│ Score ring (72)  │ [Start Session]      │
│ Explanations     │                      │
│ [Buy] [Skip]     ├──────────────────────┤
│                  │ WALLET & BUDGET      │
├──────────────────┤ Balance display      │
│ SESSION HISTORY  │ Spend progress       │
│ Timeline feed    │ Recent transactions  │
│ of past picks    │                      │
└──────────────────┴──────────────────────┘
```

The ambient header uses a living particle visualization (concentric rings
with slow rotation + pulse) rendered in coral and violet gradients. This
communicates "the AI is active and thinking."

### 8.4 Shows Page

The Shows surface is scoped with `.shows-surface` which overrides the coral
accent with **signal teal** (#5EEAD4). This color shift is the primary
visual cue that the user has entered the live/campaign domain.

- Campaign hero: 21:9 banner with teal mesh gradient, glass info card
- Campaign grid: 3-column card layout with teal-tinted progress bars
- Detail page: signal cards (backers, raised, days left, threshold),
  brief + pledge panel, artist audio preview

### 8.5 Marketplace

Glass grid of stem listings with:
- Stem artwork (from parent release)
- Stem type badge (colored by waveform palette)
- License type pill (personal / remix / commercial)
- Price in USD + USDC equivalent
- "Buy" CTA (coral) + "Preview" (ghost)
- Staking/escrow status indicator

### 8.6 Library

Two-panel layout: left panel is a vertical playlist/folder list; right panel
is the track grid/list. Uses the same glass card treatment as the rest of the
app. Drag-and-drop reordering with subtle ghost animation.

---

## 9. Motion & Animation

### 9.1 Principles

- **Purposeful**: Animations communicate state change, not decoration.
- **Quick**: Most transitions complete in 200–300ms.
- **Easing**: `cubic-bezier(0.2, 0.8, 0.2, 1)` for entrances (overshoot),
  `cubic-bezier(0.4, 0, 0.2, 1)` for exits (decelerate).

### 9.2 Standard Animations

| Animation         | Duration | Easing                          | Use                          |
| ----------------- | -------- | ------------------------------- | ---------------------------- |
| `fade-in-up`      | 600ms    | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Page sections on scroll    |
| `card-hover`      | 200ms    | ease-out                        | Card lift + glow             |
| `mesh-drift`      | 30s      | ease                            | Background mesh movement     |
| `hero-motif-spin` | 28s      | linear                          | Hero ring rotation           |
| `hero-ping`       | 3.4s     | ease-out                        | Hero center ring pulse       |
| `progress-sheen`  | 3s       | ease-in-out                     | Progress bar gradient shift  |
| `dot-pulse`       | 2.2s     | ease-out                        | Live indicator pulse         |
| `shimmer`         | 2s       | linear                          | Skeleton loading states      |

### 9.3 Reduced Motion

All animations respect `prefers-reduced-motion: reduce`. When active:
- Mesh drift, ring rotation, and ping are disabled
- Fade-in-up becomes instant opacity transition
- Hover transforms are removed; only color changes remain

---

## 10. Accessibility

- **Contrast**: All text meets WCAG 2.1 AA (4.5:1 for body, 3:1 for large
  text) against the darkest surface.
- **Focus rings**: Violet outline (`box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.35)`)
  on all interactive elements.
- **Touch targets**: 44px minimum on `pointer: coarse` devices.
- **Semantic HTML**: `<nav>`, `<main>`, `<section>`, `<article>`, `role` attributes.
- **Screen reader**: All icon-only buttons have `aria-label`.
- **Color-blind safe**: The coral/violet/teal triple is distinguishable
  across all common color vision deficiencies (verified with Sim Daltonism).

---

## 11. Iconography

**Material Symbols Outlined** — full weight-variable font, loaded app-wide.

| Context         | Size   | Weight | Fill |
| --------------- | ------ | ------ | ---- |
| Sidebar nav     | 22px   | 400    | 0    |
| Inline text     | 16px   | 400    | 0    |
| Buttons         | 20px   | 400    | 0    |
| Play overlay    | 48px   | 400    | 1    |
| Transport       | 24px   | 400    | 1    |

Favor icons with metaphoric clarity (`library_music`, `graphic_eq`,
`play_arrow`, `equalizer`) over abstract glyphs. The sidebar icon rail
uses slightly larger icons (22px) for clarity at the collapsed width.

---

## 12. Migration Notes

### From v1 (Stitch era) to v2 (Obsidian Frequency)

| Change                         | v1                              | v2                              |
| ------------------------------ | ------------------------------- | ------------------------------- |
| Canvas background              | `#15121c`                       | `#0A0A0F`                       |
| Primary accent                 | Purple `#8a3ffc` / `#d4bbff`   | Coral `#FF6B4A` / `#FF8F6B`    |
| Secondary accent               | Same as primary                 | Violet `#8B5CF6` (AI-only)     |
| Sidebar width                  | 280px fixed                     | 72px icon rail, 260px expanded |
| Hero aspect                    | 21:9                            | 21:9 (kept)                    |
| Glass blur                     | `blur(32px) sat(140%)`         | `blur(32px) sat(140%)` (kept)  |
| Button radius                  | 14px                            | 14px (kept)                    |
| Font: display                  | Space Grotesk                   | Space Grotesk (kept)           |
| Font: body                     | Be Vietnam Pro                  | Be Vietnam Pro (kept)          |
| Font: mono (new)               | —                               | JetBrains Mono                 |
| Token prefix                   | `--ds-*`                        | `--r-*`                        |

### Token Alias Strategy

During migration, `--ds-*` tokens become thin aliases of `--r-*` tokens so
existing components keep working. The migration proceeds surface-by-surface:
home → release → agent → marketplace → library → shows → settings.

---

## 13. Source of Truth

- `web/src/styles/tokens.css` — all design-system tokens (`--r-*`, intent layer `--r-play*`/`--r-agent*`, fluid `--r-text-*`, gradients, elevation; legacy `--ds-*` aliases).
- `web/src/styles/identity-refresh.css` — the duotone polish layer (chrome + per-surface refinements); **loaded last in `layout.tsx`**, so it wins ties. Put cross-surface refinements here.
- `web/src/styles/home-nextgen.css` — home page component classes (`.ng-*`).
- `web/src/styles/shows.css` — Shows surface (violet `--color-signal` + coral live energy) and the `CampaignGallery` lightbox.
- `web/src/app/globals.css` — base typography, `.glass-panel`, persistent chrome.
- This document is the human-readable specification. If a token value here
  disagrees with the code, **the code wins** and this file must be updated.

## 14. Out-of-Scope

- Navigation information architecture — see `docs/ui/ux_research_ia.md`.
- Usability test plan — see `docs/ui/usability_test_plan.md`.
- Per-component implementation details — each component owns its behavior
  within these visual tokens.

---

## 15. Guidelines for Future UI/UX Changes

Read this before changing UI. These rules keep the system coherent.

### Colour — pick by role, never by taste
1. Decide which **Resonance Duotone** role the surface is (§2.3): **Platform =
   violet** (default/structure/on-chain), **Sound = coral** (listening only),
   **Agent = electric violet** (AI/autonomous only). Then use the matching token.
2. **Coral is precious** — only playback/now-playing and Shows live-energy. A
   generic "primary button" is violet, not coral. Buying/listing/pledging on
   chain is violet (it's the platform), even though it's the key CTA.
3. **No hardcoded hex** outside `tokens.css` / `identity-refresh.css`. Reference
   `--r-*` tokens (incl. `--r-grad-*`, `--r-elev-*`, `--r-glow-*`). If you need a
   colour that has a token (e.g. `--r-agent`, `--r-success`), use the token.

### Scale — fluid, never fixed-to-one-screen

> **Global default scale (`--app-zoom`).** Because the app is authored in fixed
> px tuned too large, a modest global scale is baked into the *default* render
> at desktop widths (`@media (min-width:1024px){ body{ zoom: var(--app-zoom) } }`,
> default `0.9`) so 100% browser zoom is the comfortable density for every user —
> not a view they have to zoom out to reach. Tune density by changing the single
> `--app-zoom` token. ⚠️ `zoom` scales `vh`, so any full-height (`height:100vh`)
> container must compensate with `height: calc(100vh / var(--app-zoom))` or it
> leaves a gap at the bottom (the `.app-shell/.app-sidebar/.app-main` rules do
> this). This is a pragmatic lever; the long-term fix is rem/fluid everywhere.
4. **Use the fluid type tokens** (`--r-text-hero/-h2/-h3/-lead/-body`, §3.2),
   not fixed px. Fixed px read oversized on laptops and at 100% on big screens.
5. **Never put `aspect-ratio` on a content container** (hero, card) that holds
   text — it makes the box too short on small screens (clips) and absurdly tall
   on large ones. Use a fluid `min-height: clamp(...)` and let it grow to content.
6. **Don't clip text to look tidy.** Avoid `overflow: hidden` + `max-height` on
   text containers. If you must `-webkit-line-clamp`, keep `line-height ≥ 1.1`
   (a tight line-height + gradient text-clip shaves glyph tops) and allow enough
   lines for real content (campaign/track titles are long).
7. **Numerics** (prices, durations, counts, balances, addresses) use
   `--font-mono` + `tabular-nums`.

### Craft & states
8. **Every list/section needs a real empty state** — icon + headline + one-line
   guidance + a CTA, not a stranded line of text in a void (see `.library-empty`,
   `.player-queue-empty`, `.artist-community__chat-empty` for the pattern).
9. **Glass + elevation** via `var(--studio-surface)` / `--r-elev-*`; ambient
   depth via the `.app-shell` aurora + grain — don't add ad-hoc shadows.

### Accessibility (required)
10. Icon-only buttons get `aria-label`; decorative SVGs get `aria-hidden`.
11. Wrap new motion (pulses, entrance animations) in
    `@media (prefers-reduced-motion: reduce) { … animation: none }`.
12. Keep the keyboard `:focus-visible` ring (violet) — don't remove outlines.

### Verify before merge
13. **Test at 1280, 1440, and 1920 widths** (15″ laptop → large desktop) — the
    clipping/oversizing bugs only show at specific widths. Don't trust one viewport.
14. `clamp()` parses (lightningcss), `tsc` clean, `eslint` clean on changed
    files; update **this doc** and `docs/features/obsidian_frequency_design_system.md`
    for durable design changes (per `AGENTS.md`).
