---
title: "Derived-Stem Separation Rights"
status: draft
owner: "@akoita"
related:
  - remix-studio.md
  - ai-derivative-rights-policy.md
  - rights-verification-strategy.md
  - licensing-architecture.md
  - remix-contributor-credential-boundaries.md
  - ../features/remix_studio.md
  - https://github.com/akoita/resonate/issues/1311
---

# Derived-Stem Separation Rights

## Purpose

Epic [#1311](https://github.com/akoita/resonate/issues/1311) shipped a remix
engine whose creative surface assumes **separated stems exist**: full-session
hydration (#1312), the section-grid arrangement (#1314), and per-stem AI
transforms (#1316) all operate per stem. Tracks whose only stem is a full
mixdown (`original`/`master`) get none of it — the studio is a one-fader room
and the epic's remaining slice ("on-demand separation") would fix that by
running the existing Demucs worker on demand.

Separation is **technically trivial** here (the worker, queue, storage, and
encrypted-render boundary all exist). It is **deliberately unbuilt** because it
raises a rights question none of the shipped policy answers:

> Does a remix license on a source authorize the platform to **decompose** that
> source into new stem artifacts the rightsholder never provided?

This RFC defines the policy so the answer is explicit, versioned, and
owner-approved before any code. It follows the repo's standing rule that
partial features leave durable tracking and rights-sensitive behavior ships
policy-first.

## Background: what consent exists today

| Layer | Control | Granted by |
| --- | --- | --- |
| Source viability | rights route (`STANDARD_ESCROW`/`TRUSTED_FAST_PATH`), content status | platform rights pipeline |
| Artist umbrella | `Artist.remixConsent` (`allowed`/`disabled`, global revocation override, #1169) | artist |
| Per-asset consent | `StemNftMint.remixable` — an **affirmative, per-minted-stem** opt-in | artist at mint time |
| Requester right | remix-tier `StemPurchase` / x402 settlement, or artist-owner access (#1174) | purchase / ownership |

The key observation: **per-stem `remixable` consent attaches to stems the
artist chose to mint.** An unminted `original` stem has `remixable = null` —
today that is *not* a hard denial for a licensed requester, but nothing in the
policy contemplates the platform manufacturing new sub-assets from it. Artists
who minted only a master may accept remixing-as-arranging of what they
published while objecting to decomposition (isolated vocals in particular).

## Decision 1 — Is separation inside the remix license?

**Options considered**

- **(A) Implicit**: a remix license on the parent covers any machine
  decomposition of it. Simplest; matches "remix" intuition; but silently
  expands what artists consented to when the policy shipped, and makes vocal
  isolation available wherever remixing is — a poor default for a
  rights-conservative platform.
- **(B) New per-artist consent knob, default allowed**: mirrors the
  `remixConsent` pattern (#1169): `Artist.stemSeparationConsent`
  (`allowed`/`disabled`), a **global revocation override** checked by the
  eligibility policy, default `allowed` so existing behavior-compatible
  artists need no action, revocable at any time with the same semantics as
  remix consent (existing project-scoped derived stems survive; new
  separation and generation re-checks deny).
- **(C) New consent knob, default disabled (opt-in)**: strictest; but it
  makes the feature dead-on-arrival for the whole catalog and is stricter
  than the existing remix-consent default the platform already chose.

**Recommendation: (B)**, with the eligibility rule:

> Separation of a source stem is allowed iff the requester could remix that
> stem under the **existing strict rule** (licensed or artist-owner, mint not
> `remixable: false`, source route/content clean, artist `remixConsent`
> allowed) **and** the artist's `stemSeparationConsent` is `allowed`.

Denials get a new explainable reason code (`separation_disabled`), and the
policy version bumps (`REMIX_POLICY_VERSION` → next date `.vN`).

## Decision 2 — What ARE derived stems? (custody & scope)

Derived stems are **render inputs, not catalog assets**:

- Stored as **project-scoped artifacts** owned by the remix project that
  requested them — *never* `Stem` catalog rows. They do not appear in the
  catalog, the marketplace, search, or any listing surface.
- **Never mintable, never listable, never exportable.** They are reachable
  only through the owner-scoped studio (preview stream) and the internal
  render path.
- **Encryption inheritance**: if the parent stem is encrypted, derived stems
  are encrypted at rest with the same content-key regime and flow through the
  existing `decryptForRender` fail-closed boundary (#1214). Plaintext handling
  rules are identical to today's mixer rules.
- **Deletion**: cascade with project deletion; revocation (consent flip,
  quarantine, DMCA) blocks further **use** at the existing worker-time
  re-check — stored ciphertext without a usable path is acceptable residue,
  same as today's draft outputs.
- **Cache**: separation output MAY be cached platform-side keyed by
  `(sourceStemId, demucs model+version)` to avoid re-separating per project —
  but the cache is a platform optimization with **no user-facing access
  path**; every project-side use re-passes the requester's eligibility.

## Decision 3 — Provenance & lineage

- Each derived stem records `derivedFrom: <parent stemId>`, the Demucs model
  + version, and the separation job id.
- A stem-mix render built from derived stems still contains **only source
  audio**, so grounding remains `stem_audio` — with an added honest marker
  (`derivedStems: true`) in render metadata and publish lineage, and studio
  copy stating the parts were machine-separated from the source.
- Publish lineage `sourceStemIds` continues to reference the **parent**
  (the real catalog entity); the separation detail rides alongside. Royalty
  and license semantics are the parent's — separation creates no new
  rightsholder and no new license terms.

## Decision 4 — The vocal-isolation concern

Isolated vocals are the highest-risk artifact (voice-cloning feedstock). The
custody rules above are the mitigation: no export, no download, owner-scoped
preview-quality streaming only, full-quality audio existing solely inside the
server-side render boundary. Voice/likeness generation remains hard-disabled
(`voiceLikenessAllowed: false`) in every generation input, unchanged. If the
owner wants stricter handling, the cheapest additional guard is excluding the
`vocals` role from preview streaming (render-only) — **flagged as an open
question below rather than assumed.**

## Non-goals

- Minting, listing, exporting, or cross-project sharing of derived stems.
- Any new license tier or royalty split (the parent's terms govern).
- Separation of content the requester could not already remix.
- Voice/likeness features of any kind.
- Backfilling separation for the whole catalog (on-demand only).

## Open questions for owner sign-off

1. **Consent default** — confirm option (B): new `stemSeparationConsent`,
   default `allowed`, global revocation override. (Alternative: (A) fold into
   remix consent with no new knob, or (C) opt-in default.)
2. **Vocals preview** — may isolated **vocals** stream in the studio preview
   like other derived stems, or render-only (Decision 4)?
3. **Cache retention** — is a platform-side separation cache acceptable, and
   for how long (proposal: retain while the source stem exists; drop on
   source deletion/DMCA)?
4. **Artist visibility** — should artists see a signal that their material
   was separated (e.g., a cockpit counter), or is the existing
   remix-demand signal sufficient for v1?

## Implementation sketch (after sign-off — not authorized by this RFC)

1. Policy: `stemSeparationConsent` on `Artist` (+ settings UI mirroring
   #1169), eligibility reason `separation_disabled`, policy version bump.
2. Data: `RemixProjectDerivedStem` (projectId, parentStemId, role, uri,
   encryption fields, model/version, jobId) — project-scoped table, cascade
   delete.
3. Worker: BullMQ separation job calling the existing demucs `/separate`,
   rate-limited alongside generation; feature extraction (#1184) runs on the
   derived stems so grids/hints work.
4. Studio: "Separate into stems" CTA on full-mix-only sessions with an
   honest consent/progress panel; derived stems join the session like
   hydrated stems (muted parent afterwards, derived parts unmuted).
5. Render: mixer accepts project-scoped artifact URIs under the existing
   authorization grant; grounding marker + lineage fields.
6. Tests at every layer per the testing standards; feature page + User
   Guide + analytics events (`remix.separation_requested/completed/denied`).

## Acceptance for this RFC

This RFC is **accepted** when the owner answers the four open questions and
approves Decisions 1–4; the epic's conditional slice then converts into a
normal implementation issue referencing the locked decisions.
