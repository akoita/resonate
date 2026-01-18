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
  preferences: Record<string, string>;
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

export type ResonateEvent =
  | StemsUploadedEvent
  | StemsProcessedEvent
  | IpNftMintedEvent
  | CatalogUpdatedEvent
  | SessionStartedEvent
  | LicenseGrantedEvent
  | SessionEndedEvent
  | PaymentInitiatedEvent
  | PaymentSettledEvent;
