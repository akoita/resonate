const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export type WalletRecord = {
  id: string;
  userId: string;
  address: string;
  chainId: number;
  balanceUsd: number;
  monthlyCapUsd: number;
  spentUsd: number;
  accountType?: string | null;
  provider?: string | null;
  ownerAddress?: string | null;
  entryPoint?: string | null;
  factory?: string | null;
  paymaster?: string | null;
  bundler?: string | null;
  salt?: string | null;
  deploymentTxHash?: string | null;
};

type AuthVerifyResponse =
  | { accessToken: string }
  | { status: "invalid_signature" | "invalid_nonce" };

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchNonce(address: string) {
  return apiRequest<{ nonce: string }>(
    "/auth/nonce",
    { method: "POST", body: JSON.stringify({ address }) },
  );
}

export async function verifySignature(input: {
  address: string;
  message: string;
  signature: `0x${string}`;
  role?: string;
}) {
  return apiRequest<AuthVerifyResponse>(
    "/auth/verify",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function fetchWallet(userId: string, token: string) {
  return apiRequest<WalletRecord>(`/wallet/${userId}`, {}, token);
}

export async function refreshWallet(userId: string, token: string) {
  return apiRequest<WalletRecord>(
    "/wallet/refresh",
    { method: "POST", body: JSON.stringify({ userId }) },
    token
  );
}

export async function setWalletProvider(
  userId: string,
  provider: "local" | "erc4337",
  token: string
) {
  return apiRequest<WalletRecord>(
    "/wallet/provider",
    { method: "POST", body: JSON.stringify({ userId, provider }) },
    token
  );
}

export async function deploySmartAccount(userId: string, token: string) {
  return apiRequest<WalletRecord>(
    "/wallet/deploy",
    { method: "POST", body: JSON.stringify({ userId }) },
    token
  );
}

export async function enableSmartAccount(token: string) {
  return apiRequest<WalletRecord>("/wallet/aa/enable", { method: "POST" }, token);
}

export async function refreshSmartAccount(token: string) {
  return apiRequest<WalletRecord>("/wallet/aa/refresh", { method: "POST" }, token);
}

export async function deploySmartAccountSelf(token: string) {
  return apiRequest<WalletRecord>("/wallet/aa/deploy", { method: "POST" }, token);
}

export async function configurePaymaster(
  token: string,
  input: { sponsorMaxUsd: number; paymasterAddress: string }
) {
  return apiRequest<{ status: string }>("/wallet/paymaster", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export async function getPaymasterStatus(token: string, userId?: string) {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return apiRequest<{
    sponsorMaxUsd: number;
    paymasterAddress: string;
    spentUsd?: number;
  }>(`/wallet/paymaster${query}`, {}, token);
}

export async function resetPaymaster(token: string, userId: string) {
  return apiRequest<{ status: string }>(
    "/wallet/paymaster/reset",
    { method: "POST", body: JSON.stringify({ userId }) },
    token
  );
}

// ========== Catalog API ==========

export type Track = {
  id: string;
  artistId: string;
  title: string;
  status: string;
  releaseType: string;
  releaseTitle?: string | null;
  primaryArtist?: string | null;
  featuredArtists?: string | null;
  genre?: string | null;
  isrc?: string | null;
  label?: string | null;
  releaseDate?: string | null;
  explicit: boolean;
  createdAt: string;
  stems?: Array<{
    id: string;
    trackId: string;
    type: string;
    uri: string;
    ipnftId?: string | null;
  }>;
  artist?: {
    id: string;
    displayName: string;
  };
};

export type ArtistProfile = {
  id: string;
  userId: string;
  displayName: string;
  payoutAddress: string;
};

export async function getArtistMe(token: string) {
  return apiRequest<ArtistProfile | null>("/artists/me", {}, token);
}

export async function createArtist(
  token: string,
  input: { displayName: string; payoutAddress: string }
) {
  return apiRequest<ArtistProfile>(
    "/artists",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function createTrack(
  token: string,
  input: {
    title: string;
    releaseType?: string;
    releaseTitle?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
    isrc?: string;
    label?: string;
    releaseDate?: string;
    explicit?: boolean;
  }
) {
  return apiRequest<Track>(
    "/catalog",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function getTrack(token: string, trackId: string) {
  return apiRequest<Track>(`/catalog/${trackId}`, {}, token);
}

export async function listArtistTracks(token: string, artistId: string) {
  return apiRequest<Track[]>(`/catalog/artist/${artistId}`, {}, token);
}

export async function listMyTracks(token: string) {
  return apiRequest<Track[]>("/catalog/me", {}, token);
}

export async function listPublishedTracks(limit = 20) {
  return apiRequest<Track[]>(`/catalog/published?limit=${limit}`, {});
}

export async function uploadStems(
  token: string,
  input: {
    artistId: string;
    fileUris: string[];
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
) {
  return apiRequest<{ trackId: string; status: string }>(
    "/stems/upload",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}
