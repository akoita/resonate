---
title: "RFC: Remix Studio"
status: proposed
author: "@akoita"
created: "2026-05-22"
related:
  - "./licensing-architecture.md"
  - "./licensing-roadmap.md"
  - "./rights-verification-strategy.md"
  - "./ai-derivative-rights-policy.md"
  - "../features/remix_studio.md"
  - "../features/remix_studio_backlog.md"
  - "../features/ai_music_generation.md"
  - "../features/agent-commerce-runtime.md"
---

# RFC: Remix Studio

## Abstract

Remix Studio is a planned Resonate product surface where listeners and creators
can create AI-assisted remixes from tracks and stems they are allowed to use.

The feature turns Resonate's existing primitives - catalog playback, Demucs
stems, remix licenses, x402 checkout, generation provenance, rights routing,
and future License NFTs - into a coherent creative workflow:

> listen -> acquire rights -> remix -> publish -> prove lineage.

This is not a general-purpose "clone any song" feature. Remix Studio is a
rights-aware creation environment. It only exposes remix actions when the source
work, artist policy, license state, and platform rights route allow it.

## Market Signal

On May 21, 2026, Spotify and Universal Music Group announced licensing
agreements for a paid Spotify Premium add-on that will let fans create AI covers
and remixes from participating artists and songwriters:

- Spotify announcement: <https://newsroom.spotify.com/2026-05-21/universal-music-group-spotify-licensing-agreements-fan-made-covers-remixes/>
- The Verge coverage: <https://www.theverge.com/ai-artificial-intelligence/935379/spotify-umg-ai-covers-remix>
- TechCrunch coverage: <https://techcrunch.com/2026/05/21/spotify-and-universal-music-strike-deal-allowing-fan-made-ai-covers-and-remixes/>

The strategic meaning for Resonate is that licensed fan-made derivatives are
becoming a mainstream music product category. Spotify's version will likely be
major-catalog-led and platform-contained. Resonate should build the
independent-artist and agent-addressable version: opt-in remix rights,
transparent attribution, programmable payments, remix lineage, and
machine-readable proof.

## Goals

- Give artists a controlled way to opt into fan remix creation.
- Give users a simple in-app workflow to remix eligible works.
- Make remix eligibility explicit before generation, export, or publication.
- Reuse existing Lyria-backed generation where appropriate while allowing future
  audio-conditioned models behind a provider boundary.
- Persist source stems, prompts, generation metadata, license state, and
  attribution as durable provenance.
- Prepare the path for License NFTs, ancestry tracking, and recursive royalties.
- Expose remixable catalog and remix receipts to human UI, OpenAPI, MCP, and
  x402 surfaces over time.

## Non-Goals

- Do not support artist voice cloning or likeness-based covers in the MVP.
- Do not allow users to remix arbitrary external songs without rights evidence.
- Do not bypass artist opt-in or release rights routing.
- Do not promise off-platform export until license terms support it.
- Do not replace a professional DAW. Remix Studio is a guided creative surface,
  not a full production suite.

## Product Thesis

Resonate already treats full tracks as the discovery storefront and stems as the
licensable asset. Remix Studio makes that thesis tangible for normal users:

1. A listener discovers a track.
2. The app shows whether remixing is allowed.
3. The user buys or proves a remix license.
4. The user creates a derivative with stem controls and AI assistance.
5. The derivative carries attribution, lineage, and revenue obligations.

The product promise:

> Create with music you are allowed to use, and keep the proof attached.

## User Personas

| Persona | Job |
| --- | --- |
| Fan | Make a personal remix or alternate version of a favorite eligible track. |
| Producer | Quickly draft a remix using licensed stems and export/publish when terms allow. |
| Artist | Let fans remix selected releases while preserving consent, attribution, and payment. |
| Agent/API consumer | Discover remixable works, quote rights, pay, and receive proof programmatically. |
| Operator | Audit source rights, blocked routes, disputed remixes, and takedown requests. |

## Core User Flow

1. User opens a release, track, or stem.
2. The app computes remix eligibility.
3. If eligible, the user sees a "Remix" action.
4. If the user lacks a remix license, the app offers a remix license purchase.
5. The user opens Remix Studio.
6. The user selects source stems and a remix mode.
7. The backend creates a remix project and generation job.
8. The user previews, adjusts, and saves a draft.
9. The user can publish inside Resonate when terms allow.
10. Export remains disabled unless the attached license grants export rights.

## Remix Modes

### MVP Modes

| Mode | Description | Rights Risk |
| --- | --- | --- |
| Stem Mix | Mute, solo, rebalance, loop, and arrange existing stems. | Low if remix license exists. |
| Prompted Variation | Generate a new section or arrangement inspired by selected stems and metadata. | Medium, needs provider provenance. |
| Prompted Extension | Generate intro, outro, bridge, transition, or loop material around source stems. | Medium, needs source attribution. |

### Later Modes

| Mode | Description | Condition |
| --- | --- | --- |
| Cover With User Vocal | User records or uploads their own vocal over an eligible composition. | Needs composition/cover policy. |
| Artist Voice Cover | Uses an artist voice or likeness. | Requires explicit voice/likeness consent. |
| Off-Platform Export | Download or publish outside Resonate. | Requires exportable license terms. |
| Agent Remix | Agent creates a remix based on listener/session goals. | Requires budget, license, and content policy guard. |

## Eligibility Policy

Remix Studio should only open when all required checks pass.

### Source Checks

- Source release is public and not blocked.
- `rightsRoute` is `STANDARD_ESCROW` or `TRUSTED_FAST_PATH`.
- Source track/stem is not `QUARANTINED_REVIEW`, `BLOCKED`, or DMCA removed.
- Source stem is minted as remixable where on-chain mint data exists.
- Artist or rightsholder has opted into remix creation for the source work.

### User Checks

- User is authenticated.
- User owns or purchases a valid remix license for the selected stems.
- For paid generation, user has enough generation budget or payment method.
- For export/publish, user satisfies the exact license terms.

### Policy Checks

- The requested remix mode is allowed by source policy.
- The AI provider supports the requested operation without violating provider
  safety or rights constraints.
- Explicit content and blocked-prompt policies are enforced outside the model.

## Data Model

MVP should add durable records instead of relying on the current in-memory
`RemixService`.

Suggested models:

```prisma
model RemixProject {
  id                String   @id @default(uuid())
  creatorUserId     String
  sourceTrackId     String
  title             String
  status            String   @default("draft")
  mode              String
  licenseType       LicenseType @default(remix)
  licenseId         String?
  prompt            String?  @db.Text
  generationProvider String?
  generationJobId   String?
  generationMetadata Json?
  attribution       String?  @db.Text
  exportPolicy      Json?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model RemixProjectStem {
  id              String @id @default(uuid())
  remixProjectId  String
  stemId          String
  role            String?
  gainDb          Float?
  muted           Boolean @default(false)
  arrangement     Json?
}
```

The first implementation can store generated audio as existing storage URIs and
promote them into catalog releases later. A later implementation can add
`RemixRelease`, `RemixPublication`, or a generic derivative-work model when the
publishing path matures.

## Events

Extend the event taxonomy around remix lifecycle:

| Event | Purpose |
| --- | --- |
| `remix.project_created` | Draft project created from a source track/stem. |
| `remix.license_required` | User attempted remix action without sufficient rights. |
| `remix.generation_started` | AI remix generation job started. |
| `remix.generation_completed` | AI remix draft generated successfully. |
| `remix.generation_failed` | Generation failed with normalized error. |
| `remix.published` | Remix published inside Resonate. |
| `remix.exported` | Remix exported under an exportable license. |
| `remix.policy_rejected` | Policy guard blocked a remix action. |

Analytics should measure conversion from listen -> remix CTA -> license purchase
-> generated draft -> saved draft -> published remix.

## Provider Architecture

Create a provider boundary instead of coupling Remix Studio directly to Lyria.

```ts
interface RemixGenerationProvider {
  createRemixDraft(input: {
    sourceTrackId: string;
    stemIds: string[];
    mode: "stem_mix" | "variation" | "extension";
    prompt?: string;
    constraints: {
      durationSeconds?: number;
      bpm?: number;
      key?: string;
      explicitAllowed?: boolean;
    };
    provenance: {
      licenseId?: string;
      sourceRightsRoute: string;
      sourcePolicyVersion: string;
    };
  }): Promise<{
    jobId: string;
    provider: string;
    estimatedCostUsd?: number;
  }>;
}
```

Lyria can be the first provider for prompt generation and extensions where it
fits. The boundary leaves room for future audio-conditioned remix models,
separation-aware models, DSP pipelines, or local tools.

## Frontend Surface

### Entry Points

- Release detail page: "Remix" action when eligible.
- Stem card/listing: remix license purchase and "Open in Remix Studio."
- Marketplace buy modal: highlight remix license as creation unlock.
- AI DJ/session surface: later, "make a transition/remix" action for licensed
  tracks.

### Studio MVP

The first studio should include:

- source track header with rights badge and attribution;
- stem list with mute/solo/gain toggles;
- waveform or timeline preview;
- remix mode segmented control;
- prompt box for variation/extension;
- generation budget/cost preview;
- draft status and provider provenance;
- publish/export disabled states with clear license reasons.

## Backend Surface

Potential API routes:

| Route | Purpose |
| --- | --- |
| `GET /remix/eligibility?trackId=...` | Explain whether the current user can remix. |
| `POST /remix/projects` | Create a remix project. |
| `GET /remix/projects/:id` | Read project, stems, generation state, and policy. |
| `PATCH /remix/projects/:id` | Save project edits. |
| `POST /remix/projects/:id/generate` | Start an AI remix draft. |
| `POST /remix/projects/:id/publish` | Publish inside Resonate when terms allow. |
| `POST /remix/projects/:id/export` | Export only when license terms allow. |

The current `POST /remix/create` endpoint can be retained as a compatibility
shim or migrated behind the durable project API.

## Rights And Licensing Integration

Remix Studio depends on:

- upload rights routing for source eligibility;
- remix license pricing and purchase flow;
- `StemNftMint.remixable` when available;
- artist opt-in settings;
- generation provenance;
- future License NFT proof;
- future ancestry tracking and recursive royalties.

No AI-generated remix should get an "AI discount." The same remix license and
royalty obligations apply whether the derivative was made manually, with an AI
tool, or through a hybrid workflow.

## Publishing Policy

MVP publishing should be conservative:

| Action | MVP Policy |
| --- | --- |
| Save private draft | Allowed with valid remix license or artist-owner access. |
| Publish inside Resonate | Allowed if source policy and license terms permit. |
| Download/export | Disabled unless the license explicitly grants export. |
| Monetize derivative | Disabled until LicenseRegistry and royalty terms support it. |
| Use artist voice/likeness | Not supported in MVP. |

## Success Metrics

- Remix CTA impression -> click rate.
- Remix license purchase conversion.
- Draft generation completion rate.
- Save and publish rate.
- Artist opt-in rate.
- Average remix revenue per opted-in release.
- Policy rejection reasons by frequency.
- Dispute/takedown rate for remixes.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Legal risk around AI covers and likeness | Start with stem remixing; defer voice/likeness until explicit consent exists. |
| User confusion around rights | Show concrete disabled states and license explanations before generation/export. |
| AI provider limitations | Use provider abstraction; make stem-mix and project persistence valuable even before advanced audio-conditioned models. |
| Low artist opt-in | Give artists granular controls and dashboard analytics for remix revenue and fan engagement. |
| Platform abuse | Enforce source rights route, trust tier, prompt policy, and moderation before publication. |

## Implementation Phases

### Phase 0: RFC And Product Definition

- Approve Remix Studio scope.
- Define artist opt-in policy.
- Define AI derivative rights policy.
- Create issue backlog.

### Phase 1: Rights-Gated Remix Project MVP

- Durable `RemixProject` model.
- Eligibility service.
- Release/stem Remix CTA.
- Studio page with source stems and local project edits.
- Remix license purchase flow links.

### Phase 2: AI Draft Generation

- Remix generation provider interface.
- First provider backed by existing generation stack where appropriate.
- Queue-backed generation jobs.
- Generation metadata and events.

### Phase 3: Publish Inside Resonate

- Publish generated remix as a catalog derivative.
- Attach attribution and source lineage.
- Surface remix lineage on release pages.
- Add analytics for artist dashboard.

### Phase 4: License NFTs And Recursive Royalties

- Mint License NFTs for remix rights.
- Record ancestry on remix publication.
- Route derivative revenue through royalty splitting.
- Expose verification endpoint and machine-readable receipt.

### Phase 5: Advanced Derivative Modes

- Off-platform export for exportable licenses.
- Cover flows with user vocals.
- Artist voice/likeness only with explicit consent.
- Agent-created remixes with budget and policy guards.

## Open Questions

- Should a remix license be required before opening the studio, or only before
  generation/export?
- Should private drafts be allowed under a cheaper "personal remix" right?
- How should artist opt-in defaults differ for AI-generated releases,
  direct uploads, and trusted-source catalog?
- What is the first AI provider that can safely use source audio context rather
  than only text prompts?
- Should published remixes become first-class releases, stem NFTs, or a separate
  derivative-work object?
