---
title: "AI Music Integrity"
status: partial
owner: "@akoita"
issue: "https://github.com/akoita/resonate/issues/1336"
---

# AI Music Integrity

Track-level AI disclosure and promotion rules that let artists describe how AI
contributed to a recording and let listeners interpret that contribution
consistently across Resonate.

- **Revenue line / phase:** `vision:core` trust infrastructure supporting
  revenue line (3), marketplace take-rate, and the cross-phase AI Music
  Integrity program. This slice does not add or change a fee, split, price, or
  payout amount.
- **Status:** `partial`. The #1336 disclosure and promotion-policy slice is
  implemented. Detection, enforcement, appeals, portable
  provenance credentials, and XML exchange remain explicitly deferred.

## Who it's for

- **Artists and producers** declaring AI involvement when they upload music.
- **Listeners** deciding what to play, save, collect, license, or buy.
- **Backend, frontend, and agent developers** consuming one normalized
  disclosure contract and applying the same promotion rule.
- **Operators and trust reviewers** who need declarations kept separate from
  later detection or enforcement decisions.

## Disclosure model

The source of truth belongs to each track. Its three artist-facing choices map
to the DDEX ERN `SoundRecording.ContainsAI` vocabulary:

| Artist choice | Stored level | DDEX `ContainsAI` | Meaning |
| --- | --- | --- | --- |
| Human-made | `NONE` | `None` | No AI contribution is declared. |
| AI-assisted | `PARTLY` | `Partly` | AI contributed to part of the track. At least one affected facet is required. |
| Fully AI-generated | `ALL` | `All` | The recording is declared fully AI-generated. |

AI-assisted facets cover vocals, instruments, composition/lyrics, production,
and post-production. They describe the declared contribution; they are not a
detector score or a moderation verdict.

Legacy or incomplete records use `UNDECLARED`. Resonate does not translate
that state into DDEX and never presents it as verified human-made. A release
summary is derived from its tracks, so mixed releases do not overwrite the
more precise track-level declarations.

The shape aligns with DDEX ERN 4.3.x `ContainsAI` and `AiContribution`
semantics, but this slice does **not** implement general-purpose DDEX XML import
or export.

## Artist workflow

On `/artist/upload`, the intended completed flow requires one declaration for
every new track. Artists can apply one level to every track and then adjust
individual tracks. AI-assisted tracks require at least one contribution facet.
The choice and its listener-facing consequences appear before publication.

Known Resonate-native generation records `ALL` with a `resonate_native` source
automatically, instead of asking an artist to self-declare provenance already
known by the platform. Published Remix Studio work derives its level from its
grounding mode and records a `remix_derived` source. Other new uploads record
the artist declaration. Existing records without reliable provenance remain
`UNDECLARED` after migration.

Owners may correct a declaration before publication. Post-publication changes
must be explicit and auditable rather than silently replacing the earlier
statement.

## Listener and promotion behavior

Listener-safe badges distinguish **AI-assisted**, **AI-generated**, and
**AI disclosure unavailable** on the primary catalog, release, player, artist
catalog, and marketplace surfaces. Public responses expose the normalized
disclosure, not generation prompts or raw provider metadata.

Tracks declared `ALL` are excluded from surfaces that promote work as human-
artist discovery:

- personalized recommendations and home-feed promotional rails;
- AI DJ and agent catalog candidates;
- Trending rankings;
- engagement used to rank Top Artists.

This is a promotion rule, not a delisting or monetization ban. Fully
AI-generated tracks remain available through direct catalog/search, artist
pages, owned playlists, release links, playback, and labeled marketplace
discovery. `PARTLY` tracks remain promotion-eligible with disclosure.
`UNDECLARED` legacy tracks remain available and honestly labeled while the
migration and later integrity work continue.

## Payout boundary

Issue #1336 does not change payout eligibility. The separately shipped
[Payout Eligibility Gating](payout_eligibility.md) remains the authority for
Shows beneficiaries and marketplace mint destinations: human verification,
rights review, payout release, and rights restrictions are evaluated
independently from this disclosure and promotion slice.

## Main surfaces and code

- UI: `/artist/upload`, catalog/home cards, release detail, player, artist
  catalog, and marketplace/listing views.
- Normalized policy:
  `backend/src/modules/catalog/ai-disclosure.policy.ts`.
- Persistence: `Track.aiDisclosureLevel`, contribution facets, declaration
  source/version, and declaration timestamp in `backend/prisma/schema.prisma`.
- Catalog write/read paths:
  `backend/src/modules/catalog/catalog.controller.ts` and
  `backend/src/modules/catalog/catalog.service.ts`.
- Native provenance: `backend/src/modules/generation/generation.service.ts`
  and `backend/src/modules/remix/remix-project.service.ts`.
- Promotion consumers: recommendation, home-feed, agent selector/tool registry,
  and discovery-popularity services.
- Web contract and badge: `web/src/lib/api.ts` and
  `web/src/components/content/AiDisclosureBadge.tsx`.
- Analytics event: `catalog.ai_disclosure_recorded`, containing identifiers,
  level, source, and facet codes only—never prompts or free text.
- No new environment variables are introduced by this slice.

## How to verify

Focused validation should cover:

- DDEX mapping, facet validation, mixed-release summaries, and promotion
  eligibility in `backend/src/tests/ai-disclosure.policy.spec.ts`;
- required upload declarations, native/remix provenance, honest legacy state,
  public response redaction, and direct catalog/marketplace availability;
- exclusion of `ALL` from recommendations, AI DJ, Trending, and Top Artists;
- continued promotion eligibility and labels for `PARTLY`;
- upload controls and shared badge copy in web tests;
- User Guide integrity in `web/src/lib/help/help.test.ts`.

The exact focused commands are maintained in the
[#1336 implementation plan](../issue-1336-implementation-plan.md).

## Remaining work

Tracked by the [AI Music Integrity epic
#1164](https://github.com/akoita/resonate/issues/1164) and linked issues:

- classifier/detector selection, confidence, model versions, re-scans, and
  mismatch handling ([#347](https://github.com/akoita/resonate/issues/347));
- sanctions, demonetization, delisting, moderation queues, and appeal flows
  ([#1164](https://github.com/akoita/resonate/issues/1164),
  [#404](https://github.com/akoita/resonate/issues/404));
- C2PA and on-chain generation credentials
  ([#349](https://github.com/akoita/resonate/issues/349));
- general-purpose DDEX XML import/export;
- any future policy decision that makes AI disclosure an input to payout
  eligibility.

## References

- [Issue #1336](https://github.com/akoita/resonate/issues/1336)
- [Implementation plan](../issue-1336-implementation-plan.md)
- [DDEX ERN 4.3.1 SoundRecording data dictionary](https://service.ddex.net/dd/DD-ERN-431/dd/ern_SoundRecording.html)
- [DDEX ERN 4.3.1 Contributor data dictionary](https://service.ddex.net/dd/DD-ERN-431/dd/ern_Contributor.html)
- [Business Model Phase 0 decisions](../strategy/business-model-phase0-decisions.md)
