export interface BaseEvent {
  eventName: string;
  eventVersion: number;
  occurredAt: string;
}

export interface StemsUploadedEvent extends BaseEvent {
  eventName: "stems.uploaded";
  releaseId: string;
  artistId: string;
  checksum: string;
  sourceType?: string;
  artworkData?: Buffer;
  artworkMimeType?: string;
  metadata?: {
    type?: string;
    title?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
    moods?: string[];
    label?: string;
    releaseDate?: string;
    explicit?: boolean;
    tracks?: Array<{
      title: string;
      artist?: string;
      position: number;
      isrc?: string;
      explicit?: boolean;
      stems: Array<{
        id: string;
        uri: string;
        type: string;
        buffer?: Buffer;
        mimetype?: string;
        durationSeconds?: number;
      }>;
    }>;
  };
}

export interface StemsProcessedEvent extends BaseEvent {
  eventName: "stems.processed";
  releaseId: string;
  artistId: string;
  modelVersion: string;
  metadata?: any;
  tracks: Array<{
    id: string;
    title: string;
    artist?: string;
    position: number;
    stems: Array<{
      id: string;
      uri: string;
      type: string;
      data?: Buffer;
      mimeType?: string;
      durationSeconds?: number;
      /** Sanitized worker-measured musical features (#1184), null when extraction failed. */
      audioFeatures?: unknown | null;
      isEncrypted?: boolean;
      encryptionMetadata?: string;
      storageProvider?: string;
    }>;
  }>;
}

export interface StemsProgressEvent extends BaseEvent {
  eventName: "stems.progress";
  releaseId: string;
  trackId: string;
  progress: number;
}

export interface StemsFailedEvent extends BaseEvent {
  eventName: "stems.failed";
  releaseId: string;
  artistId: string;
  error: string;
}

export interface IpNftMintedEvent extends BaseEvent {
  eventName: "ipnft.minted";
  stemId: string;
  tokenId: string;
  chainId: number;
  txHash: string;
}

export interface RemixCreatedEvent extends BaseEvent {
  eventName: "remix.created";
  remixId: string;
  creatorId: string;
  sourceTrackId: string;
  stemIds: string[];
  title: string;
  txHash?: string;
}

export interface RemixProjectCreatedEvent extends BaseEvent {
  eventName: "remix.project_created";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  stemIds: string[];
  mode: string;
  /** Creator owns the source artist profile (#1174) — not buyer demand. */
  creatorOwner?: boolean;
  policyVersion: string;
}

export interface RemixPolicyRejectedEvent extends BaseEvent {
  eventName: "remix.policy_rejected";
  creatorId: string;
  sourceTrackId: string;
  stemIds: string[];
  reasonCodes: string[];
  policyVersion: string;
}

export interface RemixLicenseRequiredEvent extends BaseEvent {
  eventName: "remix.license_required";
  creatorId: string;
  sourceTrackId: string;
  stemIds: string[];
  requiredLicense: string;
  policyVersion: string;
}

export interface RemixGenerationStartedEvent extends BaseEvent {
  eventName: "remix.generation_started";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  provider: string;
  generationJobId: string;
  mode: string;
  /** stem_audio | stem_plus_ai | audio_conditioned | feature_conditioned | prompt_only. */
  grounding: string;
  /** AI integrity (#1164): true when grounding !== "stem_audio". */
  aiGenerated: boolean;
  policyVersion: string;
}

export interface RemixGenerationCompletedEvent extends BaseEvent {
  eventName: "remix.generation_completed";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  provider: string;
  generationJobId: string;
  mode: string;
  /** stem_audio | stem_plus_ai | audio_conditioned | feature_conditioned | prompt_only. */
  grounding: string;
  /** AI integrity (#1164): true when grounding !== "stem_audio". */
  aiGenerated: boolean;
  policyVersion: string;
}

export interface RemixGenerationFailedEvent extends BaseEvent {
  eventName: "remix.generation_failed";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  generationJobId: string;
  errorCode: string;
  /** stem_audio | stem_plus_ai | audio_conditioned | feature_conditioned | prompt_only. */
  grounding: string;
  /** AI integrity (#1164): true when grounding !== "stem_audio". */
  aiGenerated: boolean;
  policyVersion: string;
}

/**
 * Security/audit events (#1214): a backend render decrypted (or was denied
 * decrypting) one or more encrypted source stems. Deliberately compact — they
 * carry only project/creator/source identifiers, the internal purpose, the
 * outcome, and the encrypted-stem count. They MUST NOT include stem bytes,
 * encryption metadata, keys, storage URIs, prompts, or provider error bodies.
 * Not wired into the analytics bridge: these are audit signals, not product
 * analytics.
 */
export interface RemixEncryptedRenderAuthorizedEvent extends BaseEvent {
  eventName: "remix.encrypted_render_authorized";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  generationJobId: string;
  /** Internal decrypt purpose, e.g. "remix-render-authorized". */
  purpose: string;
  /** How many active source stems were encrypted for this render. */
  encryptedStemCount: number;
}

export interface RemixEncryptedRenderDeniedEvent extends BaseEvent {
  eventName: "remix.encrypted_render_denied";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  generationJobId: string;
  purpose: string;
  encryptedStemCount: number;
  /** Coarse reason code, e.g. "ineligible" — never a raw provider/error body. */
  reason: string;
}

/**
 * Security/ops audit event (#948): the ShowCampaignEscrow indexer found
 * on-chain state with no matching backend record (no bound campaign, or an
 * on-chain pledge with no backend intent). Carries only identifiers + a coarse
 * reason — never secrets. Not wired into product analytics.
 */
export interface ShowCampaignReconciliationMismatchEvent extends BaseEvent {
  eventName: "shows.campaign_reconciliation_mismatch";
  contractCampaignId: string;
  escrowEventName: string;
  transactionHash: string;
  blockNumber: string;
  reason: string;
}

export interface ShowCampaignSettledEvent extends BaseEvent {
  eventName: "shows.campaign_settled";
  campaignId: string;
  campaignSlug: string;
  artistId?: string;
  contractCampaignId: string;
  settlementStage: "deposit" | "final";
  grossAmountUnits: string;
  feeAmountUnits: string;
  netAmountUnits: string;
  feeBps?: number;
  totalFeePaidUnits: string;
  paymentAssetSymbol: string;
  paymentAssetDecimals: number;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface RemixPublishedEvent extends BaseEvent {
  eventName: "remix.published";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  /** Source-track artist (#1121): cockpit facts aggregate under this id. */
  artistId?: string;
  releaseId: string;
  trackId: string;
  mode: string;
  /** stem_audio | stem_plus_ai | audio_conditioned | feature_conditioned | prompt_only. */
  grounding: string;
  /** AI integrity (#1164): true when grounding !== "stem_audio". */
  aiGenerated: boolean;
  /** Creator owns the source artist profile (#1174) — not buyer demand. */
  creatorOwner?: boolean;
  policyVersion: string;
}

export interface RemixExportedEvent extends BaseEvent {
  eventName: "remix.exported";
  remixProjectId: string;
  creatorId: string;
  sourceTrackId: string;
  mode: string;
  /** stem_audio | stem_plus_ai | audio_conditioned | feature_conditioned | prompt_only. */
  grounding: string;
  /** AI integrity (#1164): true when grounding !== "stem_audio". */
  aiGenerated: boolean;
  policyVersion: string;
}

export interface ArtistRemixConsentUpdatedEvent extends BaseEvent {
  eventName: "artist.remix_consent_updated";
  artistId: string;
  userId: string;
  previous: "allowed" | "disabled";
  next: "allowed" | "disabled";
}

export interface RecommendationPreferencesUpdatedEvent extends BaseEvent {
  eventName: "recommendation.preferences_updated";
  userId: string;
  preferences: Record<string, unknown>;
}

export interface RecommendationGeneratedEvent extends BaseEvent {
  eventName: "recommendation.generated";
  userId: string;
  trackIds: string[];
  strategy: string;
  cohortInfluence?: CohortInfluenceEventSummary;
}

export interface TasteMemorySettingsUpdatedEvent extends BaseEvent {
  eventName: "taste_memory.settings_updated";
  userId: string;
  settings: Record<string, unknown>;
}

export interface TasteMemorySignalHiddenEvent extends BaseEvent {
  eventName: "taste_memory.signal_hidden";
  userId: string;
  signalType: string;
  value: string;
  action: string;
}

export interface TasteMemorySignalDownrankedEvent extends BaseEvent {
  eventName: "taste_memory.signal_downranked";
  userId: string;
  signalType: string;
  value: string;
  action: string;
}

export interface TasteMemorySignalRestoredEvent extends BaseEvent {
  eventName: "taste_memory.signal_restored";
  userId: string;
  signalType: string;
  value: string;
  action: string;
}

export interface TasteMemoryResetEvent extends BaseEvent {
  eventName: "taste_memory.reset";
  userId: string;
  resetAt: string | null;
}

export interface CommunityProfileVisibilityUpdatedEvent extends BaseEvent {
  eventName: "community.profile_visibility_updated";
  userId: string;
  profileVisibility: string;
}

export interface CommunityProfileShowcaseUpdatedEvent extends BaseEvent {
  eventName: "community.profile_showcase_updated";
  userId: string;
  changedFields: string[];
}

export interface CommunityOwnershipDisplayUpdatedEvent extends BaseEvent {
  eventName: "community.ownership_display_updated";
  userId: string;
  showWalletAddress: boolean;
  showOwnedItems: boolean;
}

export interface CommunityBenefitRedeemedEvent extends BaseEvent {
  eventName: "community.benefit_redeemed";
  userId: string;
  benefitRuleId: string;
  benefitType: string;
}

export interface CommunityBenefitRuleLifecycleEvent extends BaseEvent {
  eventName: "community.benefit_rule_created" | "community.benefit_rule_paused" | "community.benefit_rule_expired";
  actorId: string;
  artistId: string | null;
  benefitRuleId: string;
  benefitType: string;
  status: string;
}

export interface CommunityBadgeGrantedEvent extends BaseEvent {
  eventName: "community.badge_granted";
  userId: string;
  badgeType: string;
  sourceType: string;
  sourceId: string | null;
  campaignId?: string | null;
  artistId?: string | null;
  visibility: string;
}

export interface CommunityRoleGrantedEvent extends BaseEvent {
  eventName: "community.role_granted";
  userId: string;
  roleType: string;
  scopeType: string;
  scopeId: string | null;
  sourceType: string;
  sourceId: string | null;
  campaignId?: string | null;
  artistId?: string | null;
  visibility: string;
}

export interface CommunityArtistTabEnabledEvent extends BaseEvent {
  eventName: "community.artist_tab_enabled";
  userId: string;
  artistId: string;
}

export interface CommunityRoomJoinedEvent extends BaseEvent {
  eventName: "community.room_joined";
  userId: string;
  roomId: string;
  roomType: string;
  artistId?: string | null;
  campaignId?: string | null;
}

export interface CommunityCampaignRoomJoinedEvent extends BaseEvent {
  eventName: "community.campaign_room_joined";
  userId: string;
  campaignId: string;
  campaignSlug?: string | null;
  campaignStatus?: string | null;
  roomId: string;
  roomType: string;
  artistId?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface CommunityShowCityInterestJoinedEvent extends BaseEvent {
  eventName: "community.show_city_interest_joined";
  userId: string;
  campaignId: string;
  campaignSlug?: string | null;
  campaignStatus?: string | null;
  roomId: string;
  roomType: string;
  artistId?: string | null;
  city: string;
  country: string;
}

export interface CommunityCampaignUpdateViewedEvent extends BaseEvent {
  eventName: "community.campaign_update_viewed";
  userId: string;
  campaignId: string;
  campaignSlug?: string | null;
  campaignStatus?: string | null;
  roomId: string;
  roomType: string;
  artistId?: string | null;
  latestMessageId: string;
  visibleUpdateCount: number;
  city?: string | null;
  country?: string | null;
}

export interface CommunityRoomLeftEvent extends BaseEvent {
  eventName: "community.room_left";
  userId: string;
  roomId: string;
  roomType: string;
  artistId?: string | null;
  campaignId?: string | null;
}

export interface CommunityRoomAccessDeniedEvent extends BaseEvent {
  eventName: "community.room_access_denied";
  userId: string;
  roomId: string;
  roomType: string;
  artistId?: string | null;
  campaignId?: string | null;
  reason: string;
}

export interface CommunityMessageCreatedEvent extends BaseEvent {
  eventName: "community.message_created";
  userId: string;
  roomId: string;
  messageId: string;
  messageType: string;
  artistId?: string | null;
  campaignId?: string | null;
  campaignSlug?: string | null;
  campaignStatus?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface CommunityMessageReportedEvent extends BaseEvent {
  eventName: "community.message_reported";
  userId: string;
  roomId: string;
  messageId: string;
  reportId: string;
  campaignId?: string | null;
}

export interface CommunityMessageDeletedEvent extends BaseEvent {
  eventName: "community.message_deleted";
  userId: string;
  roomId: string;
  messageId: string;
  campaignId?: string | null;
}

export interface CommunityMemberModeratedEvent extends BaseEvent {
  eventName: "community.member_moderated";
  userId: string;
  roomId: string;
  targetUserId: string;
  action: string;
}

export interface CommunityModerationActionTakenEvent extends BaseEvent {
  eventName: "community.moderation_action_taken";
  userId: string;
  reportId: string;
  roomId: string;
  messageId?: string | null;
  action: string;
  outcome: string;
  hasOperatorNote: boolean;
}

export interface CommunityRoomStatusUpdatedEvent extends BaseEvent {
  eventName: "community.room_status_updated";
  userId: string;
  roomId: string;
  status: string;
}

export interface CommunityDiscordBridgeConnectedEvent extends BaseEvent {
  eventName: "community.discord_bridge_connected";
  actorId: string;
  artistId: string;
  publicLinkEnabled: boolean;
  announcementMirrorEnabled: boolean;
  roleSyncEnabled: boolean;
}

export interface CommunityDiscordAnnouncementMirroredEvent extends BaseEvent {
  eventName: "community.discord_announcement_mirrored";
  actorId: string;
  artistId: string;
  roomId: string;
  messageId: string;
  attemptId: string;
  status: string;
}

export interface CommunityDiscordRoleSyncCompletedEvent extends BaseEvent {
  eventName: "community.discord_role_sync_completed";
  actorId: string;
  artistId: string;
  mappingCount: number;
  status: string;
  reason: string;
}

export interface CommunityDiscordRoleSyncFailedEvent extends BaseEvent {
  eventName: "community.discord_role_sync_failed";
  actorId: string;
  artistId: string;
  mappingCount: number;
  status: string;
  reason: string;
}

export interface CommunityCohortSuggestedEvent extends BaseEvent {
  eventName: "community.cohort_suggested";
  userId: string;
  cohortId: string;
  cohortType: string;
  reasonCode: string;
  membershipStatus: string;
  minimumSize: number;
  visibleMemberCount: number;
}

export interface CommunityCohortJoinedEvent extends BaseEvent {
  eventName: "community.cohort_joined";
  userId: string;
  cohortId: string;
  cohortType: string;
  reasonCode: string;
  membershipStatus: string;
  minimumSize: number;
  visibleMemberCount: number;
}

export interface CommunityCohortLeftEvent extends BaseEvent {
  eventName: "community.cohort_left";
  userId: string;
  cohortId: string;
  cohortType: string;
  reasonCode: string;
  membershipStatus: string;
  minimumSize: number;
  visibleMemberCount: number;
}

export interface CommunityCohortHiddenEvent extends BaseEvent {
  eventName: "community.cohort_hidden";
  userId: string;
  cohortId: string;
  cohortType: string;
  reasonCode: string;
  membershipStatus: string;
  minimumSize: number;
  visibleMemberCount: number;
}

export interface IdentityAuthenticatedEvent extends BaseEvent {
  eventName: "identity.authenticated";
  userId: string;
  role: string;
  authMode?: string;
  requestedChainId?: number;
  verifiedChainId: number;
  signupFaucetSent: boolean;
}

export interface PlaylistCreatedEvent extends BaseEvent {
  eventName: "playlist.created";
  userId: string;
  playlistId: string;
  folderId?: string | null;
  trackCount: number;
}

export interface PlaylistUpdatedEvent extends BaseEvent {
  eventName: "playlist.updated";
  userId: string;
  playlistId: string;
  folderId?: string | null;
  changedFields: string[];
  trackCount: number;
}

export interface PlaylistDeletedEvent extends BaseEvent {
  eventName: "playlist.deleted";
  userId: string;
  playlistId: string;
  trackCount: number;
}

export interface PlaylistTrackAddedEvent extends BaseEvent {
  eventName: "playlist.track_added";
  userId: string;
  playlistId: string;
  trackIds: string[];
  addedCount: number;
  trackCount: number;
}

export interface PlaylistTrackRemovedEvent extends BaseEvent {
  eventName: "playlist.track_removed";
  userId: string;
  playlistId: string;
  trackIds: string[];
  removedCount: number;
  trackCount: number;
}

export interface PlaylistVisibilityChangedEvent extends BaseEvent {
  eventName: "playlist.visibility_changed";
  userId: string;
  playlistId: string;
  previousVisibility: string;
  nextVisibility: string;
  trackCount: number;
}

export interface PlaylistSavedToLibraryEvent extends BaseEvent {
  eventName: "playlist.saved_to_library";
  // The user saving the playlist into their library.
  userId: string;
  savedPlaylistId: string;
  sourcePlaylistId: string;
  // The user who owns the source playlist.
  sourceUserId: string;
}

export interface PlaylistRemovedFromLibraryEvent extends BaseEvent {
  eventName: "playlist.removed_from_library";
  userId: string;
  savedPlaylistId: string;
  sourcePlaylistId: string;
}

export interface CuratorStakedEvent extends BaseEvent {
  eventName: "curator.staked";
  curatorId: string;
  amountUsd: number;
}

export interface CuratorReportedEvent extends BaseEvent {
  eventName: "curator.reported";
  reportId: string;
  curatorId: string;
  trackId: string;
  reason: string;
}

export interface CatalogUpdatedEvent extends BaseEvent {
  eventName: "catalog.updated";
  trackId: string;
  status: string;
  version: number;
}

export interface CatalogReleaseReadyEvent extends BaseEvent {
  eventName: "catalog.release_ready";
  releaseId: string;
  artistId: string;
  metadata?: any;
}

export interface CatalogTrackStatusEvent extends BaseEvent {
  eventName: "catalog.track_status";
  releaseId: string;
  trackId: string;
  status: 'pending' | 'separating' | 'encrypting' | 'storing' | 'complete' | 'failed';
  error?: string;
}

export interface SessionStartedEvent extends BaseEvent {
  eventName: "session.started";
  sessionId: string;
  userId: string;
  budgetCapUsd: number;
  preferences: Record<string, unknown>;
}

export interface LicenseGrantedEvent extends BaseEvent {
  eventName: "license.granted";
  licenseId: string;
  type: "personal" | "remix" | "commercial";
  priceUsd: number;
  sessionId: string;
  trackId: string;
  artistId?: string;
  releaseId?: string;
  title?: string;
}

export interface SessionEndedEvent extends BaseEvent {
  eventName: "session.ended";
  sessionId: string;
  spentTotalUsd: number;
  reason: string;
}

export interface AgentTrackSelectedEvent extends BaseEvent {
  eventName: "agent.track_selected";
  sessionId: string;
  trackId: string;
  strategy: string;
  preferences: Record<string, unknown>;
  cohortInfluence?: CohortInfluenceEventSummary;
}

export interface AgentDecisionMadeEvent extends BaseEvent {
  eventName: "agent.decision_made";
  sessionId: string;
  trackId?: string;
  trackCount?: number;
  totalSpend?: number;
  licenseType?: "personal" | "remix" | "commercial";
  priceUsd?: number;
  reason: string;
  reasoning?: string;
  latencyMs?: number;
  /** Number of AI generations triggered during this session */
  generationsUsed?: number;
  /** Total USD spent on AI generation */
  generationSpendUsd?: number;
}

export interface AgentGenerationTriggeredEvent extends BaseEvent {
  eventName: "agent.generation_triggered";
  sessionId: string;
  jobId: string;
  prompt: string;
  costUsd: number;
  reason: string;
}

export interface AgentEvaluatedEvent extends BaseEvent {
  eventName: "agent.evaluated";
  sessionId: string;
  trackId: string;
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: number;
  reason: string;
}

export interface AgentSelectionEvent extends BaseEvent {
  eventName: "agent.selection";
  sessionId: string;
  trackId: string;
  candidates: string[];
  count?: number;
  strategy?: string;
  cohortInfluence?: CohortInfluenceEventSummary;
}

export interface CohortInfluenceEventSummary {
  availableCount?: number;
  appliedCount: number;
  cohortIds: string[];
  cohortTypes: string[];
  reasonCodes: string[];
}

export interface AgentMixPlannedEvent extends BaseEvent {
  eventName: "agent.mix_planned";
  sessionId: string;
  trackId: string;
  trackTitle?: string;
  transition: string;
}

export interface AgentNegotiatedEvent extends BaseEvent {
  eventName: "agent.negotiated";
  sessionId: string;
  trackId: string;
  trackTitle?: string;
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: number;
  reason: string;
}

export interface AgentEvaluationCompletedEvent extends BaseEvent {
  eventName: "agent.evaluation_completed";
  total: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  avgPriceUsd: number;
  repeatRate: number;
}

export interface PaymentInitiatedEvent extends BaseEvent {
  eventName: "payment.initiated";
  paymentId: string;
  amountUsd: number;
  sessionId: string;
  trackId?: string;
  artistId?: string;
  releaseId?: string;
  title?: string;
  chainId: number;
  paymentToken?: string;
  paymentAssetId?: string;
  paymentAssetSymbol?: string;
  paymentAssetDecimals?: number;
  settlementAmount?: string;
  settlementAmountUnits?: string;
}

export interface PaymentSettledEvent extends BaseEvent {
  eventName: "payment.settled";
  paymentId: string;
  txHash: string;
  status: "settled" | "failed";
  sessionId?: string;
  chainId?: number;
  amountUsd?: number;
  trackId?: string;
  artistId?: string;
  releaseId?: string;
  title?: string;
  paymentToken?: string;
  paymentAssetId?: string;
  paymentAssetSymbol?: string;
  paymentAssetDecimals?: number;
  settlementAmount?: string;
  settlementAmountUnits?: string;
}

export interface WalletFundedEvent extends BaseEvent {
  eventName: "wallet.funded";
  userId: string;
  amountUsd: number;
  balanceUsd: number;
}

export interface WalletBudgetSetEvent extends BaseEvent {
  eventName: "wallet.budget_set";
  userId: string;
  monthlyCapUsd: number;
}

export interface WalletFaucetRequestedEvent extends BaseEvent {
  eventName: "wallet.faucet_requested";
  userId: string;
  chainId: number;
  amountEth: string;
  status: "sent" | "skipped" | "failed";
}

export interface WalletSpentEvent extends BaseEvent {
  eventName: "wallet.spent";
  userId: string;
  amountUsd: number;
  spentUsd: number;
  balanceUsd: number;
}

// ============ Smart Contract Events ============

export interface ContractStemMintedEvent extends BaseEvent {
  eventName: "contract.stem_minted";
  tokenId: string;
  creatorAddress: string;
  parentIds: string[];
  tokenUri: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractStemListedEvent extends BaseEvent {
  eventName: "contract.stem_listed";
  listingId: string;
  sellerAddress: string;
  tokenId: string;
  amount: string;
  pricePerUnit: string;
  paymentToken: string;
  licenseType?: "personal" | "remix" | "commercial";
  expiresAt: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractStemSoldEvent extends BaseEvent {
  eventName: "contract.stem_sold";
  listingId: string;
  buyerAddress: string;
  amount: string;
  totalPaid: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractRoyaltyPaidEvent extends BaseEvent {
  eventName: "contract.royalty_paid";
  tokenId: string;
  recipientAddress: string;
  amount: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractListingCancelledEvent extends BaseEvent {
  eventName: "contract.listing_cancelled";
  listingId: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

// ============ Content Protection Phase 2 Events ============

export interface ContractContentAttestedEvent extends BaseEvent {
  eventName: "contract.content_attested";
  tokenId: string;
  attesterAddress: string;
  contentHash: string;
  fingerprintHash: string;
  metadataURI: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractStakeDepositedEvent extends BaseEvent {
  eventName: "contract.stake_deposited";
  tokenId: string;
  stakerAddress: string;
  amount: string;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractStakeSlashedEvent extends BaseEvent {
  eventName: "contract.stake_slashed";
  tokenId: string;
  reporterAddress: string;
  paymentToken?: string;
  reporterAmount: string;
  treasuryAmount: string;
  burnedAmount: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractEscrowReleasedEvent extends BaseEvent {
  eventName: "contract.escrow_released";
  tokenId: string;
  beneficiaryAddress: string;
  amount: string;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractEscrowFrozenEvent extends BaseEvent {
  eventName: "contract.escrow_frozen";
  tokenId: string;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractEscrowRedirectedEvent extends BaseEvent {
  eventName: "contract.escrow_redirected";
  tokenId: string;
  newRecipient: string;
  amount: string;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractAddressBlacklistedEvent extends BaseEvent {
  eventName: "contract.address_blacklisted";
  account: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

// ============ Community Curation Phase 3 Events ============

export interface ContractDisputeFiledEvent extends BaseEvent {
  eventName: "contract.dispute_filed";
  disputeId: string;
  tokenId: string;
  reporterAddress: string;
  creatorAddress: string;
  evidenceURI: string;
  counterStake: string;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractDisputeResolvedEvent extends BaseEvent {
  eventName: "contract.dispute_resolved";
  disputeId: string;
  tokenId: string;
  outcome: string;
  resolverAddress: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractDisputeAppealedEvent extends BaseEvent {
  eventName: "contract.dispute_appealed";
  disputeId: string;
  appealerAddress: string;
  appealNumber: string;
  paymentToken?: string;
  appealStake?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractContentReportedEvent extends BaseEvent {
  eventName: "contract.content_reported";
  disputeId: string;
  tokenId: string;
  reporterAddress: string;
  counterStake: string;
  paymentToken?: string;
  evidenceURI: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractBountyClaimedEvent extends BaseEvent {
  eventName: "contract.bounty_claimed";
  disputeId: string;
  reporterAddress: string;
  amount: string;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

export interface ContractAppealStakeDepositedEvent extends BaseEvent {
  eventName: "contract.appeal_stake_deposited";
  disputeId: string;
  appealerAddress: string;
  appealStake: string;
  paymentToken?: string;
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: string;
}

// ============ Notification Events ============

export interface NotificationCreatedEvent extends BaseEvent {
  eventName: "notification.created";
  walletAddress: string;
  notificationId: string;
  type: string;
  title: string;
  message: string;
  disputeId?: string;
  releaseId?: string;
  stemListingId?: string;
}

export interface ReleaseRightsRequestUpdatedEvent extends BaseEvent {
  eventName: "release_rights.request_updated";
  requestId: string;
  releaseId: string;
  status: string;
  walletAddresses: string[];
}

// ============ Agent Wallet Events ============

export interface AgentWalletEnabledEvent extends BaseEvent {
  eventName: "agent.wallet_enabled";
  userId: string;
  walletAddress: string;
  agentAddress: string;
}

export interface AgentWalletDisabledEvent extends BaseEvent {
  eventName: "agent.wallet_disabled";
  userId: string;
}

export interface AgentBudgetAlertEvent extends BaseEvent {
  eventName: "agent.budget_alert";
  userId: string;
  level: "warning" | "critical" | "exhausted";
  percentUsed: number;
  spentUsd: number;
  monthlyCapUsd: number;
  remainingUsd: number;
}

export interface AgentPurchaseCompletedEvent extends BaseEvent {
  eventName: "agent.purchase_completed";
  sessionId: string;
  userId: string;
  listingId: string;
  tokenId: string;
  amount: string;
  priceUsd: number;
  txHash: string;
  mode: string;
}

export interface AgentPurchaseFailedEvent extends BaseEvent {
  eventName: "agent.purchase_failed";
  sessionId: string;
  userId: string;
  listingId: string;
  error: string;
}

export interface X402PurchaseEvent extends BaseEvent {
  eventName: "x402.purchase";
  stemId: string;
  trackId?: string;
  releaseId?: string;
  artistId?: string;
  listingId?: string;
  tokenId?: string;
  receiptId: string;
  paymentRail: "facilitator" | "smart_account";
  transactionHash: string;
  amountUsd: number;
  canonicalAmountUsd: number;
  paymentToken?: string;
  paymentAssetId?: string;
  paymentAssetSymbol?: string;
  paymentAssetDecimals?: number;
  settlementAmount?: string;
  settlementAmountUnits?: string;
  settlementStatus?: string;
  entitlement?: string;
  payer?: string;
}

export interface X402PurchaseFailedEvent extends BaseEvent {
  eventName: "x402.purchase_failed";
  stemId: string;
  trackId?: string;
  releaseId?: string;
  artistId?: string;
  listingId?: string;
  receiptId?: string;
  paymentRail?: "facilitator" | "smart_account";
  transactionHash?: string;
  status: string;
  reason: string;
}

// ============ Generation Events ============

export interface GenerationStartedEvent extends BaseEvent {
  eventName: "generation.started";
  jobId: string;
  userId: string;
  prompt: string;
}

export interface GenerationProgressEvent extends BaseEvent {
  eventName: "generation.progress";
  jobId: string;
  phase: 'queued' | 'generating' | 'storing' | 'finalizing';
}

export interface GenerationCompletedEvent extends BaseEvent {
  eventName: "generation.completed";
  jobId: string;
  userId: string;
  trackId: string;
  releaseId: string;
}

export interface GenerationFailedEvent extends BaseEvent {
  eventName: "generation.failed";
  jobId: string;
  userId: string;
  error: string;
}

export interface GenerationCreditsGrantedEvent extends BaseEvent {
  eventName: "generation.credits_granted";
  userId: string;
  amountCents: number;
  reason: string;
}

export interface GenerationCreditsDebitedEvent extends BaseEvent {
  eventName: "generation.credits_debited";
  userId: string;
  amountCents: number;
  jobId: string | null;
  kind: string;
}

export interface GenerationCreditsInsufficientEvent extends BaseEvent {
  eventName: "generation.credits_insufficient";
  userId: string;
  requiredCents: number;
  balanceCents: number;
  kind: string;
}

export interface GenerationCreditsRequestedEvent extends BaseEvent {
  eventName: "generation.credits_requested";
  userId: string;
  note?: string;
}

// ============ Realtime Events ============

export interface RealtimeAudioEvent extends BaseEvent {
  eventName: "realtime.audio";
  sessionId: string;
  userId: string;
  chunk: string; // base64-encoded PCM audio
  timestamp: number;
}

export interface RealtimeDisconnectedEvent extends BaseEvent {
  eventName: "realtime.disconnected";
  sessionId: string;
  userId: string;
  reason: string;
}

// ============ Marketplace Notification Events ============

export interface MarketplaceListingNotifyEvent extends BaseEvent {
  eventName: "marketplace.listing_notify";
  listingId?: string;
  tokenId: string;
  sellerAddress: string;
  pricePerUnit: string;
  paymentToken?: string;
  amount: string;
  licenseType?: "personal" | "remix" | "commercial";
}

export type ResonateEvent =
  | StemsUploadedEvent
  | StemsProcessedEvent
  | IpNftMintedEvent
  | RemixCreatedEvent
  | RemixProjectCreatedEvent
  | RemixPolicyRejectedEvent
  | RemixLicenseRequiredEvent
  | RemixGenerationStartedEvent
  | RemixGenerationCompletedEvent
  | RemixGenerationFailedEvent
  | RemixEncryptedRenderAuthorizedEvent
  | RemixEncryptedRenderDeniedEvent
  | ShowCampaignReconciliationMismatchEvent
  | ShowCampaignSettledEvent
  | RemixPublishedEvent
  | RemixExportedEvent
  | ArtistRemixConsentUpdatedEvent
  | RecommendationPreferencesUpdatedEvent
  | RecommendationGeneratedEvent
  | TasteMemorySettingsUpdatedEvent
  | TasteMemorySignalHiddenEvent
  | TasteMemorySignalDownrankedEvent
  | TasteMemorySignalRestoredEvent
  | TasteMemoryResetEvent
  | CommunityProfileVisibilityUpdatedEvent
  | CommunityProfileShowcaseUpdatedEvent
  | CommunityOwnershipDisplayUpdatedEvent
  | CommunityBenefitRedeemedEvent
  | CommunityBenefitRuleLifecycleEvent
  | CommunityBadgeGrantedEvent
  | CommunityRoleGrantedEvent
  | CommunityArtistTabEnabledEvent
  | CommunityRoomJoinedEvent
  | CommunityCampaignRoomJoinedEvent
  | CommunityShowCityInterestJoinedEvent
  | CommunityCampaignUpdateViewedEvent
  | CommunityRoomLeftEvent
  | CommunityRoomAccessDeniedEvent
  | CommunityMessageCreatedEvent
  | CommunityMessageReportedEvent
  | CommunityMessageDeletedEvent
  | CommunityMemberModeratedEvent
  | CommunityModerationActionTakenEvent
  | CommunityRoomStatusUpdatedEvent
  | CommunityDiscordBridgeConnectedEvent
  | CommunityDiscordAnnouncementMirroredEvent
  | CommunityDiscordRoleSyncCompletedEvent
  | CommunityDiscordRoleSyncFailedEvent
  | CommunityCohortSuggestedEvent
  | CommunityCohortJoinedEvent
  | CommunityCohortLeftEvent
  | CommunityCohortHiddenEvent
  | IdentityAuthenticatedEvent
  | PlaylistCreatedEvent
  | PlaylistUpdatedEvent
  | PlaylistDeletedEvent
  | PlaylistTrackAddedEvent
  | PlaylistTrackRemovedEvent
  | PlaylistVisibilityChangedEvent
  | PlaylistSavedToLibraryEvent
  | PlaylistRemovedFromLibraryEvent
  | CuratorStakedEvent
  | CuratorReportedEvent
  | CatalogUpdatedEvent
  | CatalogReleaseReadyEvent
  | CatalogTrackStatusEvent
  | SessionStartedEvent
  | LicenseGrantedEvent
  | SessionEndedEvent
  | AgentTrackSelectedEvent
  | AgentDecisionMadeEvent
  | AgentEvaluatedEvent
  | AgentSelectionEvent
  | AgentMixPlannedEvent
  | AgentNegotiatedEvent
  | AgentEvaluationCompletedEvent
  | PaymentInitiatedEvent
  | PaymentSettledEvent
  | WalletFundedEvent
  | WalletBudgetSetEvent
  | WalletFaucetRequestedEvent
  | WalletSpentEvent
  | StemsProgressEvent
  | StemsFailedEvent
  | ContractStemMintedEvent
  | ContractStemListedEvent
  | ContractStemSoldEvent
  | ContractRoyaltyPaidEvent
  | ContractListingCancelledEvent
  | ContractContentAttestedEvent
  | ContractStakeDepositedEvent
  | ContractStakeSlashedEvent
  | ContractEscrowReleasedEvent
  | ContractEscrowFrozenEvent
  | ContractEscrowRedirectedEvent
  | ContractAddressBlacklistedEvent
  | ContractDisputeFiledEvent
  | ContractDisputeResolvedEvent
  | ContractDisputeAppealedEvent
  | ContractContentReportedEvent
  | ContractBountyClaimedEvent
  | ContractAppealStakeDepositedEvent
  | AgentWalletEnabledEvent
  | AgentWalletDisabledEvent
  | AgentBudgetAlertEvent
  | AgentPurchaseCompletedEvent
  | AgentPurchaseFailedEvent
  | X402PurchaseEvent
  | X402PurchaseFailedEvent
  | AgentGenerationTriggeredEvent
  | GenerationStartedEvent
  | GenerationProgressEvent
  | GenerationCompletedEvent
  | GenerationFailedEvent
  | GenerationCreditsGrantedEvent
  | GenerationCreditsDebitedEvent
  | GenerationCreditsInsufficientEvent
  | GenerationCreditsRequestedEvent
  | RealtimeAudioEvent
  | RealtimeDisconnectedEvent
  | MarketplaceListingNotifyEvent
  | ReleaseRightsRequestUpdatedEvent
  | NotificationCreatedEvent;
