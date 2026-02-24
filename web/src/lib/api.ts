export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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
  | { accessToken: string; address?: string }
  | { status: "invalid_signature" | "invalid_nonce" };

async function apiRequest<T>(
  path: string,
  options: RequestInit & { silentErrorCodes?: number[] } = {},
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

    const isSilent = options.silentErrorCodes?.includes(response.status);
    if (!isSilent) {
      console.error(`[API] Error ${response.status} ${path}`, errorDetail);
    }

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
  /** For local dev (chainId 31337): EOA that signed; backend verifies this and issues token for address */
  signerAddress?: string;
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
  artworkMimeType?: string | null;
  tracks?: Track[];
  artist?: {
    id: string;
    displayName: string;
    userId: string;
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
  artworkMimeType?: string | null;
  processingStatus?: "pending" | "separating" | "encrypting" | "storing" | "complete" | "failed";
  stems?: Array<{
    id: string;
    trackId: string;
    type: string;
    uri: string;
    ipnftId?: string | null;
    title?: string | null;
    artist?: string | null;
    artworkUrl?: string | null;
    durationSeconds?: number | null;
    isEncrypted?: boolean;
    encryptionMetadata?: string | null;
  }>;
  release?: Release;
};


export type APIPlaylist = {
  id: string;
  userId: string;
  name: string;
  trackIds: string[];
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type APIFolder = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  playlists?: APIPlaylist[];
};

export type ArtistProfile = {
  id: string;
  userId: string;
  displayName: string;
  payoutAddress: string;
};

export async function getArtistMe(token: string) {
  const isMockAuth = (typeof window !== "undefined" && localStorage.getItem("resonate.mock_auth") === "true") || process.env.NEXT_PUBLIC_MOCK_AUTH === "true";

  if (isMockAuth) {
    return {
      id: "test-artist-id",
      userId: "test-user",
      displayName: "Test Artist",
      payoutAddress: "0x742d35Cc6634C0532925a3b844Bc17e7595f1ea2c",
    };
  }
  return apiRequest<ArtistProfile | null>("/artists/me", { silentErrorCodes: [401] }, token);
}

export async function getArtistPublic(artistId: string) {
  return apiRequest<ArtistProfile>(`/artists/${artistId}`, {});
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
  if (release && release.artworkMimeType) {
    release.artworkUrl = getReleaseArtworkUrl(release.id);
  }
  return release;
}

export async function getTrack(trackId: string, token?: string | null) {
  const track = await apiRequest<Track>(`/catalog/tracks/${trackId}`, {}, token);
  if (track && track.release && track.release.artworkMimeType) {
    track.release.artworkUrl = getReleaseArtworkUrl(track.release.id);
  }
  return track;
}

export async function listArtistReleases(artistId: string, token?: string | null) {
  const releases = await apiRequest<Release[]>(`/catalog/artist/${artistId}`, {}, token);
  return releases.map(r => ({
    ...r,
    artworkUrl: r.artworkMimeType ? getReleaseArtworkUrl(r.id) : null
  }));
}

export async function listMyReleases(token: string) {
  const releases = await apiRequest<Release[]>("/catalog/me", {}, token);
  return releases.map(r => ({
    ...r,
    artworkUrl: r.artworkMimeType ? getReleaseArtworkUrl(r.id) : null
  }));
}

export async function listPublishedReleases(limit = 20, primaryArtist?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (primaryArtist) params.set('primaryArtist', primaryArtist);
  const releases = await apiRequest<Release[]>(`/catalog/published?${params}`, {});
  return releases.map(r => ({
    ...r,
    artworkUrl: r.artworkMimeType ? getReleaseArtworkUrl(r.id) : null
  }));
}

export async function uploadStems(
  token: string,
  formData: FormData
) {
  return apiRequest<{ releaseId: string; status: string }>(
    "/ingestion/upload",
    { method: "POST", body: formData },
    token
  );
}

export async function updateReleaseArtwork(
  token: string,
  releaseId: string,
  formData: FormData
) {
  return apiRequest<{ success: boolean; artworkUrl: string }>(
    `/catalog/releases/${releaseId}/artwork`,
    { method: "PATCH", body: formData },
    token
  );
}

export async function retryRelease(
  token: string,
  releaseId: string
) {
  return apiRequest<{ success: boolean; releaseId: string }>(
    `/ingestion/retry/${releaseId}`,
    { method: "POST" },
    token
  );
}

export async function cancelProcessing(
  token: string,
  releaseId: string
) {
  return apiRequest<{ success: boolean; message: string }>(
    `/ingestion/cancel/${releaseId}`,
    { method: "POST" },
    token
  );
}

export async function deleteRelease(
  token: string,
  releaseId: string
) {
  return apiRequest<{ success: boolean }>(
    `/catalog/releases/${releaseId}`,
    { method: "DELETE" },
    token
  );
}

// ========== Playlist API ==========

export async function createPlaylistAPI(
  token: string,
  input: { name: string; folderId?: string; trackIds?: string[] }
) {
  return apiRequest<APIPlaylist>(
    "/playlists",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function listPlaylistsAPI(token: string, folderId?: string) {
  const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  return apiRequest<APIPlaylist[]>(`/playlists${query}`, {}, token);
}

export async function getPlaylistAPI(id: string, token: string) {
  return apiRequest<APIPlaylist>(`/playlists/${id}`, {}, token);
}

export async function updatePlaylistAPI(
  id: string,
  token: string,
  input: { name?: string; folderId?: string | null; trackIds?: string[] }
) {
  return apiRequest<APIPlaylist>(
    `/playlists/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    token
  );
}

export async function deletePlaylistAPI(id: string, token: string) {
  return apiRequest<void>(`/playlists/${id}`, { method: "DELETE" }, token);
}

export async function createFolderAPI(token: string, name: string) {
  return apiRequest<APIFolder>(
    "/playlists/folders",
    { method: "POST", body: JSON.stringify({ name }) },
    token
  );
}

export async function listFoldersAPI(token: string) {
  return apiRequest<APIFolder[]>("/playlists/folders", {}, token);
}

export async function updateFolderAPI(id: string, token: string, name: string) {
  return apiRequest<APIFolder>(
    `/playlists/folders/${id}`,
    { method: "PUT", body: JSON.stringify({ name }) },
    token
  );
}

export async function deleteFolderAPI(id: string, token: string) {
  return apiRequest<void>(`/playlists/folders/${id}`, { method: "DELETE" }, token);
}
// ========== Marketplace API ==========

export type APIListing = {
  listingId: string;
  tokenId: string;
  chainId: number;
  seller: string;
  price: string;
  amount: string;
  paymentToken: string;
  status: string;
  expiresAt: string;
  listedAt: string;
  soldAt?: string;
  stem?: {
    id: string;
    title: string;
    type: string;
    track?: string;
  };
};

export async function getListings(limit = 20, offset = 0) {
  return apiRequest<{ listings: APIListing[]; total: number }>(
    `/metadata/listings?limit=${limit}&offset=${offset}`,
    {}
  );
}

export async function getListingsByStem(stemId: string) {
  const allListings = await getListings(100);
  return allListings.listings.filter(l => l.stem?.id === stemId);
}

export async function getStemNftInfo(stemId: string) {
  return apiRequest<{
    tokenId: string;
    chainId: number;
    contractAddress: string;
    creator: string;
    transactionHash: string;
    mintedAt: string;
  }>(`/metadata/stem/${stemId}`, { silentErrorCodes: [404] });
}

// ========== Agent Config API ==========

export type AgentConfig = {
  id: string;
  userId: string;
  name: string;
  vibes: string[];
  stemTypes: string[];
  sessionMode: "curate" | "buy";
  monthlyCapUsd: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function getAgentConfig(token: string): Promise<AgentConfig | null> {
  return apiRequest<AgentConfig | null>("/agents/config", { silentErrorCodes: [404] }, token);
}

export async function createAgentConfig(
  token: string,
  input: { name: string; vibes: string[]; monthlyCapUsd: number }
): Promise<AgentConfig> {
  return apiRequest<AgentConfig>(
    "/agents/config",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function updateAgentConfig(
  token: string,
  input: { name?: string; vibes?: string[]; stemTypes?: string[]; sessionMode?: "curate" | "buy"; monthlyCapUsd?: number; isActive?: boolean }
): Promise<AgentConfig> {
  return apiRequest<AgentConfig>(
    "/agents/config",
    { method: "PATCH", body: JSON.stringify(input) },
    token
  );
}

export async function startAgentSession(token: string): Promise<{ status: string; sessionId?: string }> {
  return apiRequest<{ status: string; sessionId?: string }>(
    "/agents/config/session",
    { method: "POST" },
    token
  );
}

export async function stopAgentSession(token: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(
    "/agents/config/session/stop",
    { method: "POST" },
    token
  );
}

export interface AgentSessionLicense {
  id: string;
  trackId: string;
  type: string;
  priceUsd: number;
  track: {
    id: string;
    title: string;
    artist: string | null;
    releaseId: string;
    release: { id: string; artworkMimeType: string | null; artworkUrl?: string | null; title: string };
  };
}

export interface AgentSession {
  id: string;
  budgetCapUsd: number;
  spentUsd: number;
  startedAt: string;
  endedAt: string | null;
  licenses: AgentSessionLicense[];
  agentTransactions: AgentTransaction[];
}

export async function getAgentHistory(token: string): Promise<AgentSession[]> {
  const sessions = await apiRequest<AgentSession[]>("/agents/config/history", {}, token);
  // Compute artworkUrl from release id, same pattern as getRelease/getTrack
  for (const session of sessions) {
    for (const lic of session.licenses) {
      if (lic.track.release?.artworkMimeType) {
        lic.track.release.artworkUrl = getReleaseArtworkUrl(lic.track.release.id);
      }
    }
  }
  return sessions;
}

// ========== Agent Wallet API ==========

export type SessionKeyPermissions = {
  target: string;
  function: string;
  totalCapWei: string;
  perTxCapWei: string;
  rateLimit: number;
};

export type AgentWalletStatus = {
  enabled: boolean;
  walletAddress: string | null;
  accountType: string;
  sessionKeyValid: boolean;
  sessionKeyExpiresAt: number | null;
  budgetCapUsd: number;
  spentUsd: number;
  remainingUsd: number;
  alertLevel: "none" | "warning" | "critical" | "exhausted";
  // On-chain session key fields (self-custodial)
  sessionKeyTxHash: string | null;
  sessionKeyExplorerUrl: string | null;
  sessionKeyPermissions: SessionKeyPermissions | null;
};

export type AgentTransaction = {
  id: string;
  sessionId: string;
  listingId: string;
  tokenId: string;
  amount: string;
  priceUsd: number;
  status: "pending" | "confirmed" | "failed" | "curated";
  txHash: string | null;
  userOpHash: string | null;
  createdAt: string;
  confirmedAt: string | null;
  stemName: string | null;
  trackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
};

export async function enableAgentWallet(token: string): Promise<AgentWalletStatus> {
  return apiRequest<AgentWalletStatus>(
    "/wallet/agent/enable",
    { method: "POST" },
    token
  );
}

export async function registerAgentSessionKey(
  token: string,
  input: {
    serializedKey: string;
    permissions: SessionKeyPermissions;
    validUntil: string; // ISO date
    txHash?: string;
  },
): Promise<{ id: string; userId: string }> {
  return apiRequest<{ id: string; userId: string }>(
    "/wallet/agent/session-key/register",
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    },
    token
  );
}

export async function disableAgentWallet(
  token: string,
  revokeTxHash?: string,
): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(
    "/wallet/agent/session-key",
    {
      method: "DELETE",
      ...(revokeTxHash
        ? {
            body: JSON.stringify({ revokeTxHash }),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    },
    token
  );
}

export async function getAgentWalletStatus(token: string): Promise<AgentWalletStatus> {
  return apiRequest<AgentWalletStatus>(
    "/wallet/agent/status",
    {},
    token
  );
}

export async function getAgentTransactions(token: string): Promise<AgentTransaction[]> {
  return apiRequest<AgentTransaction[]>(
    "/wallet/agent/transactions",
    {},
    token
  );
}

// ========== Library API ==========

export type APILibraryTrack = {
  id: string;
  userId: string;
  source: "local" | "remote";
  title: string;
  artist?: string | null;
  albumArtist?: string | null;
  album?: string | null;
  year?: number | null;
  genre?: string | null;
  duration?: number | null;
  sourcePath?: string | null;
  fileSize?: number | null;
  catalogTrackId?: string | null;
  remoteUrl?: string | null;
  remoteArtworkUrl?: string | null;
  stemType?: string | null;
  tokenId?: string | null;
  listingId?: string | null;
  purchaseDate?: string | null;
  isOwned?: boolean;
  previewUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function saveLibraryTrackAPI(
  token: string,
  track: Omit<APILibraryTrack, "userId" | "createdAt" | "updatedAt">
) {
  return apiRequest<APILibraryTrack>(
    "/library/tracks",
    { method: "POST", body: JSON.stringify(track) },
    token
  );
}

export async function saveLibraryTracksAPI(
  token: string,
  tracks: Omit<APILibraryTrack, "userId" | "createdAt" | "updatedAt">[]
) {
  return apiRequest<APILibraryTrack[]>(
    "/library/tracks/batch",
    { method: "POST", body: JSON.stringify({ tracks }) },
    token
  );
}

export async function listLibraryTracksAPI(token: string, source?: string) {
  const query = source ? `?source=${encodeURIComponent(source)}` : "";
  return apiRequest<APILibraryTrack[]>(`/library/tracks${query}`, {}, token);
}

export async function getLibraryTrackAPI(id: string, token: string) {
  return apiRequest<APILibraryTrack>(`/library/tracks/${id}`, { silentErrorCodes: [404] }, token);
}

export async function deleteLibraryTrackAPI(id: string, token: string) {
  return apiRequest<void>(`/library/tracks/${id}`, { method: "DELETE" }, token);
}

export async function clearLocalLibraryAPI(token: string) {
  return apiRequest<void>("/library/tracks/local", { method: "DELETE" }, token);
}

// ========== Generation API ==========

export type GenerationStatusResponse = {
  jobId: string;
  status: "queued" | "generating" | "storing" | "complete" | "failed";
  trackId?: string;
  releaseId?: string;
  error?: string;
};

export async function createGeneration(
  token: string,
  input: {
    prompt: string;
    artistId: string;
    negativePrompt?: string;
    seed?: number;
  }
) {
  return apiRequest<{ jobId: string }>(
    "/generation/create",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function getGenerationStatus(token: string, jobId: string) {
  return apiRequest<GenerationStatusResponse>(
    `/generation/${jobId}/status`,
    {},
    token
  );
}

export type GenerationListItem = {
  releaseId: string;
  trackId: string;
  title: string;
  prompt: string;
  negativePrompt: string | null;
  seed: number | null;
  provider: string;
  generatedAt: string;
  durationSeconds: number;
  cost: number;
  audioUri: string | null;
};

export async function getMyGenerations(token: string) {
  return apiRequest<GenerationListItem[]>(
    "/generation/mine",
    { cache: "no-store" },
    token
  );
}

export type GenerationAnalytics = {
  totalGenerations: number;
  totalCost: number;
  rateLimit: {
    remaining: number;
    limit: number;
    resetsAt: string | null;
  };
};

export async function getGenerationAnalytics(token: string) {
  return apiRequest<GenerationAnalytics>(
    "/generation/analytics",
    { cache: "no-store" },
    token
  );
}

export async function publishAiGeneration(
  token: string,
  trackId: string,
  formData: FormData
) {
  return apiRequest<{ success: boolean; releaseId: string }>(
    `/generation/${trackId}/publish`,
    { method: "PATCH", body: formData },
    token
  );
}

export async function generateArtwork(
  token: string,
  prompt: string
): Promise<{ imageData: string; mimeType: string }> {
  return apiRequest<{ imageData: string; mimeType: string }>(
    "/generation/artwork",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    },
    token
  );
}

// ---------------------------------------------------------------------------
// Stem-Aware Generation — #336 subset
// ---------------------------------------------------------------------------

export type StemAnalysisResult = {
  trackId: string;
  trackTitle: string;
  releaseGenre?: string;
  presentTypes: string[];
  missingTypes: string[];
  suggestedPrompt: string;
  negativePrompt: string;
};

export async function analyzeTrackStems(token: string, trackId: string) {
  return apiRequest<StemAnalysisResult>(
    `/generation/analyze/${trackId}`,
    {},
    token
  );
}

export async function generateComplementaryStem(
  token: string,
  trackId: string,
  stemType: string
) {
  return apiRequest<{ jobId: string }>(
    "/generation/complementary",
    { method: "POST", body: JSON.stringify({ trackId, stemType }) },
    token
  );
}
