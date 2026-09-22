/**
 * What an erasure does to every model in the schema, and why.
 *
 * This file is the reviewable artifact for #1771 slice 3, and the counterpart
 * to `personal_data_export_manifest.ts`. The two are deliberately *not*
 * inverses of each other: an on-chain mirror is exported (a person is entitled
 * to their own transaction history) and retained (it is a financial record
 * under a legal obligation). `EXPORTED_MODELS` says so itself and must never be
 * reused as a deletion list.
 *
 * Nothing here executes. It declares; the erasure engine reads.
 *
 * ## The three decisions this file encodes
 *
 * **1. Erasure anonymizes in place and closes the account. It does not delete
 * the `User` row.** 103 foreign keys point at `User.id`, and a person's
 * financial, rights and audit history has to survive under the 7-10 year
 * retention the privacy policy states.
 *
 * **2. The user id is itself personal data, so it is rotated.** For wallet and
 * passkey accounts `User.id` *is* the person's lowercased wallet address:
 * `auth.controller.ts` passes `userId: issuedAddress` and `auth.service.ts`
 * then writes `email: "${userId}@wallet.resonate"`. Scrubbing the email while
 * keeping the id would leave the wallet address as the primary key of 43 models
 * and as a foreign key throughout. Erasure therefore replaces `User.id` with a
 * fresh UUID.
 *
 * That is mechanically possible because every foreign key in this database is
 * `ON UPDATE CASCADE` — 103 of 103 across the whole migration history, no
 * exceptions — so the rotation propagates to every relation-linked model for
 * free. The columns that hold a user id *without* a declared relation do not
 * cascade, and are listed in `DANGLING_PERSON_COLUMNS` below. That list is the
 * single most dangerous part of this work: a dangling column nobody listed
 * keeps the wallet address forever and nothing fails loudly.
 *
 * **3. Financial and audit rows keep their wallet address; the link is
 * severed.** The `Wallet` row, the `PasskeyIdentity` rows and the
 * `SignupFaucetAttempt` rows are deleted, so after an erasure nothing in this
 * database resolves that address back to an account.
 *
 * ## Third-party data
 *
 * The export already refuses to hand over reports other people filed. Erasure
 * needs the mirror, and the two cases are not the same:
 *
 * - Text this person wrote **about somebody else** — `CommunityModerationReport.reason`
 *   — is retained. Erasing a reporter must not erase the safety record about the
 *   person they reported. The `reporterUserId` rotates with the cascade, so the
 *   report no longer names its author.
 * - Text somebody else wrote **about this person** — `ShowCampaignDispute.operatorNote`,
 *   `AgentReputationFeedback.notes` on feedback about their agent — is another
 *   person's statement and is not this person's to withdraw. Every `anonymize`
 *   rule therefore declares `matchOn`: the column that must equal this person
 *   for the scrub to apply, so an operator's note on a row this person merely
 *   touched is never scrubbed as if it were theirs.
 */

/**
 * What erasure does to a model.
 *
 * Refined from the vocabulary in the slice plan by one addition: `untouched`.
 * Folding "catalogue rows that name nobody" into `retain` would have said "we
 * keep this despite it being the person's data", which is false for 17 of the
 * 95 models and would have made the retain list look like a much bigger
 * retention claim than it is.
 */
export type ErasureDisposition =
  /** The row has no value once the person is gone, and is deleted outright. */
  | "delete"
  /** The row survives for its non-personal content; named columns are scrubbed. */
  | "anonymize"
  /** Kept as it is, under a financial, rights, safety or audit retention obligation. */
  | "retain"
  /** Analytics: handled by `AnalyticsGovernanceService` (#1770). Not reimplemented here. */
  | "governance"
  /** Artist-scoped: the catalogue survives, detached from the person. */
  | "detach"
  /** No column of this model names the person; erasure does nothing to it. */
  | "untouched";

export interface ErasureRule {
  /** Prisma model name, as it appears in `Prisma.dmmf.datamodel.models`. */
  model: string;
  disposition: ErasureDisposition;
  /** Why, in one sentence a reviewer can check against the schema. */
  reason: string;
  /**
   * Columns the engine overwrites with a null, their default, or a
   * non-identifying placeholder. Named one by one: a bio identifies somebody
   * perfectly well after the id is gone.
   */
  scrub?: readonly string[];
  /**
   * The column that must equal this person for `scrub` to apply. Required
   * wherever anything is scrubbed, because several models carry two person
   * columns (`ShowCampaignDispute` has an initiator *and* a resolver) and
   * scrubbing on the wrong one erases somebody else's words.
   */
  matchOn?: string;
  /** Anything the engine has to know that the disposition alone does not say. */
  note?: string;
}

/**
 * Every model in the schema, with what erasure does to it.
 *
 * Ordered to mirror `schema.prisma` so the two can be diffed by eye.
 */
export const ERASURE_RULES: readonly ErasureRule[] = [
  // ---------------------------------------------------------------------
  // The account itself
  // ---------------------------------------------------------------------
  {
    model: "User",
    disposition: "anonymize",
    reason:
      "The account row is kept so 103 foreign keys and the retained financial history stay valid; "
      + "`id` is rotated to a fresh UUID because for wallet accounts it is the person's wallet address.",
    scrub: ["email"],
    matchOn: "id",
    note:
      "`email` is @unique, so the placeholder must be derived from the new UUID — see "
      + "`erasedEmailFor`. `closedAt` and `erasedAt` are set by the engine, not scrubbed.",
  },
  {
    model: "AccountClosureRequest",
    disposition: "anonymize",
    reason:
      "The request is the proof the erasure was asked for and happened, which the privacy policy "
      + "keeps indefinitely; the free text the person typed into it is not part of that proof.",
    scrub: ["reason", "failureMessage"],
    matchOn: "userId",
  },
  {
    model: "ArtistClaimRequest",
    disposition: "anonymize",
    reason:
      "The claim decision remains auditable, while private evidence and review text are scrubbed when the claimant is erased.",
    scrub: ["evidence", "reviewNote"],
    matchOn: "claimantUserId",
    note:
      "If the erased person was the reviewer instead, only their review note is scrubbed; if they were an approved claimant, the grant is revoked before the user id rotates.",
  },

  // ---------------------------------------------------------------------
  // Credentials, sessions and account-control material
  // ---------------------------------------------------------------------
  {
    model: "Wallet",
    disposition: "delete",
    reason:
      "This row is the mapping from wallet address to account; deleting it is what severs the "
      + "address in the retained financial rows from any person, and it also holds the smart-account salt.",
  },
  {
    model: "PasskeyIdentity",
    disposition: "delete",
    reason:
      "The passkey-to-smart-account mapping; keeping it would let anyone holding the passkey hash "
      + "resolve the erased account, and an anonymized identity is a live credential with a fake owner.",
  },
  {
    model: "WebAuthnCredential",
    disposition: "delete",
    reason:
      "Authentication material with a dangling `userId`; a closed account whose credential row "
      + "survives is a working key to a person who asked to be gone.",
  },
  {
    model: "SessionKey",
    disposition: "delete",
    reason:
      "Holds a raw ECDSA private key and replayable passkey approvals for spending on the person's "
      + "behalf; there is no version of this row that is safe to keep after closure.",
  },
  {
    model: "SignupFaucetAttempt",
    disposition: "delete",
    reason:
      "Maps a wallet address to a user id for faucet anti-abuse, which is precisely the resolution "
      + "erasure has to sever; the gas it records is trivial and already on-chain.",
    note:
      "Deleting it gives up the one-faucet-per-signup guard for that address. Accepted: the address "
      + "is no longer linked to any account, so a later signup from it is a new person to us anyway.",
  },
  {
    model: "Session",
    disposition: "retain",
    reason:
      "The agent session is the billing container that retained `License`, `Payment` and "
      + "`AgentTransaction` rows hang off, and it carries the budget actually spent.",
    note:
      "Not the browser session, and not a credential — that is `SessionKey`, which is deleted. Its "
      + "children are declared RESTRICT, so a delete here would fail against a person's own purchases.",
  },
  {
    model: "KeyAuditLog",
    disposition: "retain",
    reason:
      "Security audit trail of key issuance and revocation, retained so an incident stays "
      + "investigable; its dangling `userId` is rewritten to the new UUID.",
    note:
      "Accepted residue, stated rather than implied: `context` is untyped Json and may "
      + "carry an agent address. It is not scrubbed. The address belongs to the agent key, "
      + "not to the person — and the `SessionKey` holding that key is deleted by this same "
      + "erasure, so what survives is a reference to a credential that no longer exists, "
      + "with the row's `userId` already rotated. Scrubbing it would gut the trail an "
      + "incident investigation needs. Revisit if `context` ever starts carrying the "
      + "person's own wallet address.",
  },

  // ---------------------------------------------------------------------
  // Money, rights, disputes and audit — retained under a legal obligation
  // ---------------------------------------------------------------------
  {
    model: "GenerationCreditAccount",
    disposition: "retain",
    reason:
      "The cached balance of the credit meter, retained with the ledger below so credit accounting "
      + "reconciles; it names nobody once the id is rotated.",
  },
  {
    model: "GenerationCreditTransaction",
    disposition: "retain",
    reason:
      "Append-only credit ledger and the audit source of truth for what a person was charged "
      + "(ADR-BM-3); `reason` is an operator-set movement code, not the person's words.",
  },
  {
    model: "GenerationJobOutcome",
    disposition: "retain",
    reason:
      "Durable generation completion/failure evidence justifies credit charges and refunds; "
      + "the user id rotates by cascade and the bounded failure code contains no submitted content.",
  },
  {
    model: "GenerationCostRecord",
    disposition: "retain",
    reason:
      "Realized per-job cost telemetry that COGS and margin reconciliation is computed from; "
      + "removing rows would silently corrupt a financial series that no longer names anyone.",
  },
  {
    model: "AgentTransaction",
    disposition: "retain",
    reason:
      "An on-chain purchase the person's agent executed: a financial record under the 7-10 year "
      + "retention, with a dangling `userId` that is rewritten rather than left holding the address.",
  },
  {
    model: "License",
    disposition: "retain",
    reason: "A licence granted to a session — a rights record whose existence is what makes past playback lawful.",
  },
  {
    model: "Payment",
    disposition: "retain",
    reason: "Money moved; retained under the accounting and tax obligation stated in the privacy policy.",
  },
  {
    model: "StemNftMint",
    disposition: "retain",
    reason: "Mirror of a public, permanent mint on Base; deleting our copy does not erase the chain and would break the person's own history view.",
  },
  {
    model: "StemListing",
    disposition: "retain",
    reason: "Mirror of a public on-chain listing, retained as a sales record.",
  },
  {
    model: "StemListingIntent",
    disposition: "retain",
    reason: "Pending-listing record reconciled against the chain; deleting it would strand an in-flight settlement.",
  },
  {
    model: "StemPurchase",
    disposition: "retain",
    reason: "A completed purchase: the buyer, amount and settlement a tax authority may ask us to produce.",
  },
  {
    model: "RoyaltyPayment",
    disposition: "retain",
    reason: "A payout to a creator, retained for the same 7-10 years as every other payment record (ADR-BM-4: artists keep at least 85%, and the proof of it).",
  },
  {
    model: "X402Settlement",
    disposition: "retain",
    reason: "Payment settlement and refund record for a paid resource; the receipt is the evidence a charge was legitimate.",
  },
  {
    model: "ContentProtectionStake",
    disposition: "retain",
    reason: "A staked deposit on-chain; the row tracks money that may still be refundable or slashable.",
  },
  {
    model: "ContentAttestation",
    disposition: "retain",
    reason: "An on-chain attestation of content provenance, which other people's rights decisions depend on.",
  },
  {
    model: "Dispute",
    disposition: "retain",
    reason: "A rights dispute between two parties, with stakes and an outcome; one side erasing must not delete the other side's case.",
  },
  {
    model: "DisputeEvidence",
    disposition: "retain",
    reason:
      "The evidence a dispute was decided on. Scrubbing `description` would gut the record while "
      + "the `submitter` address stayed anyway — the worst of both, and it would let a losing party erase the proof.",
    note:
      "The slice plan suggested anonymizing `description`. Refined to retain: this is a rights "
      + "record under a legal obligation, and the other party's defence depends on it.",
  },
  {
    model: "DisputeJurorAssignment",
    disposition: "retain",
    reason: "Jury service and the vote cast, retained so a dispute outcome stays auditable.",
  },
  {
    model: "RightsRouteReassessment",
    disposition: "retain",
    reason: "The audit trail of why a release's rights route changed, which the release's current status rests on.",
  },
  {
    model: "RightsEvidenceBundle",
    disposition: "retain",
    reason: "A rights claim submitted about a work; erasing it could let a later challenger win against a decision this bundle justified.",
    note: "Same refinement as DisputeEvidence: the plan suggested anonymize, the rights-retention obligation wins.",
  },
  {
    model: "RightsEvidence",
    disposition: "retain",
    reason:
      "The individual pieces of a rights claim — `claimedRightsholder`, `artistName`, `description` "
      + "are the evidence itself, not incidental free text around it.",
    note: "Same refinement as DisputeEvidence.",
  },
  {
    model: "TrustedSource",
    disposition: "retain",
    reason: "Rights-infrastructure record of a catalogue source and who vouched for it; other artists' trust levels derive from it.",
  },
  {
    model: "StemQualityRating",
    disposition: "retain",
    reason:
      "A curation judgement with an on-chain attestation and reputation consequences for others; "
      + "a curator must not be able to erase their own bad ratings by closing an account.",
  },
  {
    model: "ShowPledge",
    disposition: "retain",
    reason: "Money pledged into an escrow campaign, possibly still refundable; a financial record with an on-chain counterpart.",
  },
  {
    model: "ShowCampaignEvent",
    disposition: "retain",
    reason: "The escrow state-transition log for a campaign holding other people's money.",
  },
  {
    model: "ShowEscrowReconciliationAcknowledgement",
    disposition: "retain",
    reason:
      "An operator's acknowledgement of an escrow discrepancy — a record of a decision about other "
      + "people's money, and a professional act rather than personal expression.",
    note: "Both `acknowledgedByUserId` and `revokedByUserId` are dangling and must be rewritten.",
  },
  {
    model: "ContractEvent",
    disposition: "retain",
    reason: "Raw indexed chain log; a person's address appears only inside the untyped `args` JSON, and the chain keeps its own copy regardless.",
  },
  {
    model: "ShowCampaignEscrowEvent",
    disposition: "retain",
    reason: "Raw indexed escrow log, keyed by contract address and block position, backing the escrow reconciliation above.",
  },
  {
    model: "PunchlineCollectible",
    disposition: "retain",
    reason: "A collectible edition the person paid for; the purchase and the edition number stay consistent with the retained payment record.",
  },
  {
    model: "PunchlineUnlockGrant",
    disposition: "retain",
    reason: "The entitlement earned by a retained collectible; deleting it would leave the collectible without the reward it bought.",
  },
  {
    model: "CommunityBenefitRedemption",
    disposition: "retain",
    reason: "A benefit that was redeemed and possibly settled; the artist's own accounting of what they gave out depends on it.",
  },
  {
    model: "CommunityModerationReport",
    disposition: "retain",
    reason:
      "A safety report this person filed about somebody else; erasing the reporter must not erase "
      + "the record about the person reported. Retained under the legitimate-interest basis for abuse prevention.",
    note: "The third-party mirror of the export refusing to hand over reports others filed. `reporterUserId` rotates with the cascade, so the row stops naming its author.",
  },
  {
    model: "AnalyticsConsent",
    disposition: "retain",
    reason: "A consent decision, which the privacy policy keeps indefinitely so we can prove what was and was not agreed to.",
  },

  // ---------------------------------------------------------------------
  // Anonymize — the row stays for its non-personal content
  // ---------------------------------------------------------------------
  {
    model: "CommunityProfile",
    disposition: "anonymize",
    reason:
      "Other people's threads render authors from this row, so it stays; the display name, bio and "
      + "avatar are the person themselves and go.",
    scrub: ["displayName", "bio", "avatarUrl"],
    matchOn: "userId",
  },
  {
    model: "CommunityMessage",
    disposition: "anonymize",
    reason:
      "Deleting a message would tear holes in other people's conversations; `body` is what the "
      + "person wrote and is the only part of the row that names them.",
    scrub: ["body"],
    matchOn: "authorId",
  },
  {
    model: "Playlist",
    disposition: "anonymize",
    reason:
      "Other people may have saved it (`SavedPlaylist.sourcePlaylistId` cascades on delete), so the "
      + "row stays and only the name the person chose is scrubbed.",
    scrub: ["name"],
    matchOn: "userId",
    note: "The engine must also force `visibility` to `private`: a kept playlist must not stay publicly browsable under an erased account.",
  },
  {
    model: "Folder",
    disposition: "anonymize",
    reason:
      "Playlists reference it with a RESTRICT foreign key, so it cannot be deleted while any of "
      + "them survives; the folder name is the person's own wording.",
    scrub: ["name"],
    matchOn: "userId",
  },
  {
    model: "AgentConfig",
    disposition: "anonymize",
    reason:
      "Other people's `AgentReputationFeedback` about this agent cascades on delete, so the row "
      + "stays; the agent name, taste profile and identity credential are the person.",
    scrub: ["name", "vibes", "learnedTasteProfile", "identityCredential", "reputationSnapshot"],
    matchOn: "userId",
    note:
      "Debatable: this is taste state, which the plan groups under delete. Kept because deleting it "
      + "would destroy statements other people made about the agent.",
  },
  {
    model: "AgentReputationFeedback",
    disposition: "anonymize",
    reason:
      "Feedback this person submitted about somebody else's agent: the score keeps that agent's "
      + "reputation honest, the notes are the person's own words.",
    scrub: ["notes", "submitterIdentifier", "evidenceUri"],
    matchOn: "submitterUserId",
    note: "Feedback *about* this person's agent is another person's statement and is untouched — hence `matchOn: submitterUserId`.",
  },
  {
    model: "RemixProject",
    disposition: "anonymize",
    reason:
      "A remix may have been published and bought (`publishedReleaseId`), so the provenance row "
      + "stays; the title, prompt and attribution are the person's writing.",
    scrub: ["title", "prompt", "attribution"],
    matchOn: "creatorUserId",
  },
  {
    model: "LibraryTrack",
    disposition: "anonymize",
    reason:
      "`isOwned`/`tokenId` record that the account holds a purchased edition and must stay "
      + "consistent with the retained `StemPurchase`; the titles, artists and local file paths are the person's own library.",
    scrub: [
      "title",
      "artist",
      "albumArtist",
      "album",
      "genre",
      "sourcePath",
      "remoteUrl",
      "remoteArtworkUrl",
      "previewUrl",
    ],
    matchOn: "userId",
    note: "`sourcePath` is a path on the person's own computer and is the most identifying column in the model.",
  },
  {
    model: "ShowCampaignDispute",
    disposition: "anonymize",
    reason:
      "The dispute governs the release of other people's escrowed money and has to stay; `reason` "
      + "is the initiator's own account of it.",
    scrub: ["reason"],
    matchOn: "initiatorUserId",
    note:
      "`operatorNote` is deliberately NOT scrubbed: it is the operator's record of a money decision, "
      + "retained under the financial obligation. `resolvedByUserId` is dangling and is rewritten, but "
      + "matching on it must never trigger this scrub — the text belongs to the initiator.",
  },
  {
    model: "CuratorReputation",
    disposition: "anonymize",
    reason:
      "The abuse counters stay under the legitimate-interest basis, so closing an account cannot "
      + "reset a curator's record; the human-verification outcome is an identity check with no such basis.",
    scrub: [
      "verifiedHuman",
      "humanVerificationProvider",
      "humanVerificationStatus",
      "humanVerificationScore",
      "humanVerificationThreshold",
      "humanVerifiedAt",
      "humanVerificationExpiresAt",
    ],
    matchOn: "walletAddress",
    note:
      "Keyed by wallet address only, and this table holds addresses in mixed case "
      + "(see the inventory): the engine must match case-insensitively or it will silently miss rows.",
  },

  // ---------------------------------------------------------------------
  // Delete — no value once the person is gone
  // ---------------------------------------------------------------------
  {
    model: "CommunityVisibilitySettings",
    disposition: "delete",
    reason: "Per-person visibility preferences; every column defaults to the most private value, so absence says the same thing more safely.",
  },
  {
    model: "CommunityBadge",
    disposition: "delete",
    reason: "Badges awarded to the person; they describe the person, nobody else reads them, and nothing references them.",
  },
  {
    model: "CommunityRole",
    disposition: "delete",
    reason: "Roles and moderator grants; a closed account must not keep a privilege it could be signed back into.",
  },
  {
    model: "CommunityCohortMembership",
    disposition: "delete",
    reason: "This person's place in a taste cohort — behavioural state about them with no retention basis.",
  },
  {
    model: "CommunityMembership",
    disposition: "delete",
    reason: "Membership of a room; removing it is the closure, and the messages are anonymized rather than lost.",
  },
  {
    model: "CommunityDiscordBridge",
    disposition: "delete",
    reason:
      "Holds a live webhook URL into a Discord server the departed person runs; keeping it means we "
      + "keep posting into their server after they asked to be erased, and a detached artist profile cannot operate it.",
    note: "Debatable — it is artist-scoped and the artist survives. Deleted because it is a bearer credential to a third-party server the person controls.",
  },
  {
    model: "CommunityDiscordRoleMapping",
    disposition: "delete",
    reason: "Cascades from the deleted bridge; a role mapping without its bridge is unreachable configuration.",
  },
  {
    model: "CommunityDiscordSyncAttempt",
    disposition: "delete",
    reason: "Cascades from the deleted bridge; delivery attempts to a webhook that no longer exists.",
  },
  {
    model: "AgentSignal",
    disposition: "delete",
    reason: "Per-play taste signals — behavioural state about the person, kept only to personalise for them.",
  },
  {
    model: "ListenerTasteMemorySettings",
    disposition: "delete",
    reason: "Consent-shaped switches for taste memory; with the account closed there is nothing left to switch.",
  },
  {
    model: "ListenerTasteSignalControl",
    disposition: "delete",
    reason: "Individual like/ban taste controls the person set; they describe the person and nothing else reads them.",
  },
  {
    model: "SavedPlaylist",
    disposition: "delete",
    reason: "This person's saves of other people's playlists; a private bookmark with no value to anyone else.",
  },
  {
    model: "RecommendationProfile",
    disposition: "delete",
    reason: "The derived preference vector and served-track memory — a profile of the person, built only to serve them.",
  },
  {
    model: "Notification",
    disposition: "delete",
    reason: "Messages addressed to the person, with titles and bodies about their activity, and no retention basis once they are gone.",
    note: "Keyed by wallet address in mixed case; match case-insensitively or rows survive.",
  },
  {
    model: "NotificationPreference",
    disposition: "delete",
    reason: "Delivery preferences for notifications that will no longer be sent.",
    note: "`walletAddress` is the primary key here, and it is personal data — this row cannot be anonymized, only removed.",
  },

  // ---------------------------------------------------------------------
  // Detach — the artist survives, unowned. The catalogue was bought by
  // other people and cannot be taken from them (#1793).
  // ---------------------------------------------------------------------
  {
    model: "Artist",
    disposition: "detach",
    reason:
      "`Artist.userId` is nullable by design: the profile is set adrift from the person while the "
      + "catalogue published under it survives for the people who bought it.",
    scrub: ["payoutAddress"],
    matchOn: "userId",
    note:
      "`displayName`, `summary` and `website` are deliberately kept — the released catalogue is "
      + "published under them. `payoutAddress` goes so no later payout routes to the erased person's wallet.",
  },
  {
    model: "Release",
    disposition: "detach",
    reason:
      "Other people bought these releases, so they are withdrawn from streaming through the #1793 "
      + "mechanism (`status = \"withdrawn\"`) rather than deleted.",
    note:
      "The engine writes the withdrawal fields itself rather than calling "
      + "`CatalogService.withdrawRelease`, for two structural reasons: that method "
      + "authorizes from `Artist.userId`, which this erasure has just set to null, and "
      + "it writes through the global client so it cannot join the erasure transaction. "
      + "It copies #1793's semantics exactly — withdrawable statuses only, per-row "
      + "`statusBeforeWithdrawal` — and the two must be kept in step by hand.",
  },
  {
    model: "ReleaseArtistCredit",
    disposition: "detach",
    reason: "Catalogue credits naming the artist on a release; the credit is part of the published work, not of the account.",
  },
  {
    model: "CreatorTrust",
    disposition: "detach",
    reason: "The trust tier assigned to the artist profile, which future moderation of that catalogue still depends on.",
  },
  {
    model: "CommunityBenefitRule",
    disposition: "detach",
    reason: "A benefit the artist offered; the redemptions against it are retained, so the rule that explains them has to be too.",
  },
  {
    model: "CommunityRoom",
    disposition: "detach",
    reason: "Rooms owned by an artist, campaign or cohort rather than by a user; the conversations in them belong to their members.",
    note: "`ownerId` is polymorphic and is in `DANGLING_PERSON_COLUMNS` defensively — no room type is user-owned today.",
  },
  {
    model: "TrustedSourceArtistLink",
    disposition: "detach",
    reason: "A verified link between the artist profile and an external catalogue source; it describes the catalogue, not the account.",
  },
  {
    model: "TrustedSourceLinkRequest",
    disposition: "detach",
    reason: "The request and its proof that justified a trust decision; `proofSummary` is retained evidence for that decision.",
  },
  {
    model: "ReleaseRightsUpgradeRequest",
    disposition: "detach",
    reason: "The rights-upgrade claim a release's current route rests on; erasing it would leave the route unexplained.",
  },
  {
    model: "ShowCampaign",
    disposition: "detach",
    reason: "A campaign holding other people's escrowed money; it cannot follow the person out, and its beneficiary address is what funds already route to on-chain.",
  },
  {
    model: "PunchlineDrop",
    disposition: "detach",
    reason: "The artist's drop, whose collectibles other people bought and are retained.",
  },
  {
    model: "ArtistEngagement",
    disposition: "detach",
    reason: "Aggregate engagement computed about the artist profile; it names no listener and follows the detached profile.",
  },

  // ---------------------------------------------------------------------
  // Governance — analytics, handled by AnalyticsGovernanceService (#1770)
  // ---------------------------------------------------------------------
  {
    model: "AnalyticsEvent",
    disposition: "governance",
    reason:
      "Behaviour events are deleted or redacted by `AnalyticsGovernanceService`, which since #1770 "
      + "also reaches the warehouse; the erasure engine calls it rather than writing SQL of its own.",
    note:
      "`actorId` is NOT always the pseudonymous hash. `analytics_domain_event_bridge.service.ts` "
      + "passes a raw `userId` through as `actorId` and `subjectId` for many events, and nothing "
      + "between there and `analytics_event_store.ts` pseudonymizes it — so these columns can hold "
      + "the person's wallet address verbatim. Both are listed in `DANGLING_PERSON_COLUMNS`.",
  },
  {
    model: "AnalyticsGovernanceLog",
    disposition: "governance",
    reason: "Deletion lineage, deliberately retained so a deletion stays provable; the governance service owns what it may redact in it.",
  },

  // ---------------------------------------------------------------------
  // Untouched — no column of this model names the person
  // ---------------------------------------------------------------------
  {
    model: "Track",
    disposition: "untouched",
    reason: "Catalogue record keyed by releaseId; the artist link runs through the detached Release.",
  },
  {
    model: "TrackEmbedding",
    disposition: "untouched",
    reason: "Machine-generated similarity vector keyed by trackId, with no column naming a person.",
  },
  {
    model: "Stem",
    disposition: "untouched",
    reason: "Audio component keyed by trackId; it names no person and carries only the audio itself.",
  },
  {
    model: "StemPricing",
    disposition: "untouched",
    reason: "Price configuration keyed by stemId, reachable only through a stem.",
  },
  {
    model: "AudioFingerprint",
    disposition: "untouched",
    reason: "Acoustic fingerprint of a track, keyed by trackId and naming no person.",
  },
  {
    model: "RemixProjectStem",
    disposition: "untouched",
    reason: "Track-layer rows keyed by remixProjectId, reachable only through the anonymized RemixProject.",
  },
  {
    model: "PunchlineMoment",
    disposition: "untouched",
    reason: "Clip definition keyed by dropId, describing the work rather than any listener.",
  },
  {
    model: "PunchlineUnlock",
    disposition: "untouched",
    reason: "Reward rule keyed by dropId; the person's grants are retained separately as PunchlineUnlockGrant.",
  },
  {
    model: "ShowCampaignVisual",
    disposition: "untouched",
    reason: "Campaign imagery keyed by campaignId, reachable only through the detached ShowCampaign.",
  },
  {
    model: "ShowCampaignTier",
    disposition: "untouched",
    reason: "Pledge tier definitions keyed by campaignId; they describe the offer, not a backer.",
  },
  {
    model: "CommunityCohort",
    disposition: "untouched",
    reason: "A group definition rather than a person; this person's place in it is deleted as CommunityCohortMembership.",
  },
  {
    model: "TrackPopularity",
    disposition: "untouched",
    reason: "Aggregate popularity of a track across all listeners, in which no individual is identifiable.",
  },
  {
    model: "DmcaReport",
    disposition: "untouched",
    reason:
      "A takedown notice keyed by trackId whose personal content — claimant name and email — belongs "
      + "to the reporter, not to the person being erased; it is theirs to request, not ours to delete.",
  },
  {
    model: "IndexerState",
    disposition: "untouched",
    reason: "Per-chain block cursor for the indexer; operator infrastructure with no personal column.",
  },
  {
    model: "ShowEscrowIndexerState",
    disposition: "untouched",
    reason: "Per-chain escrow cursor and worker lease; `feeRecipient` is the platform and `leaseOwnerId` is a worker process.",
  },
];

/** Indexed by model name, for the engine to look a disposition up in O(1). */
export const ERASURE_RULES_BY_MODEL: Readonly<Record<string, ErasureRule>> = Object.freeze(
  Object.fromEntries(ERASURE_RULES.map((rule) => [rule.model, rule])),
);

/**
 * `retain` normally implies the person can still see the row, because the
 * export shows them everything we keep. These two are the exceptions, recorded
 * rather than quietly allowed.
 */
export const RETAINED_BUT_NOT_EXPORTED: Readonly<Record<string, string>> = {
  ContractEvent:
    "Retained as an indexed copy of a public ledger, but not exported: a person's address appears only inside the untyped `args` JSON, so there is no column to query them by. Their transactions reach the export through the typed mirrors instead.",
  ShowCampaignEscrowEvent:
    "Same shape as ContractEvent — keyed by contract address and block position, with the person reachable only through ShowPledge, ShowCampaign and ShowCampaignEvent, which are exported.",
};

// -------------------------------------------------------------------------
// The columns `ON UPDATE CASCADE` will not reach
// -------------------------------------------------------------------------

/**
 * What the engine does with a dangling column when it rotates `User.id`.
 */
export type DanglingColumnAction =
  /** Overwrite the old user id with the new UUID. */
  | "rewrite"
  /** Clear the identifier and associated private text before id rotation. */
  | "scrubbed"
  /** Nothing: the model's disposition deletes the whole row anyway. */
  | "deleted-with-row"
  /** Left to `AnalyticsGovernanceService`, which owns these rows end to end. */
  | "governance";

export interface DanglingPersonColumn {
  model: string;
  /** Exact column name, as it appears in the datamodel. */
  column: string;
  action: DanglingColumnAction;
  reason: string;
}

/**
 * Every column that holds a `User.id` **without** a declared `User` relation
 * behind it.
 *
 * These are the rows `ON UPDATE CASCADE` does not reach. For a wallet or
 * passkey account the value sitting in them is the person's wallet address, so
 * a column missing from this list keeps that address forever and nothing fails.
 * `personal_data_erasure_manifest.spec.ts` re-derives the candidates from the
 * datamodel and fails until every one of them is either here or in
 * `REVIEWED_NON_PERSON_ID_COLUMNS` with a written reason.
 *
 * The inventory's category 2a was treated as a starting point, not as complete
 * — it was already wrong once. Re-deriving found `ShowCampaignDispute.resolvedByUserId`,
 * which it does not mention and which sits on a model that *does* have a User
 * relation (on `initiatorUserId`), so a per-model check would have missed it too.
 */
export const DANGLING_PERSON_COLUMNS: readonly DanglingPersonColumn[] = [
  {
    model: "ReleaseArtistCredit",
    column: "identityReviewerUserId",
    action: "scrubbed",
    reason:
      "This optional reviewer id has no User relation; erasure clears it and the private review note before rotating the account id.",
  },
  {
    model: "SignupFaucetAttempt",
    column: "userId",
    action: "deleted-with-row",
    reason: "The whole row is deleted; it exists to map an address to an account, which is what erasure severs.",
  },
  {
    model: "WebAuthnCredential",
    column: "userId",
    action: "deleted-with-row",
    reason: "The whole row is deleted; a passkey credential pointing at an anonymized account is still a working key.",
  },
  {
    model: "AgentTransaction",
    column: "userId",
    action: "rewrite",
    reason: "The row is retained as a financial record, so the id must be rewritten or the wallet address stays in it.",
  },
  {
    model: "KeyAuditLog",
    column: "userId",
    action: "rewrite",
    reason: "Security audit rows are retained; rewriting the id keeps the trail intact without naming the person.",
  },
  {
    model: "ShowEscrowReconciliationAcknowledgement",
    column: "acknowledgedByUserId",
    action: "rewrite",
    reason: "Retained operator audit; the acknowledging actor may be this person.",
  },
  {
    model: "ShowEscrowReconciliationAcknowledgement",
    column: "revokedByUserId",
    action: "rewrite",
    reason: "The second, independent actor column on the same row; either may be this person.",
  },
  {
    model: "ShowCampaignDispute",
    column: "resolvedByUserId",
    action: "rewrite",
    reason:
      "The operator who resolved the dispute. Not in the inventory, and easy to miss because the "
      + "model already has a User relation on `initiatorUserId` — that relation cascades, this column does not.",
  },
  {
    model: "CommunityRoom",
    column: "ownerId",
    action: "rewrite",
    reason:
      "Polymorphic owner. Today `ownerType` is only artist, show_campaign or cohort, so no row should "
      + "match; rewritten defensively because a user-owned room type would otherwise keep the address silently, "
      + "and artist/campaign/cohort ids can never collide with a user id.",
  },
  {
    model: "AnalyticsEvent",
    column: "actorId",
    action: "governance",
    reason:
      "Usually the pseudonymous actor id, but the domain-event bridge writes a raw `userId` here for "
      + "many events and nothing pseudonymizes it on the way to the store. `AnalyticsGovernanceService` "
      + "must be given both the pseudonymous id and the old raw user id.",
  },
  {
    model: "AnalyticsEvent",
    column: "subjectId",
    action: "governance",
    reason: "Holds a raw `userId` whenever `subjectType` is \"user\"; same governance path as `actorId`.",
  },
  {
    model: "AnalyticsGovernanceLog",
    column: "actorId",
    action: "governance",
    reason: "Mirrors the event it logs, so it can carry the same raw user id; the governance service owns what it may redact.",
  },
  {
    model: "AnalyticsGovernanceLog",
    column: "subjectId",
    action: "governance",
    reason: "Mirrors the event's subject, with the same raw-user-id exposure.",
  },
];

/**
 * Field-name patterns the coverage test uses to find columns that might hold a
 * `User.id`.
 *
 * Deliberately wider than `userId`: several models spell the user column
 * something else, and the polymorphic `ownerId`/`subjectId`/`actorId` shapes
 * are exactly where a person hides without the word "user" appearing anywhere.
 */
export const PERSON_ID_COLUMN_PATTERNS: readonly RegExp[] = [
  /user_?id$/i,
  /owner_?id$/i,
  /subject_?id$/i,
  /^actor_?id$/i,
];

/**
 * Columns that match a pattern above but do not hold a `User.id`, each with the
 * reason it was cleared. Reviewed individually; this list is the record of that
 * review, and the test keeps it honest by failing on an entry no pattern flags.
 */
export const REVIEWED_NON_PERSON_ID_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ShowEscrowIndexerState: {
    leaseOwnerId: "The id of the worker process holding the distributed indexer lease, not a person.",
  },
  RightsEvidenceBundle: {
    subjectId:
      "Typed by `RightsEvidenceSubjectType`, whose values are upload, release, track, dispute and trusted_source_link_request — never a user.",
  },
  RightsEvidence: {
    subjectId: "Same `RightsEvidenceSubjectType` enum as the bundle it belongs to; the subject is always a work or a case.",
  },
  RightsRouteReassessment: {
    evidenceSubjectId: "Copied from the evidence bundle's subject, so it carries the same enum-constrained work or case id.",
  },
};

// -------------------------------------------------------------------------
// The erased placeholder
// -------------------------------------------------------------------------

/**
 * Domain of the placeholder email an erased account is left with.
 *
 * Distinct from `wallet.resonate`, which `auth.service.ts` uses for live wallet
 * accounts, so an erased row is never mistaken for a signed-up one.
 */
export const ERASED_EMAIL_DOMAIN = "erased.resonate";

/**
 * The placeholder that replaces `User.email`.
 *
 * Derived from the new user id rather than being a constant, because
 * `User.email` is `@unique`: a fixed string would let exactly one account in the
 * database ever be erased, and every erasure after the first would fail on a
 * unique-constraint violation at the last step of an irreversible operation.
 */
export function erasedEmailFor(newUserId: string): string {
  return `${newUserId}@${ERASED_EMAIL_DOMAIN}`;
}
