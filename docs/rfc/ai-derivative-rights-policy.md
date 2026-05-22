---
title: "RFC: AI Derivative Rights Policy"
status: proposed
author: "@akoita"
created: "2026-05-22"
related:
  - "./remix-studio.md"
  - "./licensing-architecture.md"
  - "./rights-verification-strategy.md"
  - "../features/remix_studio.md"
  - "../features/rights_verification_workflow.md"
  - "../features/ai_music_generation.md"
---

# RFC: AI Derivative Rights Policy

## Abstract

This RFC defines the product and policy guardrails for AI-assisted derivative
works on Resonate, including remixes, extensions, alternate arrangements, and
future cover workflows.

The policy is intentionally conservative:

> AI can assist creation only when consent, source rights, attribution,
> compensation, and provenance are explicit.

The goal is to support creative remix workflows without creating an open-ended
impersonation or catalog-infringement surface.

## Scope

This policy covers:

- AI-assisted stem remixes;
- prompt-based variations of licensed source material;
- AI-generated transitions, intros, outros, bridges, and loops;
- future cover workflows;
- future artist voice or likeness workflows;
- publication and export rules for AI derivatives.

It does not cover fully original AI-generated tracks created without a source
work. Those are covered by [AI Music Generation](../features/ai_music_generation.md),
though both systems share generation provenance concepts.

## Definitions

| Term | Meaning |
| --- | --- |
| Source work | The track, release, stem, or composition used as input/context. |
| Derivative | A new work based on or incorporating a source work. |
| AI derivative | A derivative whose creation uses an AI generation or transformation provider. |
| Remix | A derivative that transforms, rearranges, layers, or extends source stems. |
| Cover | A new performance of an existing composition. |
| Voice/likeness use | Use of an identifiable artist voice, vocal model, persona, or branding. |
| Export | Download, off-platform distribution, or external publishing outside Resonate. |

## Policy Principles

1. **Consent first.** Artists and rightsholders choose if and how their works
   can be used in AI-assisted derivatives.
2. **Rights before generation.** The platform checks source eligibility and user
   license state before starting generation jobs.
3. **Credit is mandatory.** Every derivative stores source attribution and
   displays it where users can reasonably see it.
4. **Compensation follows the source.** AI-generated derivatives follow the same
   royalty obligations as human-made derivatives.
5. **Provenance is durable.** Source IDs, license IDs, provider, prompt,
   generation job ID, timestamps, and policy version are persisted.
6. **Voice and likeness require explicit consent.** Stem remix opt-in is not
   voice-clone opt-in.
7. **Export is a separate right.** A user may be allowed to create a private or
   in-platform remix without being allowed to download or distribute it
   elsewhere.

## Derivative Permission Matrix

| Capability | Default | Required Permission |
| --- | --- | --- |
| Private stem remix draft | Off | Source remix opt-in plus user remix license or owner access. |
| AI variation from stems | Off | Source AI-derivative opt-in plus remix license. |
| AI extension/transition | Off | Source AI-derivative opt-in plus remix license. |
| Publish inside Resonate | Off | In-platform publishing right in license terms. |
| Export/download | Off | Exportable remix or commercial license. |
| Monetize derivative | Off | Monetization right plus royalty terms. |
| Cover with user vocal | Off | Composition/cover policy and attribution terms. |
| Artist voice/likeness cover | Off | Explicit voice/likeness consent. |

## Artist Controls

Artists should be able to set policy at release and stem level:

| Control | Options |
| --- | --- |
| Remix eligibility | disabled, manual approval, allowed with license |
| AI-assisted remix | disabled, allowed for private drafts, allowed for publishing |
| Export | disabled, allowed with remix license, allowed with commercial license |
| Monetization | disabled, platform-only, allowed with royalty terms |
| Voice/likeness | disabled, explicit approved model only |
| Prompt restrictions | optional denylist or allowed style descriptors |
| Royalty terms | default platform terms or custom terms within bounds |

For MVP, these controls can start as backend policy defaults plus a minimal
artist-facing toggle. The long-term product should make them granular.

## User Rights States

The app should distinguish these states clearly:

| State | Meaning | UX |
| --- | --- | --- |
| Not eligible | Source work or policy blocks remixing. | Disable remix action and show reason. |
| License required | Source allows remixing, user lacks rights. | Offer remix license purchase. |
| Draft allowed | User may create private drafts. | Open Remix Studio; block publish/export. |
| Publish allowed | User may publish inside Resonate. | Enable publish flow. |
| Export allowed | User may download or distribute externally. | Enable export and show covenant terms. |

## Source Rights Route Rules

AI derivative creation should inherit Resonate's upload rights routing policy.

| Source Route | AI Derivative Policy |
| --- | --- |
| `BLOCKED` | Never allowed. |
| `QUARANTINED_REVIEW` | Never allowed until review resolves. |
| `LIMITED_MONITORING` | Private drafts disabled by default; manual approval required. |
| `STANDARD_ESCROW` | Allowed if artist opts in and user has license. |
| `TRUSTED_FAST_PATH` | Allowed if artist/source policy opts in. |

System-generated AI releases should not automatically grant open derivative
rights. Their generation provenance can support rights review, but remixability
is still a separate artist/platform policy decision.

## Provider Guardrails

Every AI derivative provider must return or support:

- provider name and model/version where available;
- generation job ID;
- prompt and negative prompt if applicable;
- source asset IDs used by the request;
- duration and output metadata;
- cost estimate or actual cost;
- safety/policy flags where available.

Provider calls should receive explicit policy constraints, not vague product
intent:

```ts
type AiDerivativePolicyContext = {
  sourceTrackId: string;
  sourceStemIds: string[];
  rightsRoute: "STANDARD_ESCROW" | "TRUSTED_FAST_PATH";
  licenseType: "remix" | "commercial" | "sync" | "sample";
  allowedActions: Array<"private_draft" | "publish_resonate" | "export">;
  voiceLikenessAllowed: false;
  explicitAllowed: boolean;
  policyVersion: string;
};
```

MVP should set `voiceLikenessAllowed` to `false` unconditionally.

## Provenance Record

Every AI derivative should persist:

- source release ID;
- source track ID;
- source stem IDs;
- user ID and creator wallet where applicable;
- license ID or purchase ID;
- license type;
- artist opt-in policy version;
- upload rights route at creation time;
- prompt and negative prompt;
- provider, model, and generation job ID;
- output storage URI;
- publication/export status;
- attribution string;
- parent remix IDs where applicable.

This data should feed UI, analytics, dispute review, License NFT metadata, and
machine-readable receipts.

## Attribution Policy

Attribution should be generated from source metadata and license terms.

Minimum attribution fields:

- original artist;
- source track title;
- source stem IDs or human-readable stem labels when relevant;
- derivative creator;
- AI-assisted disclosure;
- license type.

Suggested display:

> Remix by [creator]. Based on "[source title]" by [artist].
> Created with AI assistance under a Resonate remix license.

## Publication And Export Policy

| Action | Required Checks |
| --- | --- |
| Save draft | Valid draft right, source not blocked, provider job completed. |
| Publish inside Resonate | In-platform publish right, attribution, lineage, moderation pass. |
| Export/download | Exportable license, no unresolved disputes, covenant accepted. |
| Monetize | Monetization right, royalty terms, payment split route. |

If source rights later become disputed, published derivatives should enter a
review state. Export can be suspended while the dispute is active.

## Dispute Handling

AI derivatives should be reviewable through the same evidence and operations
model as other catalog assets, with extra derivative context:

- source work;
- source rights route at creation time;
- user license/purchase proof;
- artist opt-in policy at creation time;
- provider provenance;
- output audio fingerprint;
- publication/export history.

Obvious source infringement remains an ops and automation problem, not a jury
first-pass problem.

## Compliance Notes

This RFC is product policy, not final legal advice. Before production launch,
Resonate should have counsel review:

- remix license terms;
- AI-assisted derivative disclosure;
- export and distribution covenants;
- user-uploaded vocal cover terms;
- artist voice/likeness consent language;
- takedown and counter-notice handling for derivatives.

## MVP Recommendation

Start with:

- stem-based private remix drafts;
- no artist voice cloning;
- no external export;
- no monetization of derivatives;
- explicit artist/source opt-in;
- required remix license;
- durable provenance.

This creates a strong product and engineering milestone while avoiding the
highest-risk parts of AI covers.

## Open Questions

- Should private drafts require an upfront remix license or a cheaper
  draft-only right?
- Should derivative opt-in default to off for all direct uploads?
- How should derivative rights work for AI-generated source tracks?
- Should a published remix mint a new StemNFT immediately or wait until the
  user chooses to list it?
- What moderation threshold should apply before a remix becomes public?
