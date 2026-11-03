---
title: "RFC: Remix mashups (two sources in one project)"
status: accepted
author: "@akoita"
created: "2026-11-03"
related:
  - "./remix-studio.md"
  - "./business-model.md"
  - "./licensing-architecture.md"
  - "./ai-derivative-rights-policy.md"
  - "../features/remix_studio.md"
---

# RFC: Remix mashups

> Design (#2552, the second half of #1903 S6f, Vision Sprint 52). The owner
> accepted every recommendation on 2026-11-03 (see
> [Decisions for the owner](#decisions-for-the-owner)). Nothing is built yet;
> the first slice is the next step on #1903.

## Summary

A mashup is one Remix Studio project that uses stems from **two** source
tracks. For example, the vocals of track A go over the drums and bass of
track B. The studio already has everything a mashup needs, but only for one
source: the tempo and key controls (S1b), grid correction (S6c), the structure
blocks, cues and automation.

**Recommendation:**

- Ship a first slice that allows exactly two sources, where each source is
  checked on its own by the existing eligibility engine. Today's rule is "every
  gate on every selected stem", and it applies to both sources.
- Source A leads: its grid, its structure and its bar numbers. Source B is
  conformed to A, with its own tempo stretch and key shift.
- Money needs no new split. Both source artists are paid up front through the
  licenses the creator must already hold on each source, as single-source
  remixes work today. A sold mashup master pays its single EIP-2981 royalty to
  the creator, which matches single-source remixes. So recursive royalty
  (#309, #1431) is **not** a prerequisite for the first slice.

## What exists today (single source)

- **Project.** `RemixProject.sourceTrackId` holds one track. Its
  `RemixProjectStem` rows reference stems, and every stem must belong to that
  track.
- **Eligibility.** The policy `REMIX_POLICY_VERSION 2026-07-03.v6` gives three
  actions:
  - `private_draft` needs a remix-tier license on every selected stem, or
    ownership of the source artist.
  - `publish_resonate` is granted under the same conditions.
  - `export` needs a **commercial** license on every selected stem.

  The engine also checks four other gates:
  - the rights route
  - the content status (quarantined or removed)
  - the artist's `remixConsent` (a global revocation)
  - the `remixable` flag on each stem mint

  Publish and export re-check all of this at the moment of action, so a consent
  flip or a quarantine between draft and publish blocks the action.
- **Selling.** Minting a remix master for sale needs `export` on every source
  stem (`remix_sell_rights_required`). The master mints with a single EIP-2981
  receiver, the remix creator. Flow-through to source artists is deferred to E3
  (License-NFT / ancestry, #1431, #309) because multi-parent splits need a
  splits contract.
- **Time.** All bar-based recipes are keyed to the source's grid and
  structure:
  - cues (`remix-cues/v1`)
  - automation (`remix-automation/v1`)
  - beat (`remix-beat/v1`)
  - parts (`remix-parts/v1`)

  The grid and structure come from the stems' measured audio features (or the
  S6c override). Tempo and key (S1b, `remix-fx/v2` `keepPitch` and
  `semitones`) live on the **master**, so they move every stem together.

## Rights

### Every gate, on both sources

A mashup is eligible for an action only when **each source** is eligible for
it on its own, with the selected stems of that source. This needs no new
policy concept. It is the current rule ("every selected stem passes every
gate") applied over two sources, with each source's own route, content status,
artist consent and mint flags.

- **Consent.** Each artist consents through their own `remixConsent`. Neither
  artist has to approve the pairing itself. This matches how a single-source
  remix needs no per-remix approval today. An optional per-artist "allow
  mashups" switch is a decision for the owner (decision D2). The
  recommendation is to treat the existing consent as covering mashups, and to
  add the switch only when an artist asks for it.
- **Personal licenses.** A Personal license on a source grants no remix
  rights (Personal ⊂ Remix ⊂ Commercial), so stems licensed only at the
  Personal tier cannot be selected. This is the same `license_required` denial
  as today, named for the source it applies to.
- **Mixed tiers.** When source A is held at the Commercial tier and source B
  only at the Remix tier, the mashup can be drafted and published inside
  Resonate but not exported or sold. The weakest source decides the
  action, and the denial names which source blocks it.
- **Revocation later.** When either artist disables consent, or either source
  is quarantined or removed, the existing re-check behaves as it does for a
  single source:
  - publishing and exporting are blocked
  - existing private drafts are kept
  - a published mashup follows the same takedown path as a single-source remix
    of that source

  The denial reasons gain a `sourceTrackId`, so the studio can say *which*
  source changed.

### What does not change

- The AI derivative rights policy, moderation, attribution terms (#1342,
  #1343) and the content-protection attestation needed to list all apply
  unchanged.
- AI part lanes on a mashup are grounded on the leading source's grid, as they
  are today.

## Project model

### Recommended: a source list on the project

- Add `RemixProject.secondarySourceTrackId String?` as a nullable column.
  This is an additive migration. The column is null for every existing
  project.
- Keep `sourceTrackId` as the **leading** source (source A).
- The rule "every `RemixProjectStem` belongs to the source track" becomes
  "belongs to source A or source B".
- Cap the first slice at two sources. A list column (`sourceTrackIds`) was
  considered. It generalises to N sources, but it means rewriting every query
  and index that keys on `sourceTrackId`, and nothing needs a third source yet.

### Time: source A leads

- **Grid.** Bars, structure blocks, cues, automation, beat and parts are all
  counted on source A's grid (with its S6c override when there is one), so
  every existing recipe keeps its meaning.
- **Conforming source B.** A new recipe, `remix-mashup/v1`, holds:
  `{ schemaVersion, secondary: { tempoRatio, semitones, offsetBars,
  firstBeatSec? } }`.
  - `tempoRatio` is B's measured (or overridden) BPM divided into A's. B's
    stems are stretched by it, keeping their pitch, through the same
    Signalsmith path as S1b, applied **per source** before the per-stem
    chain.
  - `semitones` is B's own key shift. The studio suggests it from both
    measured keys (the nearest shift onto A's key or its relative key), and
    the creator can change it.
  - `offsetBars` places B's bar 1 on one of A's bars.
  - `firstBeatSec` reuses the S6c grid-correction idea for B, in case B's
    measured downbeat is off.
- **Master controls.** The master's `keepPitch`, `semitones` and speed still
  apply on top of everything, to both sources.
- **Structure.** Structure blocks rearrange A's sections. B is laid out
  linearly from `offsetBars` and is cut and faded with A's blocks. Mapping B's
  own sections onto A's is left out of the first slice (see the scope below).

### Limits

- **Stretch range.** `tempoRatio` is limited to 0.75–1.33 (about ±4
  semitones' worth of time). Outside that range, artefacts are audible and the
  studio should say the two tracks are too far apart.
- **Stem count.** The total stays within today's per-project stem limit, with
  the two sources together.
- **Preview cost.** Two stretched stem sets cost about twice the CPU in the
  preview workers. This needs to be measured against the GPU and CPU budgets
  from #2436 and #2534 before shipping.

## Lineage and publishing

- **Lineage.** The release's lineage lists **both** sources: track, release
  and stem IDs per source, plus a `role: "lead" | "secondary"` field. It also
  records the `remix-mashup/v1` recipe and the DSP version. `renderMetadata`
  records `mashupDspVersion` and B's conform parameters.
- **Attribution.** The release page credits both source artists. The title
  convention ("A vs B", or the creator's free title) is a product choice; the
  default is the creator's title with both credits shown.
- **AI disclosure.** No change. The flag is true when any AI part or
  generation took part. A stem-only mashup stays `stem_audio` provenance.
- **Publish re-check.** Publishing runs eligibility for both sources and needs
  `publish_resonate` from both. It locks the project as today.
- **Release type.** `type: "remix"`, unchanged. A mashup is a remix with two
  parents, and needs no new release type.

## Money (ADR-BM-4, ADR-BM-6)

**Revenue line.** A mashup is creator tooling on line (2) (Artist Pro /
`remix.pro` seam). It earns on line (3) (the marketplace take-rate) through
the licenses it requires, and through any sale of the master. The first slice
introduces **no new fee, price or split**.

- **Source artists are paid up front.** To make a sellable mashup, the
  creator buys a Commercial license (or the Remix tier for in-Resonate only)
  on the selected stems of **both** sources. Each of those purchases is an
  ordinary marketplace sale: 10% platform take (the canonical rate in
  [`business-model.md`](./business-model.md)) and at least 90% to that
  source's artist. Each artist therefore gets ≥ 85% of *their* transaction,
  with no recoupment and no threshold (ADR-BM-4).
- **Selling the mashup master.** This is the same as a single-source remix
  today. The creator lists the master, the platform takes its 10%, the
  creator receives the rest, and the single EIP-2981 receiver is the creator.
  The mashup's own sale is the creator's transaction, and ADR-BM-4's ≥ 85%
  applies to the creator as the artist of that work.
- **Why recursive royalty is not a prerequisite.** Flow-through of later
  sales to the source artists (#309 diminishing ancestry splits, #1431 E3) is
  the vision for **all** remixes, with one source or two. A two-parent split
  needs the same splits contract that a one-parent split needs. Making
  mashups wait for it would hold mashups to a higher bar than remixes. When E3
  lands, a mashup's ancestry is simply two parents, and the lineage above
  already records them.
- **What stays out.** There is no fan income share, and no
  platform-subsidised payout (ADR-BM-4). No price is set for mashups as such.

## Scope of a first build

**In (one slice, about the size of S6c):**

1. Backend:
   - the `secondarySourceTrackId` column
   - per-source eligibility, with `sourceTrackId` on the denial reasons
   - the `remix-mashup/v1` recipe, validated, with the Pro gate
     (`pro_required`, `fields: ["mashup"]`; clearing it is always allowed)
2. Render: a per-source stretch and key shift for B, then the existing
   per-stem chain. This comes with a parity fixture, as for S1b.
3. Preview: the same steps in the preview worker, plus a CPU measurement.
4. Studio:
   - an "Add a second track" picker, limited to tracks the user can remix
   - B's stems in the stem list, tagged with their source
   - B's tempo ratio, key, offset and downbeat controls, with a suggested key
5. Lineage, attribution on the release page, and the User Guide section.

**Out (later, if wanted):**

- More than two sources.
- Mapping B's sections onto A's structure blocks.
- Automatic beat-matching beyond the measured BPM ratio (warp markers).
- A per-artist "allow mashups" switch (decision D2).
- Any royalty flow-through (E3).

## Decisions for the owner

Decided 2026-11-03: the owner chose the recommended option for all five.

| # | Decision | Options | Decided |
| --- | --- | --- | --- |
| D1 | Build mashups at all, after S6f stem export? | Build the first slice; park | Build, after #2550 ships and the preview CPU check passes |
| D2 | Consent for pairing | Existing `remixConsent` covers it; add an "allow mashups" switch per artist | Existing consent, with the switch only on request |
| D3 | Do mashups wait for recursive royalty (E3)? | Wait; ship with licenses paid up front | Ship. It is the same model as single-source remixes |
| D4 | Leading grid | Source A always; the faster track; the creator picks | Source A (the first track). Swapping is "start a new project" |
| D5 | Tempo stretch range | 0.75–1.33; wider | 0.75–1.33 |

## Risks

- **Two rights routes.** A revocation on either side blocks publishing, so a
  mashup is about twice as fragile as a single remix. The UI must name the
  source that changed.
- **CPU in the preview.** This must be measured before shipping, in line with
  the #2534 GPU work.
- **Discovery and naming.** A mashup credits two artists. Search and the
  artist pages must not present it as either artist's own release.
