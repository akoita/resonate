const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export function getReleaseArtworkUrl(releaseId: string) {
  return `${API_BASE}/catalog/releases/${releaseId}/artwork`;
}

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
  console.log(`[API] ${options.method || 'GET'} ${path}`, { hasToken: !!token });
  const headers = new Headers(options.headers);

  // Don't set Content-Type if we're sending FormData (fetch will set it with boundary)
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      errorDetail = await response.text();
    } catch {
      // ignore
    }
    console.error(`[API] Error ${response.status} ${path}`, errorDetail);
    throw new Error(`API ${response.status}: ${errorDetail || response.statusText}`);
  }

  // Handle No Content (204) or empty body
  if (response.status === 204) {
    return null as T;
  }

  const text = await response.text();
  if (!text) {
    return null as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    console.error(`[API] Failed to parse JSON from ${path}`, { text, err });
    return text as unknown as T; // Fallback to raw text if it's not JSON but was expected
  }
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

export type Release = {
  id: string;
  artistId: string;
  title: string;
  status: string;
  type: string; // SINGLE, EP, ALBUM
  primaryArtist?: string | null;
  featuredArtists?: string | null;
  genre?: string | null;
  label?: string | null;
  releaseDate?: string | null;
  explicit: boolean;
  createdAt: string;
  artworkUrl?: string | null;
  tracks?: Track[];
  artist?: {
    id: string;
    displayName: string;
  };
};

export type Track = {
  id: string;
  releaseId: string;
  title: string;
  position: number;
  explicit: boolean;
  artist?: string | null;
  createdAt: string;
  stems?: Array<{
    id: string;
    trackId: string;
    type: string;
    uri: string;
    ipnftId?: string | null;
    title?: string | null;
    artist?: string | null;
    artworkUrl?: string | null;
  }>;
  release?: Release;
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

export async function createRelease(
  token: string,
  input: {
    title: string;
    type?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    genre?: string;
    label?: string;
    releaseDate?: string;
    explicit?: boolean;
    tracks?: Array<{ title: string; position: number; explicit?: boolean }>;
  }
) {
  return apiRequest<Release>(
    "/catalog",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function getRelease(releaseId: string, token?: string | null) {
  const release = await apiRequest<Release>(`/catalog/releases/${releaseId}`, {}, token);
  if (release) {
    release.artworkUrl = getReleaseArtworkUrl(release.id);
  }
  return release;
}

export async function getTrack(trackId: string, token?: string | null) {
  const track = await apiRequest<Track>(`/catalog/tracks/${trackId}`, {}, token);
  if (track && track.release) {
    track.release.artworkUrl = getReleaseArtworkUrl(track.release.id);
  }
  return track;
}

export async function listArtistReleases(token: string, artistId: string) {
  const releases = await apiRequest<Release[]>(`/catalog/artist/${artistId}`, {}, token);
  return releases.map(r => ({ ...r, artworkUrl: getReleaseArtworkUrl(r.id) }));
}

export async function listMyReleases(token: string) {
  const releases = await apiRequest<Release[]>("/catalog/me", {}, token);
  return releases.map(r => ({ ...r, artworkUrl: getReleaseArtworkUrl(r.id) }));
}

export async function listPublishedReleases(limit = 20) {
  const releases = await apiRequest<Release[]>(`/catalog/published?limit=${limit}`, {});
  return releases.map(r => ({ ...r, artworkUrl: getReleaseArtworkUrl(r.id) }));
}

export async function uploadStems(
  token: string,
  formData: FormData
) {
  return apiRequest<{ releaseId: string; status: string }>(
    "/stems/upload",
    { method: "POST", body: formData },
    token
  );
}
