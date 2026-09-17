/**
 * What a personal-data export contains, and what it deliberately does not.
 *
 * This file is the reviewable artifact for #1771 slice 2. The export service
 * reads it and nothing else: there is no "serialize every table" path, because
 * a naive dump of this schema would hand a raw ECDSA private key
 * (`SessionKey.agentPrivateKey`) to anyone who could call the endpoint, turning
 * a download button into a key-exfiltration API.
 *
 * Source of truth for coverage: `docs/engineering/personal-data-inventory.md`,
 * verified against `backend/prisma/schema.prisma`. The companion unit test
 * (`src/tests/personal_data_export_manifest.spec.ts`) drives itself from the
 * generated Prisma DMMF, so a model added to the schema fails the build until
 * someone classifies it here.
 *
 * ## The classification rule
 *
 * A model is **exported** when it carries at least one column holding one of
 * the five identifiers `PersonalDataResolverService` resolves: the user id, a
 * wallet/owner address, an artist id, the pseudonymous analytics actor id, or
 * a session id.
 *
 * A model is **not exported** when no column of its own names the person —
 * typically because it is reachable only by joining through a row that *is*
 * exported (a track hangs off a release, a tier off a campaign), because it is
 * operator infrastructure, or because its personal content belongs to somebody
 * else. Each such model states its reason below, in one sentence a reviewer
 * can check against the schema.
 */

/**
 * How a model is keyed to a person. Several models need more than one of
 * these; the service ORs them together.
 */
export type PersonalDataKey =
  /**
   * A column holding `User.id`. Nine models spell it something other than
   * `userId` — `authorId`, `reporterUserId`, `curatorUserId`, `creatorUserId`,
   * `submitterUserId`, `initiatorUserId`, `actorUserId`, `collectorUserId`,
   * `acknowledgedByUserId`/`revokedByUserId` — which is exactly why the column
   * name is declared per model rather than assumed.
   */
  | { kind: "userId"; column: string }
  /**
   * A column holding an Ethereum address. Matched against the union of the
   * person's smart-account addresses and the EOA owner addresses behind them:
   * different writers record whichever address signed, and both are the same
   * person. Compared case-insensitively — see the service for why.
   */
  | { kind: "address"; column: string }
  /** A column holding `Artist.id`. */
  | { kind: "artistId"; column: string }
  /** A column holding the pseudonymous analytics actor id. */
  | { kind: "actorId"; column: string }
  /** A column holding `Session.id` (the agent-session row, not a browser session). */
  | { kind: "sessionId"; column: string };

export interface ExportedModel {
  /** Prisma model name, as it appears in `Prisma.dmmf.datamodel.models`. */
  model: string;
  /**
   * Single-column primary key, used to order and cursor-paginate the model so
   * the export streams instead of buffering. Every exported model has one.
   */
  primaryKey: string;
  /** Key strategies, ORed together. */
  keys: PersonalDataKey[];
  /** Why this model holds the person's data, when it is not obvious. */
  note?: string;
}

/**
 * Every model whose rows are included in a person's export.
 *
 * Grouped to mirror the inventory's categories so the two can be diffed by eye.
 */
export const EXPORTED_MODELS: readonly ExportedModel[] = [
  // ---------------------------------------------------------------------
  // The account itself
  // ---------------------------------------------------------------------
  {
    model: "User",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "id" }],
    note: "The account row: email and signup date.",
  },
  {
    model: "AccountClosureRequest",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
    note:
      "Added by #1771 slice 3. The person's own request to close the account, the date it "
      + "becomes due and the reason they gave — their own words about their own account, and "
      + "the one record that tells them an erasure is scheduled.",
  },

  // ---------------------------------------------------------------------
  // Inventory category 1 — models with a declared User relation
  // ---------------------------------------------------------------------
  {
    model: "GenerationCreditAccount",
    primaryKey: "userId",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "GenerationCreditTransaction",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "GenerationCostRecord",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "Wallet",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityProfile",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityVisibilitySettings",
    primaryKey: "userId",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityBadge",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityRole",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityCohortMembership",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityBenefitRedemption",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityMembership",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "CommunityMessage",
    primaryKey: "id",
    // Not `userId`: the author column is `authorId`.
    keys: [{ kind: "userId", column: "authorId" }],
  },
  {
    model: "CommunityModerationReport",
    primaryKey: "id",
    // Not `userId`: the reporter column is `reporterUserId`.
    keys: [{ kind: "userId", column: "reporterUserId" }],
    note: "Reports this person filed. Reports filed about them belong to the reporter.",
  },
  {
    model: "PasskeyIdentity",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
    note: "Existence of a passkey identity; the key hash itself is redacted.",
  },
  {
    model: "Artist",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "StemQualityRating",
    primaryKey: "id",
    // Not `userId`: the curator column is `curatorUserId`.
    keys: [{ kind: "userId", column: "curatorUserId" }],
  },
  {
    model: "RemixProject",
    primaryKey: "id",
    // Not `userId`: the creator column is `creatorUserId`.
    keys: [{ kind: "userId", column: "creatorUserId" }],
  },
  {
    model: "Session",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "AgentSignal",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "AnalyticsConsent",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
    note:
      "Added by #1772 after the inventory was written; it is the record of the "
      + "person's own consent decision and belongs in their export.",
  },
  {
    model: "ListenerTasteMemorySettings",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "ListenerTasteSignalControl",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "Playlist",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "SavedPlaylist",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "Folder",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "AgentConfig",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
    note: "The person's agent settings and learned taste profile; identity credential redacted.",
  },
  {
    model: "AgentReputationFeedback",
    primaryKey: "id",
    // Not `userId`: the submitter column is `submitterUserId`.
    keys: [{ kind: "userId", column: "submitterUserId" }],
    note: "Feedback this person submitted. Feedback about their agent is another person's statement.",
  },
  {
    model: "SessionKey",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
    note:
      "Existence, validity window and revocation status of each agent session "
      + "key, so a person can see what was authorized on their behalf. The key "
      + "material itself never leaves the backend.",
  },
  {
    model: "LibraryTrack",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "ShowCampaignDispute",
    primaryKey: "id",
    // Not `userId`: the initiator column is `initiatorUserId`.
    keys: [{ kind: "userId", column: "initiatorUserId" }],
  },
  {
    model: "ShowPledge",
    primaryKey: "id",
    keys: [
      { kind: "userId", column: "userId" },
      // A pledge can be made from a wallet before the row is linked to an
      // account, so the address has to be matched too.
      { kind: "address", column: "walletAddress" },
    ],
  },
  {
    model: "ShowCampaignEvent",
    primaryKey: "id",
    keys: [
      // Not `userId`: the actor column is `actorUserId`.
      { kind: "userId", column: "actorUserId" },
      { kind: "address", column: "actorWalletAddress" },
    ],
  },
  {
    model: "PunchlineCollectible",
    primaryKey: "id",
    keys: [
      // Not `userId`: the collector column is `collectorUserId`.
      { kind: "userId", column: "collectorUserId" },
      { kind: "address", column: "collectorWallet" },
    ],
  },
  {
    model: "RecommendationProfile",
    primaryKey: "userId",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "PunchlineUnlockGrant",
    primaryKey: "id",
    // Not `userId`: the collector column is `collectorUserId`.
    keys: [{ kind: "userId", column: "collectorUserId" }],
  },

  // ---------------------------------------------------------------------
  // Inventory category 2a — a dangling userId, with no relation and so no
  // cascade. These are the rows that outlive a deleted account.
  // ---------------------------------------------------------------------
  {
    model: "SignupFaucetAttempt",
    primaryKey: "id",
    keys: [
      { kind: "userId", column: "userId" },
      { kind: "address", column: "walletAddress" },
    ],
  },
  {
    model: "AgentTransaction",
    primaryKey: "id",
    keys: [
      { kind: "userId", column: "userId" },
      { kind: "sessionId", column: "sessionId" },
    ],
  },
  {
    model: "WebAuthnCredential",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
    note:
      "Authentication material with a dangling userId. Exported as existence "
      + "only — name, relying party, created date — so a person can see which "
      + "passkeys are registered without the export carrying the key.",
  },
  {
    model: "KeyAuditLog",
    primaryKey: "id",
    keys: [{ kind: "userId", column: "userId" }],
  },
  {
    model: "ShowEscrowReconciliationAcknowledgement",
    primaryKey: "id",
    keys: [
      { kind: "userId", column: "acknowledgedByUserId" },
      { kind: "userId", column: "revokedByUserId" },
    ],
    note: "Operator action record; two distinct actor columns, either of which may be this person.",
  },

  // ---------------------------------------------------------------------
  // Inventory category 2b — keyed by wallet address only
  // ---------------------------------------------------------------------
  {
    model: "Notification",
    primaryKey: "id",
    keys: [{ kind: "address", column: "walletAddress" }],
  },
  {
    model: "NotificationPreference",
    primaryKey: "walletAddress",
    keys: [{ kind: "address", column: "walletAddress" }],
  },
  {
    model: "CuratorReputation",
    primaryKey: "id",
    keys: [{ kind: "address", column: "walletAddress" }],
  },

  // ---------------------------------------------------------------------
  // Inventory category 2c — mirrors of on-chain records. Included in an
  // export (a person is entitled to their own transaction history) even
  // though erasure deliberately retains them.
  // ---------------------------------------------------------------------
  {
    model: "StemNftMint",
    primaryKey: "id",
    keys: [{ kind: "address", column: "creatorAddress" }],
  },
  {
    model: "StemListing",
    primaryKey: "id",
    keys: [{ kind: "address", column: "sellerAddress" }],
  },
  {
    model: "StemListingIntent",
    primaryKey: "id",
    keys: [{ kind: "address", column: "sellerAddress" }],
  },
  {
    model: "StemPurchase",
    primaryKey: "id",
    keys: [{ kind: "address", column: "buyerAddress" }],
  },
  {
    model: "RoyaltyPayment",
    primaryKey: "id",
    keys: [{ kind: "address", column: "recipientAddress" }],
  },
  {
    model: "X402Settlement",
    primaryKey: "id",
    keys: [{ kind: "address", column: "payerAddress" }],
  },
  {
    model: "ShowCampaign",
    primaryKey: "id",
    keys: [
      { kind: "artistId", column: "artistId" },
      { kind: "address", column: "beneficiaryAddress" },
    ],
  },
  {
    model: "ContentProtectionStake",
    primaryKey: "id",
    keys: [{ kind: "address", column: "stakerAddress" }],
  },
  {
    model: "ContentAttestation",
    primaryKey: "id",
    keys: [{ kind: "address", column: "attesterAddress" }],
  },
  {
    model: "TrustedSource",
    primaryKey: "id",
    keys: [{ kind: "address", column: "createdByAddress" }],
  },
  {
    model: "TrustedSourceLinkRequest",
    primaryKey: "id",
    keys: [
      { kind: "artistId", column: "artistId" },
      { kind: "address", column: "requesterAddress" },
    ],
  },
  {
    model: "ReleaseRightsUpgradeRequest",
    primaryKey: "id",
    keys: [
      { kind: "artistId", column: "artistId" },
      { kind: "address", column: "requestedByAddress" },
    ],
  },
  {
    model: "RightsRouteReassessment",
    primaryKey: "id",
    keys: [{ kind: "address", column: "actorAddress" }],
  },
  {
    model: "RightsEvidenceBundle",
    primaryKey: "id",
    keys: [{ kind: "address", column: "submittedByAddress" }],
  },
  {
    model: "RightsEvidence",
    primaryKey: "id",
    keys: [{ kind: "address", column: "submittedByAddress" }],
  },
  {
    model: "Dispute",
    primaryKey: "id",
    keys: [
      { kind: "address", column: "reporterAddr" },
      { kind: "address", column: "creatorAddr" },
    ],
    note:
      "Not named in the inventory's category 2c, but both `reporterAddr` and "
      + "`creatorAddr` are wallet addresses and therefore personal data. Added "
      + "here on verification against the schema.",
  },
  {
    model: "DisputeEvidence",
    primaryKey: "id",
    keys: [{ kind: "address", column: "submitter" }],
    note: "`submitter` is a wallet address. Also missing from the inventory's list.",
  },
  {
    model: "DisputeJurorAssignment",
    primaryKey: "id",
    keys: [{ kind: "address", column: "jurorAddr" }],
    note: "Jury service by wallet address. Also missing from the inventory's list.",
  },

  // ---------------------------------------------------------------------
  // Inventory category 2d — analytics, keyed by the pseudonymous actor id
  // ---------------------------------------------------------------------
  {
    model: "AnalyticsEvent",
    primaryKey: "id",
    // `actorId` is NOT always the pseudonymous hash, which this manifest
    // originally assumed and which the inventory still asserts.
    // `analytics_domain_event_bridge.service.ts` declares
    // `actorIdKeys: ["userId"]` (and `subjectIdKeys: ["userId"]`) for around
    // twenty event types, and `recordConfiguredDomainEvent` passes that value
    // straight through — nothing on the ingest path pseudonymizes it. So these
    // columns hold the raw `User.id`, which for a wallet or passkey account is
    // the person's wallet address. One bridge config keys on `resolverAddress`,
    // an address outright.
    //
    // Matching only the derived actor id therefore missed a person's own
    // server-emitted analytics entirely while reporting a complete export.
    // All three forms are matched, and the address form case-insensitively,
    // because different writers record whichever casing they were handed.
    //
    // `AnalyticsEvent.sessionId` is still deliberately absent: it is a browser
    // playback/product session identifier, not a `Session.id`, so matching it
    // against the resolved session ids would be a category error.
    keys: [
      { kind: "actorId", column: "actorId" },
      { kind: "userId", column: "actorId" },
      { kind: "userId", column: "subjectId" },
      { kind: "address", column: "actorId" },
    ],
  },
  {
    model: "AnalyticsGovernanceLog",
    primaryKey: "id",
    // Same three forms as `AnalyticsEvent`: the governance log copies the
    // identifiers of the events it records, so it inherits their shape.
    keys: [
      { kind: "actorId", column: "actorId" },
      { kind: "userId", column: "actorId" },
      { kind: "userId", column: "subjectId" },
      { kind: "address", column: "actorId" },
    ],
  },

  // ---------------------------------------------------------------------
  // Keyed by artistId or by the agent session — the person's own creative
  // and session records.
  // ---------------------------------------------------------------------
  {
    model: "Release",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
    note: "Releases this person published as an artist. Binary artwork is redacted for size.",
  },
  {
    model: "ReleaseArtistCredit",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
    note: "Credits naming this person on any release, including other artists' releases.",
  },
  {
    model: "CreatorTrust",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
    note: "The trust tier we assign to this artist — a judgement about them, so theirs to see.",
  },
  {
    model: "CommunityBenefitRule",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
  },
  {
    model: "CommunityRoom",
    primaryKey: "id",
    keys: [
      { kind: "artistId", column: "artistId" },
      // `ownerType`/`ownerId` is polymorphic; matching the uuid is unambiguous
      // because user, artist and campaign ids never collide.
      { kind: "userId", column: "ownerId" },
    ],
  },
  {
    model: "CommunityDiscordBridge",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
    note: "The artist's own Discord integration; the webhook URL is a bearer credential and is redacted.",
  },
  {
    model: "TrustedSourceArtistLink",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
  },
  {
    model: "PunchlineDrop",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
  },
  {
    model: "ArtistEngagement",
    primaryKey: "id",
    keys: [{ kind: "artistId", column: "artistId" }],
    note: "Aggregate engagement computed about this artist.",
  },
  {
    model: "License",
    primaryKey: "id",
    keys: [{ kind: "sessionId", column: "sessionId" }],
  },
  {
    model: "Payment",
    primaryKey: "id",
    keys: [{ kind: "sessionId", column: "sessionId" }],
  },
];

/**
 * Models deliberately left out of an export, each with the reason.
 *
 * "Reachable only through X" is the commonest reason: the model has no column
 * naming the person, and the row that does name them is exported, so the link
 * is visible in the export even though the leaf row is not.
 */
export const NOT_EXPORTED_MODELS: Readonly<Record<string, string>> = {
  // Catalogue and content records, keyed to a work rather than to a person.
  Track: "Catalogue record keyed by releaseId; the person's authorship is exported through Release and ReleaseArtistCredit.",
  TrackEmbedding: "Machine-generated similarity vector keyed by trackId, with no column naming a person.",
  Stem: "Audio component keyed by trackId; it names no person and carries the audio blob itself.",
  StemPricing: "Price configuration keyed by stemId, reachable only through a stem.",
  AudioFingerprint: "Acoustic fingerprint of a track, keyed by trackId and naming no person.",
  PunchlineMoment: "Clip definition keyed by dropId; the drop is exported and the collectible grants are exported.",
  PunchlineUnlock: "Reward rule keyed by dropId; the person's grants are exported as PunchlineUnlockGrant.",
  RemixProjectStem: "Track-layer rows keyed by remixProjectId, reachable only through the exported RemixProject.",
  ShowCampaignVisual: "Campaign imagery keyed by campaignId, reachable only through the exported ShowCampaign.",
  ShowCampaignTier: "Pledge tier definitions keyed by campaignId, reachable only through the exported ShowCampaign.",
  CommunityCohort: "A group definition, not a person; this person's place in it is exported as CommunityCohortMembership.",
  CommunityDiscordRoleMapping: "Role mapping keyed by bridgeId, reachable only through the exported CommunityDiscordBridge.",
  CommunityDiscordSyncAttempt: "Delivery attempt log keyed by bridgeId, reachable only through the exported CommunityDiscordBridge.",
  TrackPopularity: "Aggregate popularity of a track across all listeners; no individual is identifiable in it.",

  // Someone else's personal data.
  DmcaReport:
    "A takedown notice keyed by trackId whose personal content — claimant name and email — belongs to the reporter, not to the person exporting.",

  // Operator and indexer infrastructure.
  IndexerState: "Per-chain block cursor for the indexer; operator infrastructure with no personal column.",
  ShowEscrowIndexerState:
    "Per-chain escrow indexer cursor and worker lease; `feeRecipient` is the platform's address and `leaseOwnerId` is a worker process id, not a person.",
  ContractEvent:
    "Raw indexed chain log keyed by contract address and block position; a person's address appears only inside the untyped `args` JSON, and their transactions are exported through the typed mirrors (StemPurchase, RoyaltyPayment, StemListing, X402Settlement).",
  ShowCampaignEscrowEvent:
    "Raw indexed escrow log keyed by contract address and block position; the person's pledges and campaign history are exported through ShowPledge, ShowCampaign and ShowCampaignEvent.",
};

/**
 * Fields on exported models that must never leave the server, and why.
 *
 * The service builds its Prisma `select` from the DMMF minus these, so a
 * redacted column is never read out of the database in the first place —
 * redaction is not a filter applied to a row that already exists in memory.
 */
export const REDACTED_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  SessionKey: {
    agentPrivateKey:
      "A raw ECDSA private key. The schema comment says it never leaves the backend; an export that included it would let anyone who obtained the file spend from the person's agent.",
    approvalData:
      "Serialized permission approval signed by the person's passkey — replayable authorization material, not a description of what was authorized (`permissions` covers that).",
  },
  AgentConfig: {
    identityCredential:
      "The agent's identity credential document; a bearer artifact that would let a holder impersonate the agent.",
  },
  WebAuthnCredential: {
    publicKey: "Raw authenticator public key material, of no use to the person and of use to an attacker correlating devices.",
    counter: "Authenticator signature counter — anti-replay state, not information about the person.",
    credentialId: "The authenticator handle used to look the credential up; exported as existence only via passkeyName and rpId.",
  },
  PasskeyIdentity: {
    publicKeyHash:
      "The hash the account is derived and looked up by; publishing it would expose the link between a passkey and the smart account it controls.",
  },
  Wallet: {
    salt: "Smart-account derivation material: address derivation depends on it, so it is treated as account-control material rather than a description of the account.",
  },
  CommunityDiscordBridge: {
    webhookUrl:
      "A Discord webhook URL is a bearer credential — anyone holding it can post to the artist's server. `webhookUrlMasked` is exported instead.",
  },
  Release: {
    artworkData:
      "The artwork image bytes. Omitted for size, not secrecy: `artworkUrl` locates the same image and base64 blobs would make the export unusable.",
  },
};

/**
 * Field-name patterns that make the manifest test demand an explicit decision.
 *
 * Chosen for the shapes that have actually leaked from data exports elsewhere:
 * key material, bearer credentials, shared secrets, and derivation inputs. The
 * set is deliberately broader than the fields that exist today, so a future
 * column named `apiKey` or `sessionSecret` on an exported model fails the test
 * rather than shipping.
 *
 * `token` and `counter` match a great deal of legitimate on-chain vocabulary
 * (`tokenId`, `paymentToken`, `counterStakeAmount`). Those are not exempted by
 * pattern — they are listed one by one in REVIEWED_SAFE_FIELDS, so the
 * judgement is recorded rather than inferred.
 */
export const SENSITIVE_FIELD_NAME_PATTERNS: readonly RegExp[] = [
  /private/i, // raw key material
  /secret/i,
  /password/i,
  /credential/i, // WebAuthn and agent identity credentials
  /token/i, // bearer tokens — and, unavoidably, ERC-1155 token ids
  /salt/i, // account-derivation material
  /publickey/i,
  /ciphertext|encrypt/i,
  /approv/i, // signed approvals and the audit trail around them
  /counter/i, // authenticator counters — and dispute counter-stakes
  /webhook/i, // webhook URLs are bearer credentials
  /api[-_]?key/i,
];

/**
 * Fields that match a sensitive-name pattern but are safe to export, with the
 * reason each one is safe. Reviewed individually; this list is the record of
 * that review.
 */
export const REVIEWED_SAFE_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  StemNftMint: { tokenId: "ERC-1155 token id of a public mint, not a credential." },
  StemListing: {
    tokenId: "ERC-1155 token id of a public listing.",
    paymentToken: "The ERC-20 contract address payment was denominated in.",
  },
  StemListingIntent: {
    tokenId: "ERC-1155 token id of a pending listing.",
    paymentToken: "The ERC-20 contract address payment was denominated in.",
  },
  StemPurchase: { paymentToken: "The ERC-20 contract address payment was denominated in." },
  RoyaltyPayment: {
    tokenId: "ERC-1155 token id the royalty was paid on.",
    paymentToken: "The ERC-20 contract address payment was denominated in.",
  },
  X402Settlement: {
    listingTokenId: "ERC-1155 token id of the settled listing.",
    paymentToken: "The ERC-20 contract address payment was denominated in.",
  },
  ContentProtectionStake: {
    tokenId: "ERC-1155 token id the stake protects.",
    paymentToken: "The ERC-20 contract address the stake was denominated in.",
  },
  ContentAttestation: { tokenId: "ERC-1155 token id the attestation covers." },
  AgentTransaction: { tokenId: "ERC-1155 token id the agent transacted on." },
  LibraryTrack: { tokenId: "ERC-1155 token id of a stem the person owns." },
  StemQualityRating: { curatorIdentityTokenId: "The curator agent's on-chain identity NFT id, a public identifier." },
  AgentConfig: { identityTokenId: "The agent's on-chain identity NFT id, a public identifier." },
  ShowCampaign: {
    paymentTokenAddress: "The ERC-20 contract address the campaign is denominated in.",
    authorityCredentialId: "A reference to an artist-authority record, not the credential itself.",
    approvedTermsHash: "A tamper-evidence hash of publicly displayed campaign terms.",
  },
  ShowPledge: { paymentTokenAddress: "The ERC-20 contract address the pledge is denominated in." },
  Dispute: {
    tokenId: "ERC-1155 token id the dispute concerns.",
    counterStake: "The wei amount the creator staked to contest — a financial fact of the person's own dispute.",
    counterStakeToken: "The ERC-20 contract address the counter-stake was denominated in.",
    counterStakeAssetId: "Canonical asset identifier for the counter-stake.",
    counterStakeAssetSymbol: "Display symbol for the counter-stake asset.",
    counterStakeAssetDecimals: "Decimal precision for the counter-stake asset.",
    counterStakeAmount: "Counter-stake amount in asset units.",
    counterStakeAmountUnits: "Counter-stake amount in base units.",
    counterStakeAmountUsd: "Counter-stake amount converted to USD.",
    appealStakeToken: "The ERC-20 contract address an appeal stake was denominated in.",
  },
  TrustedSourceArtistLink: {
    approvedBy: "The reviewer handle that approved the link — part of the decision record shown to the artist.",
    approvedAt: "When the link was approved.",
  },
  CommunityDiscordBridge: {
    webhookUrlMasked: "The deliberately masked form, which exists so the URL can be displayed without disclosing it.",
  },
};
