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
  artworkData?: Buffer;
  artworkMimeType?: string;
  metadata?: {
    type?: string;
    title?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
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
  chainId: number;
}

export interface PaymentSettledEvent extends BaseEvent {
  eventName: "payment.settled";
  paymentId: string;
  txHash: string;
  status: "settled" | "failed";
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

// ============ Agent Wallet Events ============

export interface AgentWalletEnabledEvent extends BaseEvent {
  eventName: "agent.wallet_enabled";
  userId: string;
  walletAddress: string;
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

export type ResonateEvent =
  | StemsUploadedEvent
  | StemsProcessedEvent
  | IpNftMintedEvent
  | RemixCreatedEvent
  | RecommendationPreferencesUpdatedEvent
  | RecommendationGeneratedEvent
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
  | WalletSpentEvent
  | StemsProgressEvent
  | StemsFailedEvent
  | ContractStemMintedEvent
  | ContractStemListedEvent
  | ContractStemSoldEvent
  | ContractRoyaltyPaidEvent
  | ContractListingCancelledEvent
  | AgentWalletEnabledEvent
  | AgentWalletDisabledEvent
  | AgentBudgetAlertEvent
  | AgentPurchaseCompletedEvent
  | AgentPurchaseFailedEvent
  | AgentGenerationTriggeredEvent
  | GenerationStartedEvent
  | GenerationProgressEvent
  | GenerationCompletedEvent
  | GenerationFailedEvent
  | RealtimeAudioEvent
  | RealtimeDisconnectedEvent;

