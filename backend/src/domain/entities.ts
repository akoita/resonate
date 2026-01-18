export type UUID = string;

export interface User {
  id: UUID;
  email: string;
  walletId: UUID;
  roles: string[];
}

export interface Wallet {
  id: UUID;
  address: string;
  chainId: number;
  balanceUsd: number;
}

export interface Artist {
  id: UUID;
  userId: UUID;
  displayName: string;
  payoutAddress: string;
}

export interface Track {
  id: UUID;
  artistId: UUID;
  title: string;
  status: "draft" | "processing" | "ready" | "failed";
  releaseType?: "single" | "ep" | "album";
  releaseTitle?: string;
  primaryArtist?: string;
  featuredArtists?: string[];
  genre?: string;
  isrc?: string;
  label?: string;
  releaseDate?: string;
  explicit?: boolean;
}

export interface Stem {
  id: UUID;
  trackId: UUID;
  type: "drums" | "vocals" | "bass" | "other";
  uri: string;
  ipNftId?: string;
}

export interface Session {
  id: UUID;
  userId: UUID;
  budgetCapUsd: number;
  spentUsd: number;
}

export interface License {
  id: UUID;
  sessionId: UUID;
  type: "personal" | "remix" | "commercial";
  priceUsd: number;
  durationSeconds: number;
}

export interface Payment {
  id: UUID;
  txHash: string;
  amountUsd: number;
  status: "initiated" | "settled" | "failed";
}
