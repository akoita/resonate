---
title: "Remix Studio Experience Plan (2026-11)"
status: proposed
owner: "@akoita"
created: "2026-11-08"
related:
  - docs/features/remix_studio.md
  - docs/features/remix_studio_backlog.md
  - docs/roadmap/2026-11-licensed-remix-readiness.md
  - docs/strategy/licensed-derivatives-decisions.md
---

# Remix Studio Experience Plan (2026-11)

The studio's engine is strong, but using it doesn't yet feel world-class. This
plan makes it **fun and easy for amateurs**, and **complete for professionals
while still beautiful and fun to use**. It is a plan only. Each item becomes an
issue and a Vision Sprint slice when the owner approves it.

It complements the [licensed remix readiness roadmap](2026-11-licensed-remix-readiness.md).
That roadmap covers rights, money and discovery. This plan covers the
experience inside and around the studio.

ADR-BM-6: vision-neutral quality, except where an item uses generation credits
(Line 2) or the remix licence (Line 3); those items say so.

## What the studio does well today

- **A real stem engine.** The preview and render use the same DSP chain, with
  measured tempo and 8-bar sections. "Reset to original" always works.
- **Amateur-friendly starting points.** Vibes (slowed + reverb, sped up,
  lo-fi, dreamy, club), song shapes (extended mix, short edit), added beats,
  and "Describe it" with a visible diff and a one-step undo.
- **A deep Pro layer.** Per-stem EQ, pan, punch compressor, echo and sends;
  automation lanes; cues and loops; grid correction; build-ups; mashups; stem
  and DJ extended export.
- **Honest provenance** on every draft ("Your stems only").

## What holds it back (owner screenshot review, 2026-11-08)

1. **It reads like a form, not an instrument.** The Create panel is one long
   scroll of sliders (speed, key, space, tone, warmth, length, beats). Nothing
   invites play, and the best moves are below the fold.
2. **The arrangement grid is hard to read.** Every section is the same purple
   block, so you can't see where the chorus or the drop is. The waveform is
   faint. The bar numbers sit in a row of tiny boxes.
3. **Too much engineering text.** The session header explains limiters and
   loudness normalisation. Rows repeat the stem name ("Vocals / vocals"), and
   "Effects / All on / All off" chips appear on every row.
4. **There's no "wow" moment in the first ten seconds.** A newcomer opens the
   studio and sees a session at rest, with no suggestion and no movement.
5. **Two separate previews.** "Preview changes" for "Describe it" and the live
   controls behave differently.
6. **Comparing is clumsy.** Arrangement / Draft / Original are tabs. You can't
   hold a key and hear the original at the same point in time.
7. **One-step undo only,** and only for "Describe it".
8. **Built for a desktop browser.** The two-column studio doesn't become a
   phone experience. Most fans will arrive on a phone.
9. **Pros miss key studio basics.** No master bus meter or loudness readout
   while mixing, no clip-level editing (move, duplicate or split a section
   across time), no sidechain, no hardware controller support, no recording
   of your own part, no project export to a DAW, no collaboration.
10. **Results stay in the studio.** Sharing gives a link, not something that
    shines on social feeds.

## Design principles

1. **Sound first.** Every control makes a sound the moment you touch it. No
   "Apply", no "Preview", no waiting.
2. **Three depths, one project.** *Play* for everyone, *Studio* for people who
   want control, *Pro* for producers. They are three views of the same session,
   so switching never loses work.
3. **Show the music.** Colour sections by what they are (intro, verse, chorus,
   drop, outro). Show bold waveforms per stem and a playhead that moves.
4. **Always reversible.** Full undo and redo history, instant A/B with the
   original, and "Reset to original".
5. **Plain words on the surface, numbers on demand.** dB, LUFS and Hz live in
   Pro and in tooltips, not in headers.
6. **Phone is a first-class studio**, not a squeezed desktop.
7. **Honest by default.** The provenance badge and the original's credit are
   always visible, and "No AI used" shows when that is true.

## Proposals

### A. Amateurs: fun and easy ("Play" view)

| # | Proposal | What it feels like | Priority |
| --- | --- | --- | --- |
| A1 | **Play view as the default for new users.** A full-width screen with big vibe cards that play a 5-second audition when you hover or touch them, a large animated waveform, and the original's credit. | Opens playing a suggested vibe, which is the "wow" in the first ten seconds | P0 |
| A2 | **Mood pad (XY).** One finger drags across *Chill ↔ Hype* and *Dark ↔ Bright*, which maps to speed, tone, warmth, space and drum level together. | Playing an instrument, not filling a form | P0 |
| A3 | **"Surprise me" dice.** Rolls a tasteful combination of vibe, shape and beat within safe ranges. Every roll is kept in history. | Instant fun, encourages exploring | P0 |
| A4 | **Hold to hear the original** (Space-hold or a press-and-hold button). It crossfades to the original at the same position. | Instant A/B that makes people proud of the change | P0 |
| A5 | **Stem toys.** Big round toggles per stem (voice, drums, bass, keys, guitar, other) with glowing level rings. A one-tap "Instrumental" or "A cappella" toggle. | Understandable without knowing what a stem is | P1 |
| A6 | **Performance pads.** Tap-and-hold, beat-synced effects: filter sweep, stutter, echo throw, tape stop, riser. Record a take, then keep or discard it. | A DJ moment on a phone | P1 |
| A7 | **Guided first remix.** Three steps (pick a vibe, shape it, share it) with a progress bar, skippable, and shown only once. Tied to the existing feature-tips system. | No blank-page anxiety | P1 |
| A8 | **Share as a moving card.** Export a 15–30 second vertical clip with an animated waveform, cover art, the original credit, the provenance badge and a link. Requires the licence tier that allows sharing (ADR-LD-8, Line 3). | Remixes that travel | P1 |
| A9 | **Challenges.** Artist-set remix challenges with a brief, a deadline and a featured spot on the artist page (#2367). | A reason to come back | P2 |

### B. Everyone: clarity and polish ("Studio" view, today's studio, refined)

| # | Proposal | Priority |
| --- | --- | --- |
| B1 | **Group the Create panel into four short cards**: *Vibe*, *Feel* (speed, key, keep pitch), *Space & tone*, *Shape & beat*. Only one card is open at a time, the rest are collapsed with a summary ("Slowed 0.85× · −1 key"). | P0 |
| B2 | **A single live preview.** "Describe it" applies to the live preview immediately and shows its diff as removable chips. The separate "Preview changes" step is removed. | P0 |
| B3 | **A readable arrangement.** Sections labelled and coloured (intro, verse, chorus, drop, bridge, outro) from detected structure, with the artist's cue names when they exist. Bold per-stem waveforms. Bar ruler as a thin timeline. | P0 |
| B4 | **Full undo and redo history** for every edit (Ctrl/Cmd+Z, Shift+Z), with a history drawer listing named steps ("Drums muted", "Lo-fi vibe"). | P0 |
| B5 | **A quieter header.** Technical notes move to an info tooltip. Stem rows show one name. Effects chips appear on hover or focus only. | P0 |
| B6 | **Snapshots.** Save up to four mix states (A, B, C, D) and switch between them while playing. | P1 |
| B7 | **Drafts as a timeline.** Draft cards with waveform, the vibe used, duration, and "Compare with original". Publish and export show the split and the licence status (ADR-LD-6). | P1 |
| B8 | **Motion and sound design.** Gentle transitions, level meters that breathe, and haptics on mobile, all respecting `prefers-reduced-motion`. | P1 |

### C. Phone-first

| # | Proposal | Priority |
| --- | --- | --- |
| C1 | **Phone layout of the Play view**: a vertical waveform, a bottom sheet with vibe cards, a thumb-reach mood pad, and transport in the bottom bar. | P0 |
| C2 | **Phone layout of the Studio view**: one stem lane at a time with swipe between stems, and sections as a horizontal strip. | P1 |
| C3 | **The Pro view on a tablet**, with touch-friendly automation drawing. | P2 |

### D. Professionals: complete, still beautiful ("Pro" view)

| # | Proposal | Priority |
| --- | --- | --- |
| D1 | **Master bus**: a live loudness meter (LUFS short-term and integrated, true peak) against the render target, a master EQ and glue compressor, and a limiter ceiling. What you meter is what the render delivers. | P0 |
| D2 | **Clip editing on the grid**: select a range, then duplicate, move, split or delete across sections per stem, snapped to bars. A real arrangement, not only on/off gates. | P0 |
| D3 | **Sidechain ducking** (for example, bass ducks under the kick) as a one-knob "Pump" per stem, with the source chosen from a list. | P1 |
| D4 | **Per-stem FX rack** with a reorderable chain (EQ, compressor, saturation, filter, delay, reverb send) and A/B per stem. | P1 |
| D5 | **Hardware controller support** (Web MIDI): learn mode for faders, mute, solo, pads and transport. | P1 |
| D6 | **Record your own part**: a microphone or line-in take on a new lane with count-in and latency compensation, ahead of the RFC's "Cover with user vocal" mode. | P2 |
| D7 | **DAW handoff**: export stems plus tempo map and cue markers as a project bundle that opens in common DAWs, gated by the Commercial licence. | P1 |
| D8 | **Versions and branches**: name versions, branch from any one, and compare two versions side by side. | P2 |
| D9 | **Collaborate**: invite a co-producer to a project with view or edit roles. Credits and the remixer share are split per agreed percentage (ADR-LD-1 applies to the remixers' portion). | P2 |
| D10 | **Keyboard-first workflow**: a command palette (Ctrl/Cmd+K) for every action, with shortcut hints in tooltips. | P1 |

### E. Other possibilities worth considering

- **Live remix sessions.** A remixer performs a restyle live, with listeners
  hearing it in a Shows room. Ties remixing to Resonate Shows.
- **Remix in the AI DJ.** Session DJ transitions use licensed restyles, such as
  a slowed outro into the next track, but only for tracks whose artists
  allowed restyles, and labelled as such. Needs an ADR-TE review, because
  ADR-TE-4 forbids generated filler. A DSP restyle is not generated, but it
  needs an explicit decision.
- **Artist-made presets.** Artists publish "official vibes" for their songs (an
  artist-approved lo-fi version, for example), which fans start from. This
  gives artists creative control and makes good results more likely.
- **Stem packs for creators.** A short-video creator pack: a licensed 30-second
  loop plus stems, pre-cleared for social use, gated by a licence tier.
- **Learn mode.** Overlays that explain what an EQ or compressor just did,
  using before and after sound. It turns amateurs into producers over time.

## Suggested sequencing

| Sprint theme | Items |
| --- | --- |
| "Remix is play" | A1, A2, A3, A4, B2, B5, C1 |
| "See the song" | B1, B3, B4, B6 |
| "Pro bus and clips" | D1, D2, D10 |
| "Take it out" | A8, B7, D7 (with the P2/P3 licence work in the readiness roadmap) |
| "Perform it" | A5, A6, D3, D4, D5 |
| "Together" | A7, A9, D8, D9, D6, C2, C3 |

## How we'll know it worked

- Time to first audible change after opening the studio: under 3 seconds,
  median.
- Share of new studio sessions that try more than one vibe or roll the dice.
- Share of sessions that render a draft, and share of drafts shared or
  published.
- Return rate: users who start a second remix within 7 days.
- Pro adoption: share of sessions using Pro view, and use of the master meter
  and clip editing.
- A moderated usability test with five amateurs and five producers before and
  after the "Remix is play" sprint.
