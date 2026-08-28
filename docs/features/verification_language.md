---
title: "Verification Language Inventory"
status: implemented
owner: "@akoita"
issue: 477
---

# Verification Language Inventory

This page is the copy contract for Resonate's verification surfaces. It keeps
account trust, personhood, provenance, economic controls, technical signals,
and release-rights review separate. The inventory is documentation and display
language only: state values, API types, eligibility rules, and routing behavior
remain unchanged.

## Surface inventory

| Surface | Allowed label or signal | What it proves | What it does not prove | Canonical code/source |
| --- | --- | --- | --- | --- |
| Upload | `Unverified Uploader`, `Independent Account Trust`, `Trusted Creator`, `Trusted Source Account`; `Self-Attested On-Chain` | The uploader's account route and, when signed, the creator wallet's release-provenance statement. | Account trust is not ownership; self-attestation is not independent rights approval; publication can still be monitored, evidence-gated, or routed for review. | `web/src/lib/verificationSemantics.ts`; `web/src/app/artist/upload/page.tsx`; `/help` `upload-music` |
| Release / content protection | `Human Verified`, `Self-Attested On-Chain`, `Fingerprint Cleared`, `Rights Not Reviewed`, `Evidence Submitted`, `Evidence Requested`, `Under Review`, `Approved With Limits`, `Rights Verified`, `Denied`, `Disputed`; economic tier signals | Each label reports its own wallet, provenance, technical-match, economic, or release-rights state. `Rights Verified` reports reviewed evidence supporting likely recording ownership or publishing authority. | No single human, provenance, fingerprint, economic, or limited-approval signal proves every other dimension. `Rights Verified` is not a blanket account or catalog badge. | `web/src/lib/verificationSemantics.ts`; `web/src/components/content-protection/ReleaseContentProtection.tsx`; `web/src/components/content-protection/ContentProtectionBadge.tsx` |
| Marketplace | Release-rights states used for listing gates; `Fingerprint Cleared`; `SynthID Verified`; `Verified Economic Tier` where shown | A listing can expose release review, configured fingerprint, AI-watermark, or economic stake/escrow signals. These qualify the listing's current trust and technical context. | `SynthID Verified` is not ownership or licensing approval; `Verified Economic Tier` is not release-rights review; a marketplace badge is not a promise that every use is licensed. | `web/src/app/marketplace/page.tsx`; `web/src/lib/verificationSemantics.ts`; `web/src/lib/stakeConstants.ts`; `web/src/hooks/useSynthIdVerification.ts` |
| Artist / profile | `Human Verified`; `Independent Account Trust`, `Trusted Creator`, `Trusted Source Account` when an account route is shown | Personhood or account-level platform trust used to explain identity and available routes. | It does not prove that any release is owned, licensed, or cleared for marketplace or payout use. | `web/src/lib/verificationSemantics.ts`; `web/src/components/content-protection/ReleaseContentProtection.tsx`; `web/src/lib/rightsOnboarding.ts` |
| Curator / personhood | `Human Verified` / `Not Human Verified` in curator reporting flows | The wallet passed the personhood or anti-sybil check required by the curation/reporting policy. | It does not prove music ownership, publishing authority, or that a report is correct. | `web/src/components/disputes/HumanVerificationCard.tsx`; `web/src/components/disputes/DisputeDashboard.tsx`; `web/src/lib/verificationSemantics.ts` |
| Disputes / admin / reporting | `Evidence Submitted`, `Evidence Requested`, `Under Review`, `Approved With Limits`, `Rights Verified`, `Denied`, `Disputed`; `Platform Reviewed` for a platform trust state | The current release-rights workflow state and whether reviewer evidence supports a route decision; `Platform Reviewed` describes platform review of creator/economic trust. | Submitted evidence is not approval; `Platform Reviewed` is not `Rights Verified`; a report, dispute, or review state does not establish a final legal determination. | `web/src/components/disputes/AdminDisputeQueue.tsx`; `web/src/components/rights/ReleaseRightsUpgradeModal.tsx`; `web/src/lib/verificationSemantics.ts` |
| Wallet / stake | `New Creator`, `Established`, `Trusted`, `Verified Economic Tier`; `Active`, `Releasable`, `Refunded`, `Slashed`, `Not Staked`; escrow status | The economic controls attached to an account or release: stake, escrow timing, and stake lifecycle. | It does not prove personhood, provenance, ownership, publishing authority, or licensing rights. | `web/src/lib/stakeConstants.ts`; `web/src/components/upload/StakeDepositCard.tsx`; `web/src/components/wallet/MyStakesCard.tsx`; `web/src/components/content-protection/ReleaseContentProtection.tsx` |

## Reserved and qualified terms

`Rights Verified` is reserved for a release whose submitted rights evidence has
been reviewed and supports likely recording ownership or publishing authority.
Do not use it for a human check, account tier, self-attestation, technical
match, stake, or limited marketplace route. Use the explicit workflow labels
while evidence is submitted, requested, under review, approved with limits,
denied, or disputed.

`SynthID Verified` means that the configured SynthID audio-watermark check found
a watermark (with a confidence value where available). It is a qualified
technical/AI-provenance signal, not a rights, ownership, or licensing decision.

Existing-stem SynthID verification requires an authenticated request. The
backend resolves stored audio only through the canonical bounded storage
loader, so neither request data nor a persisted URI can select an arbitrary
remote authority or filesystem path. Uploaded-file verification remains a
separate buffer-only flow.

`Verified Economic Tier` is a qualified platform trust tier for economic
controls such as stake, escrow, and listing limits. It is not `Human Verified`,
independent account ownership proof, or release-rights approval.

## Contributor rules

- Keep every “Verified” label qualified by its subject and scope. Do not add a
  bare `Verified` badge or turn an account label into a release claim.
- Keep account trust, human/personhood, provenance, technical checks, economic
  trust, and release-rights review as separate signals in copy and UI.
- Reserve `Rights Verified` for reviewer-approved, release-specific evidence;
  use the intermediate or negative rights states when that is the actual state.
- Treat self-attestation, fingerprint/SynthID results, human verification, and
  economic tiers as supporting or technical signals, never as substitutes for
  release-scoped rights review.
- When adding or renaming a display term, update this inventory, the matching
  `/help` article, and semantic regression tests. Preserve existing state and
  API values unless a separately reviewed product change authorizes otherwise.

## Business model alignment

This is `vision:core` infrastructure for **ADR-BM-6 Line 3 — marketplace
take-rate and marketplace trust**. Clear, non-overclaiming labels help buyers
and operators understand why a listing is available and what its signals mean.
It also protects the future **Line 5 — B2B/agent licensing** rights moat in
licensing Phases 2–3 by reserving `Rights Verified` for reviewed,
release-specific evidence rather than conflating it with account or economic
trust. See [ADR-BM-6](../strategy/business-model-phase0-decisions.md#adr-bm-6--revenue-line-sequencing--billing-stack),
the [business model RFC](../rfc/business-model.md), and the [rights workflow](rights_verification_workflow.md).
