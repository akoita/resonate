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
  trackId: string;
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: number;
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
}

export interface AgentMixPlannedEvent extends BaseEvent {
  eventName: "agent.mix_planned";
  sessionId: string;
  trackId: string;
  transition: string;
}

export interface AgentNegotiatedEvent extends BaseEvent {
  eventName: "agent.negotiated";
  sessionId: string;
  trackId: string;
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
  | ContractStemMintedEvent
  | ContractStemListedEvent
  | ContractStemSoldEvent
  | ContractRoyaltyPaidEvent
  | ContractListingCancelledEvent;
