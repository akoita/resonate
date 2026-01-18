export interface BaseEvent {
  eventName: string;
  eventVersion: number;
  occurredAt: string;
}

export interface StemsUploadedEvent extends BaseEvent {
  eventName: "stems.uploaded";
  trackId: string;
  artistId: string;
  fileUris: string[];
  checksum: string;
  metadata?: {
    releaseType?: string;
    releaseTitle?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
    isrc?: string;
    label?: string;
    releaseDate?: string;
    explicit?: boolean;
  };
}

export interface StemsProcessedEvent extends BaseEvent {
  eventName: "stems.processed";
  trackId: string;
  stemIds: string[];
  modelVersion: string;
  durationMs: number;
  stems?: {
    id: string;
    uri: string;
    type: string;
  }[];
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

export interface CatalogUpdatedEvent extends BaseEvent {
  eventName: "catalog.updated";
  trackId: string;
  status: string;
  version: number;
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

export type ResonateEvent =
  | StemsUploadedEvent
  | StemsProcessedEvent
  | IpNftMintedEvent
  | RemixCreatedEvent
  | RecommendationPreferencesUpdatedEvent
  | RecommendationGeneratedEvent
  | CatalogUpdatedEvent
  | SessionStartedEvent
  | LicenseGrantedEvent
  | SessionEndedEvent
  | AgentTrackSelectedEvent
  | AgentDecisionMadeEvent
  | PaymentInitiatedEvent
  | PaymentSettledEvent
  | WalletFundedEvent
  | WalletBudgetSetEvent
  | WalletSpentEvent;
