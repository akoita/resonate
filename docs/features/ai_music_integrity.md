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
`UNDECLARED` after migration, except releases whose human origin is publicly
established, which an operator-reviewed batch can attest (see
[Catalog attestation](#catalog-attestation-2252)).

Owners may correct a declaration before publication. Post-publication changes
must be explicit and auditable rather than silently replacing the earlier
statement.

## Catalog attestation (#2252)

[#1336 decision 3](../issue-1336-implementation-plan.md) backfilled legacy
records to `UNDECLARED` because their provenance was unknown. Much of the
catalog is well-known recordings by established artists, many released long
before generative music AI existed, whose human origin is public knowledge.
For those, the "AI disclosure unavailable" pill is wrong and casts doubt on the
human artists behind them.

**Amended legacy rule.** Records without reliable provenance still backfill to
`UNDECLARED`, not `NONE`, **except** tracks of releases whose human origin is
publicly established. A one-off, operator-reviewed batch moves those tracks to
`NONE` with the distinct source **`catalog_attestation`**. Unknown or
unverifiable origins stay `UNDECLARED`: Resonate does not take responsibility
for authenticating origins it cannot establish from public knowledge.

This is a platform attestation, not an artist self-declaration. It is stored
with its own source so the declaration stays truthful about who made it, and
listeners see wording to match: where the Human-made badge is shown its tooltip
reads "Resonate identified this recording as a published human-made work".
`NONE` badges are hidden by default, so the "AI disclosure unavailable" pill
simply disappears for attested tracks. Promotion is unchanged (`NONE` and
`UNDECLARED` are both promotion-eligible) and so is payout eligibility.

### Evidence criteria

Signals only **propose**; a person decides. The report script
(`classifyAttestationCandidate`) places every release that has an `UNDECLARED`
track in exactly one bucket:

| Bucket | Rule |
| --- | --- |
| `excluded` | Release type `ai_generated` or `remix`; any track with `generationMetadata`; no `UNDECLARED` + `migration` track; or no signal at all. |
| `needs_review` | Some signal exists but a conflicting signal exists (release date or ISRC year on or after the cutoff), the release mixes `UNDECLARED` tracks with tracks declared at another level or source, or only one category of evidence is present. |
| `proposed` | Date evidence **and** provenance evidence, with nothing conflicting. |

- **Date evidence:** `Release.releaseDate` strictly before the cutoff
  `GENERATIVE_AI_ERA_CUTOFF` (2023-01-01), or every `Track.isrc` year of
  reference before it (at least one valid ISRC).
- **Provenance evidence:** a known label (non-empty and not a self-release
  placeholder such as "independent"), or an artist profile pointing at
  MusicBrainz / Wikidata (the hosts the artist enrichment feature draws on).
- A date alone or a label alone never proposes: anyone can type a release date.
- Limits: enrichment (`artist-enrichment.service.ts`) does not persist a
  MusicBrainz or Wikidata id, so the artist signal is read from URLs on the
  persisted artist profile (for example the Wikimedia Commons image enrichment
  suggests) and is often absent. An ISRC year shows the recording existed then,
  not who uploaded it. Review the report before trusting any bucket.

The apply step does not trust the report or the manifest alone. It re-checks,
per track and again inside the write, that the track is `UNDECLARED` with source
`migration`, has no `generationMetadata`, and that its release is in the
manifest and is not `ai_generated` or `remix`. The report excludes a whole
release when any track has `generationMetadata`; the apply guard is per track,
so a manifest that names such a release still never touches the generated
track.

### Application runbook

Environment wiring, credentials, and when to run it belong to the deployment
repository; this is the application procedure. Both scripts need only a
database URL and run in the backend image (`:prod` npm variants use `dist/`).

1. **Report (read-only).**
   `npm run catalog:report-attestation-candidates -- --out report.json`
   prints the bucket counts and reason tallies and writes the full JSON
   (signals per release, plus a `manifestDraft` of the proposed ids) with
   owner-only permissions. `--json` prints the full JSON to stdout instead.
2. **Review.** A person reads the report and writes the manifest: a JSON array
   of release ids (or `{ "releaseIds": [...] }`, the `manifestDraft` shape)
   containing only releases they approve, including any `needs_review` release
   they have verified from public sources. The manifest is an input for one
   environment and is never committed.
3. **Dry run (default).**
   `npm run catalog:apply-attestation -- --manifest manifest.json`
   writes nothing and prints how many tracks would change and which manifest
   entries fail a guard and why.
4. **Apply.**
   `npm run catalog:apply-attestation -- --manifest manifest.json --apply`
   sets `NONE`, empty facets, source `catalog_attestation`, the current
   disclosure schema version, and `aiDeclaredAt = now()` on each eligible
   track, then emits one `catalog.ai_disclosure_recorded` analytics event per
   changed track (identifiers, level, source). Re-running it is a no-op.

The analytics event bridge drops empty arrays, so attested events carry no
`facets` key.

### Reversal and correction

Attested rows are identified by source. The inverse statement returns them to
the legacy state (tracks an artist has since corrected carry source `artist`
and are not matched):

```sql
UPDATE "Track"
SET "aiDisclosureLevel" = 'UNDECLARED',
    "aiDisclosureSource" = 'migration',
    "aiDisclosureVersion" = NULL,
    "aiDeclaredAt" = NULL
WHERE "aiDisclosureLevel" = 'NONE'
  AND "aiDisclosureSource" = 'catalog_attestation';
```

An artist who claims a track can still correct its declaration through the
existing auditable post-publication path, which records source `artist`.

### No new `UNDECLARED` writers

Every track-creation path that runs in production writes an explicit
declaration: multipart ingestion and `createRelease` require one
(`normalizeAiDisclosureInput` rejects a missing or `undeclared` input), native
generation records `ALL` / `resonate_native`, and Remix Studio publish records
a derived level / `remix_derived`. The known remaining paths that still default
to `UNDECLARED` are the dev seed, the privacy-harness fixtures, and the
`stems.processed` upsert fallback for a track row that does not yet exist; they
are tracked as follow-ups rather than part of this batch.

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
- Catalog attestation (#2252):
  `backend/src/modules/catalog/ai-disclosure-attestation.ts` (classification
  and apply logic), with thin operator scripts
  `backend/src/scripts/report_ai_disclosure_attestation_candidates.ts` and
  `backend/src/scripts/apply_ai_disclosure_attestation.ts`.
- Promotion consumers: recommendation, home-feed, agent selector/tool registry,
  and discovery-popularity services.
- Web contract and badge: `web/src/lib/api.ts` and
  `web/src/components/content/AiDisclosureBadge.tsx`.
- Analytics event: `catalog.ai_disclosure_recorded`, containing identifiers,
  level, source, and facet codes only—never prompts or free text.
- No new environment variables are introduced by this slice or by the
  attestation scripts.

## How to verify

Focused validation should cover:

- DDEX mapping, facet validation, mixed-release summaries, and promotion
  eligibility in `backend/src/tests/ai-disclosure.policy.spec.ts`;
- required upload declarations, native/remix provenance, honest legacy state,
  public response redaction, and direct catalog/marketplace availability;
- exclusion of `ALL` from recommendations, AI DJ, Trending, and Top Artists;
- continued promotion eligibility and labels for `PARTLY`;
- upload controls and shared badge copy in web tests;
- User Guide integrity in `web/src/lib/help/help.test.ts`;
- catalog attestation classification, manifest and argument parsing in
  `backend/src/tests/ai-disclosure-attestation.spec.ts`, and report bucketing,
  apply guards, idempotence, dry run, the analytics audit trail, and the public
  catalog response for attested tracks in
  `backend/src/tests/ai-disclosure-attestation.integration.spec.ts`;
- attested versus unattested badge and tooltip wording in
  `web/src/components/content/AiDisclosureBadge.test.tsx`.

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
- uploader-proven human origin for unknown or independent releases (linked
  artist identity, project files/stems, session evidence, or third-party
  verification), planned separately under the epic;
- general-purpose DDEX XML import/export;
- any future policy decision that makes AI disclosure an input to payout
  eligibility.

## References

- [Issue #1336](https://github.com/akoita/resonate/issues/1336)
- [Issue #2252](https://github.com/akoita/resonate/issues/2252) (catalog attestation)
- [Implementation plan](../issue-1336-implementation-plan.md)
- [DDEX ERN 4.3.1 SoundRecording data dictionary](https://service.ddex.net/dd/DD-ERN-431/dd/ern_SoundRecording.html)
- [DDEX ERN 4.3.1 Contributor data dictionary](https://service.ddex.net/dd/DD-ERN-431/dd/ern_Contributor.html)
- [Business Model Phase 0 decisions](../strategy/business-model-phase0-decisions.md)
