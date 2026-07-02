import type {
  ContentProvenanceState,
  HumanVerificationState,
  PlatformReviewState,
  RightsReviewState,
  RightsVerificationState,
} from "./verificationSemantics";
import { invalidateStoredAuthSession } from "./authSession";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const PUBLIC_RELEASE_ROUTES = new Set([
  "LIMITED_MONITORING",
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
]);

export function getReleaseArtworkUrl(
  releaseId: string,
  options?: { ownerScoped?: boolean },
) {
  if (options?.ownerScoped) {
    return `${API_BASE}/catalog/me/releases/${releaseId}/artwork`;
  }
  return `${API_BASE}/catalog/releases/${releaseId}/artwork`;
}

export function getReleaseTrackStreamUrl(
  releaseId: string,
  trackId: string,
  options?: { ownerScoped?: boolean },
) {
  if (options?.ownerScoped) {
    return `${API_BASE}/catalog/me/releases/${releaseId}/tracks/${trackId}/stream`;
  }
  return `${API_BASE}/catalog/releases/${releaseId}/tracks/${trackId}/stream`;
}

export function getStemPreviewUrl(stemId: string) {
  return `${API_BASE}/catalog/stems/${stemId}/preview`;
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
  | {
      accessToken: string;
      address?: string;
      signupFaucet?: {
        status: "sent";
        txHash: `0x${string}`;
        chainId: number;
        amountEth: string;
      };
    }
  | { status: "invalid_signature" | "invalid_nonce" };

function formatApiErrorMessage(status: number, statusText: string, detail: string) {
  const trimmedDetail = detail.trim();
  if (!trimmedDetail) {
    return `API ${status}: ${statusText}`;
  }

  try {
    const payload = JSON.parse(trimmedDetail) as { message?: string | string[]; error?: string };
    const message = Array.isArray(payload.message)
      ? payload.message.join(", ")
      : payload.message || payload.error;

    if (message) {
      return `API ${status}: ${message}`;
    }
  } catch {
    // Fall back to the raw response body when the server returned plain text.
  }

  return `API ${status}: ${trimmedDetail}`;
}

function isApiStatusError(
  error: unknown,
  allowedStatuses: number[],
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return allowedStatuses.some((status) =>
    error.message.startsWith(`API ${status}:`),
  );
}

function isPublicReleaseRoute(route?: string | null) {
  return !route || PUBLIC_RELEASE_ROUTES.has(route);
}

async function getOwnerScopedArtworkObjectUrl(
  releaseId: string,
  token: string,
): Promise<string | undefined> {
  if (
    typeof window === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return undefined;
  }

  const response = await fetch(getReleaseArtworkUrl(releaseId, { ownerScoped: true }), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return undefined;
  }

  const contentType =
    response.headers.get("Content-Type") || "application/octet-stream";
  const body = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([body], { type: contentType }));
}

export async function getOwnerScopedTrackStreamObjectUrl(
  releaseId: string,
  trackId: string,
  token: string,
): Promise<string | undefined> {
  if (
    typeof window === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return undefined;
  }

  const response = await fetch(
    getReleaseTrackStreamUrl(releaseId, trackId, { ownerScoped: true }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    return undefined;
  }

  const contentType =
    response.headers.get("Content-Type") || "audio/mpeg";
  const body = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([body], { type: contentType }));
}

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
    if (response.status === 401 && token) {
      invalidateStoredAuthSession();
    }

    throw new Error(formatApiErrorMessage(response.status, response.statusText, errorDetail));
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
  authMode?: "login" | "register";
  chainId?: number;
  /** For local dev (chainId 31337): EOA that signed; backend verifies this and issues token for address */
  signerAddress?: string;
  /** P-256 public key X coordinate (hex) for off-chain verification */
  pubKeyX?: string;
  /** P-256 public key Y coordinate (hex) for off-chain verification */
  pubKeyY?: string;
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
  processingError?: string | null;
  type: string; // SINGLE, EP, ALBUM
  primaryArtist?: string | null;
  featuredArtists?: string | null;
  genre?: string | null;
  moods?: string[];
  label?: string | null;
  releaseDate?: string | null;
  explicit: boolean;
  createdAt: string;
  artworkUrl?: string | null;
  artworkMimeType?: string | null;
  rightsRoute?: string | null;
  rightsFlags?: string[] | null;
  rightsReason?: string | null;
  rightsPolicyVersion?: string | null;
  rightsSourceType?: string | null;
  rightsEvaluatedAt?: string | null;
  tracks?: Track[];
  artist?: {
    id: string;
    displayName: string;
    userId?: string | null;
    payoutAddress?: string | null;
  };
  artistCredits?: ReleaseArtistCredit[];
  /** Present for `type === "remix"` releases published from the studio (#1196). */
  remix?: RemixReleaseProvenance | null;
};

/** Source attribution + AI provenance for a published remix release (#1196). */
export type RemixReleaseProvenance = {
  attribution: string;
  sourceTrackId: string | null;
  sourceReleaseId: string | null;
  sourceTrackTitle: string | null;
  sourceArtistName: string | null;
  grounding:
    | "stem_audio"
    | "stem_plus_ai"
    | "audio_conditioned"
    | "feature_conditioned"
    | "prompt_only"
    | string
    | null;
  aiGenerated: boolean;
  remixProjectId: string | null;
};

export type ReleaseArtistCredit = {
  id: string;
  releaseId: string;
  artistId: string;
  role: string;
  displayName: string;
  sortOrder: number;
  artist?: {
    id: string;
    displayName: string;
    profileType?: string | null;
    claimStatus?: string | null;
    imageUrl?: string | null;
    summary?: string | null;
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
  processingError?: string | null;
  contentStatus?: string | null;
  rightsRoute?: string | null;
  rightsFlags?: string[] | null;
  rightsReason?: string | null;
  rightsPolicyVersion?: string | null;
  rightsEvaluatedAt?: string | null;
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
  visibility?: PlaylistVisibility;
  createdAt: string;
  updatedAt: string;
};

export type PlaylistVisibility = "private" | "public";

export type PublicPlaylistTrack = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  /** Public catalog stream path (prepend API_BASE), or null for owner-device-only tracks. */
  streamPath: string | null;
  artworkPath: string | null;
  catalogTrackId: string | null;
  releaseId: string | null;
  playable: boolean;
};

export type PublicPlaylistView = {
  id: string;
  name: string;
  visibility: PlaylistVisibility;
  ownerUserId: string;
  ownerDisplayName: string | null;
  isOwner: boolean;
  isSaved: boolean;
  trackCount: number;
  playableTrackCount: number;
  tracks: PublicPlaylistTrack[];
  createdAt: string;
  updatedAt: string;
};

export type SavedPlaylistView = PublicPlaylistView & {
  savedPlaylistId: string;
  savedAt: string;
  available: boolean;
};

/** A public playlist as it appears in catalog/discovery surfaces (cover mosaic + counts). */
export type PublicPlaylistSummary = {
  id: string;
  name: string;
  ownerUserId: string;
  ownerDisplayName: string | null;
  trackCount: number;
  playableTrackCount: number;
  /** Absolute artwork URLs (already prefixed with API_BASE), up to 4, for a cover mosaic. */
  coverArtworkUrls: string[];
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
  userId?: string | null;
  displayName: string;
  payoutAddress?: string | null;
  profileType?: string | null;
  claimStatus?: string | null;
  imageUrl?: string | null;
  summary?: string | null;
  socialLinks?: Record<string, unknown> | null;
  remixConsent?: ArtistRemixConsent | null;
};

export type ArtistRemixConsent = "allowed" | "disabled";

export type ArtistSettingsResponse = {
  schemaVersion: "artist-settings/v1";
  artistId: string;
  remixConsent: ArtistRemixConsent;
  updatedAt: string;
};

export type ArtistAnalyticsPayout = {
  paymentToken: string;
  assetId: string | null;
  symbol: string;
  decimals: number;
  settlementAmount: string;
  settlementAmountUnits: string;
  canonicalAmountUsd: number;
  count: number;
};

export type ArtistAnalyticsTrack = {
  trackId: string;
  title: string;
  plays: number;
  payoutUsd: number;
  payoutsByAsset: ArtistAnalyticsPayout[];
};

export type ArtistAnalyticsTimePoint = {
  date: string;
  plays: number;
  payoutUsd: number;
};

export type ArtistAnalyticsProtectionRoute = {
  route: string;
  decisions: number;
  releases: number;
  latestDecisionAt: string | null;
};

export type ArtistAnalyticsProtection = {
  totalDecisions: number;
  releasesWithDecisions: number;
  marketplaceReadyReleases: number;
  restrictedReleases: number;
  blockedReleases: number;
  routes: ArtistAnalyticsProtectionRoute[];
};

export type ArtistActionCard = {
  id: string;
  type:
    | "promote_top_track"
    | "review_marketplace_readiness"
    | "start_listener_community"
    | "prepare_marketplace_catalog"
    | "review_show_city_demand"
    | "post_campaign_update"
    | "create_holder_benefit"
    | "invite_holder_collectors"
    | "reward_early_supporters"
    | "prepare_remix_challenge"
    | "review_remix_supply_pricing"
    | "triage_fan_questions"
    | "relist_expired_inventory"
    | "improve_marketplace_conversion"
    | "review_marketplace_pricing";
  title: string;
  description: string;
  reason: string;
  priority: "high" | "medium" | "low";
  confidence: number;
  sourceSignal: {
    category: "playback" | "marketplace" | "community" | "catalog" | "shows" | "remix";
    summary: string;
    count?: number;
  };
  cta: {
    label: string;
    href?: string;
    disabled?: boolean;
    disabledReason?: string;
  };
  privacy: {
    aggregateOnly: true;
    thresholdApplied: boolean;
    minimumThreshold?: number;
  };
};

export type ArtistAnalyticsMeta = {
  source: "warehouse_export" | "bigquery";
  generatedAt: string;
  timeWindow: {
    from: string;
    to: string;
    days: number;
  };
  freshness: {
    asOf: string | null;
    lagSeconds: number | null;
  };
  isEmpty: boolean;
  cache: {
    hit: boolean;
    ttlSeconds: number;
  };
  query?: {
    projectId: string;
    datasetId: string;
    factsTable: string;
    viewsTable: string;
    maximumBytesBilled: string;
    totalBytesProcessed?: string;
    cacheHit?: boolean;
  };
};

export type ArtistAnalyticsDashboard = {
  summary: {
    artistId: string;
    days: number;
    totalPlays: number;
    totalPayoutUsd: number;
    payoutsByAsset: ArtistAnalyticsPayout[];
  };
  tracks: ArtistAnalyticsTrack[];
  topTracks: ArtistAnalyticsTrack[];
  sessions: Array<{
    sessionId: string;
    plays: number;
    payoutUsd: number;
    payoutsByAsset: ArtistAnalyticsPayout[];
  }>;
  sources: Array<{
    source: string;
    plays: number;
  }>;
  protection: ArtistAnalyticsProtection;
  actions?: ArtistActionCard[];
  playsOverTime: ArtistAnalyticsTimePoint[];
  trackPerformance: ArtistAnalyticsTrack[];
  listenerGrowth?: {
    status: "unavailable";
    reason: string;
  };
  export: {
    artistId: string;
    days: number;
    totalPlays: number;
    totalPayoutUsd: number;
    payoutsByAsset: ArtistAnalyticsPayout[];
    generatedAt: string;
    source: "warehouse_export" | "bigquery";
    freshness: ArtistAnalyticsMeta["freshness"];
  };
  meta: ArtistAnalyticsMeta;
};

export type AgentQualityBreakdown = {
  key: string;
  label: string;
  sessionsStarted: number;
  nextPickRequests: number;
  acceptedPicks: number;
  acceptanceRate: number;
  completionRate: number;
  saveRate: number;
  purchaseRate: number;
  averageSessionDurationMs: number | null;
};

export type AgentQualityTimePoint = {
  date: string;
  sessionsStarted: number;
  nextPickRequests: number;
  acceptedPicks: number;
  completions: number;
  saves: number;
  purchases: number;
};

export type AgentQualityDashboard = {
  summary: {
    days: number;
    sessionsStarted: number;
    sessionsStopped: number;
    intentSelections: number;
    nextPickRequests: number;
    acceptedPicks: number;
    playbackCompletions: number;
    firstPickSkips: number;
    firstPickOutcomes: number;
    saves: number;
    playlistAdds: number;
    purchases: number;
    purchaseUsd: number;
    averageSessionDurationMs: number | null;
    acceptanceRate: number;
    firstPickSkipRate: number;
    completionRate: number;
    saveRate: number;
    playlistAddRate: number;
    purchaseRate: number;
  };
  intentBreakdown: AgentQualityBreakdown[];
  strategyBreakdown: AgentQualityBreakdown[];
  tasteSourceBreakdown: AgentQualityBreakdown[];
  versionBreakdown: AgentQualityBreakdown[];
  qualityOverTime: AgentQualityTimePoint[];
  privacy: {
    aggregation: string;
    excludes: string[];
  };
  meta: ArtistAnalyticsMeta;
};

export async function getArtistMe(token: string) {
  const isMockAuth = (typeof window !== "undefined" && localStorage.getItem("resonate.mock_auth") === "true") || process.env.NEXT_PUBLIC_MOCK_AUTH === "true";

  if (isMockAuth) {
    return {
      id: "test-artist-id",
      userId: "test-user",
      displayName: "Test Artist",
      payoutAddress: "0x742d35Cc6634C0532925a3b844Bc17e7595f1ea2c",
      remixConsent: "allowed" as const,
    };
  }
  return apiRequest<ArtistProfile | null>("/artists/me", { silentErrorCodes: [401] }, token);
}

export type ArtistSearchResult = {
  id: string;
  displayName: string;
  imageUrl?: string | null;
  profileType?: string | null;
  claimStatus?: string | null;
};

/**
 * Typeahead lookup of existing artist profiles, used by the upload studio so
 * artists can reuse an existing profile instead of accidentally creating a
 * duplicate via a typo or casing/spacing difference. Degrades gracefully: on
 * any error (offline, unauthenticated, mock mode) it returns an empty list so
 * the field still works as a plain text input.
 */
export async function searchArtists(
  token: string | null | undefined,
  query: string,
  limit = 8,
): Promise<ArtistSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const params = new URLSearchParams({ q, limit: String(limit) });
    const results = await apiRequest<ArtistSearchResult[]>(
      `/artists/search?${params}`,
      { silentErrorCodes: [400, 401, 403] },
      token,
    );
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

export async function getArtistSettings(token: string, artistId: string) {
  return apiRequest<ArtistSettingsResponse>(
    `/artists/${encodeURIComponent(artistId)}/settings`,
    { cache: "no-store", silentErrorCodes: [403, 404] },
    token,
  );
}

export async function updateArtistSettings(
  token: string,
  artistId: string,
  input: { remixConsent: ArtistRemixConsent },
) {
  return apiRequest<ArtistSettingsResponse>(
    `/artists/${encodeURIComponent(artistId)}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify({ remixConsent: input.remixConsent }),
      silentErrorCodes: [403, 404],
    },
    token,
  );
}

export async function getArtistAnalyticsDashboard(
  token: string,
  artistId: string,
  days = 30,
) {
  const search = new URLSearchParams({ days: String(days) });
  return apiRequest<ArtistAnalyticsDashboard>(
    `/analytics/artist/${encodeURIComponent(artistId)}/v1?${search.toString()}`,
    { cache: "no-store" },
    token,
  );
}

export async function getAgentQualityDashboard(
  token: string,
  days = 30,
) {
  const search = new URLSearchParams({ days: String(days) });
  return apiRequest<AgentQualityDashboard>(
    `/analytics/agent/quality?${search.toString()}`,
    { cache: "no-store" },
    token,
  );
}

export type PlaybackCompletedAnalyticsInput = {
  trackId: string;
  artistId?: string;
  releaseId?: string;
  sessionId?: string;
  source?: string;
  initiator?: "listener" | "external_agent" | "ai_dj";
  agentOriginated?: boolean;
  agentSessionId?: string;
  playbackCommandId?: string;
  completionRatio: number;
  durationMs?: number;
};

export async function recordPlaybackCompleted(
  token: string,
  input: PlaybackCompletedAnalyticsInput,
) {
  return apiRequest<{ status: string; eventId: string; ingested: number }>(
    "/analytics/playback/completed",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export type PlaybackLifecycleAnalyticsInput = {
  action: "started" | "heartbeat";
  trackId: string;
  artistId?: string;
  releaseId?: string;
  sessionId?: string;
  playbackInstanceId?: string;
  source?: string;
  initiator?: "listener" | "external_agent" | "ai_dj";
  agentOriginated?: boolean;
  agentSessionId?: string;
  playbackCommandId?: string;
  positionMs?: number;
  durationMs?: number;
  heartbeatIntervalMs?: number;
  queueIndex?: number;
  queueLength?: number;
  repeatMode?: "none" | "one" | "all";
  shuffle?: boolean;
};

export async function recordPlaybackEvent(
  token: string,
  input: PlaybackLifecycleAnalyticsInput,
) {
  return apiRequest<{ status: string; eventId: string; ingested: number }>(
    "/analytics/playback/event",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export type PlaybackCapabilityScope =
  | "playback.intent"
  | "playback.resolve"
  | "playback.queue"
  | "playback.play"
  | "playback.control"
  | "playback.status";

export type PlaybackIntentOutcome =
  | "queued"
  | "playing"
  | "confirmation_required"
  | "no_active_device"
  | "blocked_by_policy"
  | "unavailable";

export type PlaybackConfirmationMode =
  | "propose_only"
  | "queue_with_confirmation"
  | "remote_control_when_active";

export type PlaybackCapability = {
  id: string;
  ownerUserId: string;
  scopes: PlaybackCapabilityScope[];
  allowedSources: string[];
  confirmationMode: PlaybackConfirmationMode;
  expiresAt?: string;
  revokedAt?: string;
  rateLimitPerMinute: number;
  createdAt: string;
};

export type PlaybackDevice = {
  deviceId: string;
  ownerUserId: string;
  label: string;
  active: boolean;
  supports: PlaybackCapabilityScope[];
  currentTrackId?: string;
  state: "idle" | "playing" | "paused";
  lastSeenAt: string;
};

export type PlaybackIntentCandidate = {
  trackId: string;
  title: string;
  artistId?: string;
  artistName?: string | null;
  releaseId?: string;
  releaseTitle?: string | null;
  explicit: boolean;
  source: "catalog";
  playable: true;
  reasons: string[];
};

export type PlaybackIntentResolveResponse = {
  ownerUserId: string;
  capabilityId: string;
  outcome: PlaybackIntentOutcome;
  policy: {
    capabilityId: string;
    scopes: PlaybackCapabilityScope[];
    allowedSources: string[];
    confirmationMode: PlaybackConfirmationMode;
    paymentOrLicensingAllowed: false;
    requiresActiveDevice: true;
    reason?: string;
  };
  candidates: PlaybackIntentCandidate[];
  nextAllowedCommands: string[];
  redaction: {
    privateLibrary: "redacted";
    privateTaste: "redacted";
    wallet: "redacted";
    ownership: "redacted";
  };
};

export type PlaybackIntentCommand = {
  commandId: string;
  ownerUserId: string;
  action: "queue" | "play" | "pause" | "resume" | "skip" | "seek" | "stop";
  status: "pending" | "pending_confirmation" | "queued" | "playing" | "blocked" | "unavailable";
  outcome: PlaybackIntentOutcome;
  trackIds: string[];
  deviceId?: string;
  sessionId?: string;
  capabilityId: string;
  requiresConfirmation: boolean;
  initiator: "listener" | "external_agent" | "ai_dj";
  agentOriginated: boolean;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  reason?: string;
};

export async function getPlaybackCapabilities(token: string) {
  return apiRequest<{
    ownerUserId: string;
    capability: PlaybackCapability;
    activeDevices: PlaybackDevice[];
    available: boolean;
    policy: {
      accountlessPlayback: false;
      paymentOrLicensingAllowed: false;
      defaultConfirmationMode: PlaybackConfirmationMode;
      analyticsMarkersRequired: true;
    };
  }>("/sessions/playback/capabilities", { cache: "no-store" }, token);
}

export async function registerPlaybackDevice(
  token: string,
  input: Partial<Pick<PlaybackDevice, "deviceId" | "label" | "active" | "supports" | "currentTrackId" | "state">>,
) {
  return apiRequest<PlaybackDevice>(
    "/sessions/playback/device",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function resolvePlaybackIntent(
  token: string,
  input: {
    query?: string;
    constraints?: {
      maxTracks?: number;
      explicit?: boolean;
      source?: "resonate_catalog" | "library" | "purchased" | "preview";
      genres?: string[];
      mood?: string;
    };
    capabilityId?: string;
    initiator?: "listener" | "external_agent" | "ai_dj";
    sessionId?: string;
  },
) {
  return apiRequest<PlaybackIntentResolveResponse>(
    "/sessions/playback/resolve",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function queuePlaybackIntent(
  token: string,
  input: {
    trackIds: string[];
    deviceId?: string;
    sessionId?: string;
    capabilityId?: string;
    source?: "resonate_catalog" | "library" | "purchased" | "preview";
    initiator?: "listener" | "external_agent" | "ai_dj";
    agentOriginated?: boolean;
  },
) {
  return apiRequest<PlaybackIntentCommand>(
    "/sessions/playback/queue",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function playPlaybackIntent(
  token: string,
  input: Parameters<typeof queuePlaybackIntent>[1],
) {
  return apiRequest<PlaybackIntentCommand>(
    "/sessions/playback/play",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function confirmPlaybackCommand(
  token: string,
  commandId: string,
  input: {
    deviceId?: string;
    outcome: PlaybackIntentOutcome;
    status?: PlaybackIntentCommand["status"];
    currentTrackId?: string;
    reason?: string;
  },
) {
  return apiRequest<PlaybackIntentCommand>(
    `/sessions/playback/commands/${encodeURIComponent(commandId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function getPlaybackIntentStatus(token: string, commandId?: string) {
  const search = commandId ? `?commandId=${encodeURIComponent(commandId)}` : "";
  return apiRequest<PlaybackIntentCommand | {
    ownerUserId: string;
    activeDevices: PlaybackDevice[];
    commands: PlaybackIntentCommand[];
  }>(`/sessions/playback/status${search}`, { cache: "no-store" }, token);
}

export type ProductAnalyticsInput = {
  eventName: string;
  sessionId?: string;
  traceId?: string;
  subjectType?: string;
  subjectId?: string;
  source?: string;
  clientEventId?: string;
  payload?: Record<string, unknown>;
};

export async function recordProductAnalyticsEvent(
  token: string,
  input: ProductAnalyticsInput,
) {
  return apiRequest<{ status: string; eventId: string; ingested: number }>(
    "/analytics/product/event",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export type TrustTier = {
  artistId: string;
  tier: string;
  economicTier?: string;
  stakeAmountWei: string;
  stakeAmountUsd?: string;
  tierStakeAmountWei?: string;
  tierStakeAmountUsd?: string;
  protocolMinimumStakeAmountWei?: string;
  protocolMinimumStakeAmountUsd?: string;
  policySource?: "contract" | "fallback";
  escrowDays: number;
  maxPriceMultiplier: number;
  maxListingPriceWei: string | null;
  maxListingPriceUsd?: string | null;
  maxListingPriceUncapped: boolean;
  totalUploads: number;
  cleanHistory: number;
  disputesLost: number;
  humanVerificationStatus?: HumanVerificationState;
  humanVerifiedAt?: string | null;
  platformReviewStatus?: PlatformReviewState;
};

export type HumanVerificationStatus = {
  verified: boolean;
  provider: string | null;
  status: string;
  score: number | null;
  threshold: number | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  requiredAfterReports: number;
  availableProviders?: Array<"mock" | "passport" | "worldcoin">;
  defaultProvider?: "mock" | "passport" | "worldcoin";
};

export type CuratorStakeTier = {
  key: string;
  label: string;
  description: string;
  multiplierBps: number;
};

export type CuratorBadge = {
  key: string;
  label: string;
  tone: "neutral" | "success" | "warning";
  description: string;
};

export type CuratorProfile = {
  walletAddress: string;
  score: number;
  effectiveScore: number;
  decayPenalty: number;
  successfulFlags: number;
  rejectedFlags: number;
  totalBounties: number;
  reportsFiled: number;
  activeReports: number;
  resolutionRate: number | null;
  lastActiveAt: string | null;
  stakeTier: CuratorStakeTier;
  humanVerification: HumanVerificationStatus;
  requiresHumanVerification: boolean;
  badges: CuratorBadge[];
};

export type CuratorReportingPolicy = {
  walletAddress: string;
  reportsFiled: number;
  requiresHumanVerification: boolean;
  message: string;
  stakeTier: CuratorStakeTier;
  humanVerification: HumanVerificationStatus;
};

export type ReleaseContentProtectionData = {
  tokenId?: string | null;
  staked: boolean;
  attested: boolean;
  stakeAmount: string;
  depositedAt: string;
  active: boolean;
  escrowDays: number;
  trustTier: string;
  economicTrustTier?: string;
  humanVerificationStatus?: HumanVerificationState;
  humanVerifiedAt?: string | null;
  platformReviewStatus?: PlatformReviewState;
  attestedAt: string;
  provenanceStatus?: ContentProvenanceState;
  rightsReviewState?: RightsReviewState;
  rightsVerificationStatus?: RightsVerificationState;
  rightsUpgradeRequestStatus?: ReleaseRightsUpgradeRequestStatus | null;
  rightsUpgradeRequestedRoute?: "STANDARD_ESCROW" | "TRUSTED_FAST_PATH" | null;
  rightsUpgradeDecisionReason?: string | null;
  rightsUpgradeReviewedAt?: string | null;
};

export type RightsEvidenceSubjectType =
  | "upload"
  | "release"
  | "track"
  | "dispute"
  | "trusted_source_link_request";
export type RightsEvidenceRole = "reporter" | "creator" | "ops" | "trusted_source" | "system";
export type RightsEvidenceKind =
  | "trusted_catalog_reference"
  | "fingerprint_match"
  | "prior_publication"
  | "rights_metadata"
  | "proof_of_control"
  | "legal_notice"
  | "narrative_statement"
  | "internal_review_note";
export type RightsEvidenceStrength = "low" | "medium" | "high" | "very_high";
export type RightsEvidenceVerificationStatus =
  | "unverified"
  | "verified"
  | "rejected"
  | "system_generated";
export type RightsEvidenceBundlePurpose =
  | "upload_review"
  | "dispute_report"
  | "creator_response"
  | "ops_review"
  | "jury_packet"
  | "rights_upgrade_request"
  | "trusted_source_link_request";

export type TrustedSourceType =
  | "distributor"
  | "label"
  | "official_artist_team"
  | "catalog_operator";
export type TrustedSourceTrustLevel = "standard" | "high" | "very_high";
export type TrustedSourceReviewState =
  | "pending_review"
  | "active"
  | "suspended"
  | "revoked"
  | "denied";
export type TrustedSourceLinkStatus = "active" | "suspended" | "revoked";
export type TrustedSourceLinkRequestStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "denied";

export type ReleaseRightsUpgradeRequestStatus =
  | "submitted"
  | "under_review"
  | "more_evidence_requested"
  | "approved_standard_escrow"
  | "approved_trusted_fast_path"
  | "denied";

export type ReleaseRightsUpgradeRequestedRoute =
  | "STANDARD_ESCROW"
  | "TRUSTED_FAST_PATH";

export type UploadRightsRoute =
  | "BLOCKED"
  | "QUARANTINED_REVIEW"
  | "LIMITED_MONITORING"
  | "STANDARD_ESCROW"
  | "TRUSTED_FAST_PATH";

export type RightsRouteReassessmentTrigger =
  | "evidence_submitted"
  | "trusted_source_linked"
  | "trusted_source_revoked"
  | "dispute_opened"
  | "appeal_opened"
  | "dmca_takedown"
  | "fingerprint_conflict"
  | "audit_sample"
  | "manual_review";

export type RightsRouteReassessmentStatus =
  | "pending_review"
  | "applied"
  | "confirmed_current"
  | "dismissed";

export type RightsEvidenceInput = {
  kind: RightsEvidenceKind;
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  claimedRightsholder?: string | null;
  artistName?: string | null;
  releaseTitle?: string | null;
  publicationDate?: string | null;
  isrc?: string | null;
  upc?: string | null;
  fingerprintConfidence?: number | null;
  strength?: RightsEvidenceStrength;
  verificationStatus?: RightsEvidenceVerificationStatus;
  attachments?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type RightsEvidenceBundleInput = {
  subjectType: RightsEvidenceSubjectType;
  subjectId: string;
  submittedByRole: RightsEvidenceRole;
  submittedByAddress?: string | null;
  purpose: RightsEvidenceBundlePurpose;
  summary?: string | null;
  evidences: RightsEvidenceInput[];
};

export type RightsEvidenceRecord = RightsEvidenceInput & {
  id: string;
  subjectType: RightsEvidenceSubjectType;
  subjectId: string;
  submittedByRole: RightsEvidenceRole;
  submittedByAddress?: string | null;
  createdAt: string;
};

export type RightsEvidenceBundleRecord = {
  id: string;
  rightsUpgradeRequestId?: string | null;
  subjectType: RightsEvidenceSubjectType;
  subjectId: string;
  submittedByRole: RightsEvidenceRole;
  submittedByAddress?: string | null;
  purpose: RightsEvidenceBundlePurpose;
  summary?: string | null;
  createdAt: string;
  evidences: RightsEvidenceRecord[];
};

export type TrustedSourceRecord = {
  id: string;
  type: TrustedSourceType;
  name: string;
  sourceKey: string;
  trustLevel: TrustedSourceTrustLevel;
  reviewState: TrustedSourceReviewState;
  domain?: string | null;
  feedUrl?: string | null;
  traceability?: Record<string, unknown> | null;
  createdByAddress?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  revokedAt?: string | null;
  downgradedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrustedSourceArtistLinkRecord = {
  id: string;
  artistId: string;
  trustedSourceId: string;
  status: TrustedSourceLinkStatus;
  trustLevel: TrustedSourceTrustLevel;
  sourceType: TrustedSourceType;
  approvedBy?: string | null;
  approvedAt?: string | null;
  revokedBy?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  trustedSource?: TrustedSourceRecord;
};

export type TrustedSourceLinkRequestRecord = {
  id: string;
  artistId: string;
  trustedSourceId?: string | null;
  requesterAddress: string;
  requestedSourceType: TrustedSourceType;
  sourceName: string;
  sourceKey: string;
  requestedTrustLevel: TrustedSourceTrustLevel;
  proofSummary: string;
  status: TrustedSourceLinkRequestStatus;
  decisionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  artist?: {
    id: string;
    userId: string;
    displayName: string;
  };
  trustedSource?: TrustedSourceRecord | null;
  evidenceBundles?: RightsEvidenceBundleRecord[];
};

export type ReleaseRightsUpgradeRequestRecord = {
  id: string;
  releaseId: string;
  artistId: string;
  requestedByAddress: string;
  status: ReleaseRightsUpgradeRequestStatus;
  derivedRightsReviewState?: RightsReviewState | null;
  derivedRightsVerificationStatus?: RightsVerificationState | null;
  requestedRoute: ReleaseRightsUpgradeRequestedRoute;
  currentRouteAtSubmission?: string | null;
  summary?: string | null;
  decisionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  release?: {
    id: string;
    title: string;
    rightsRoute?: string | null;
    rightsFlags?: string[] | null;
    rightsReason?: string | null;
    artist?: {
      id: string;
      userId: string;
      displayName: string;
    } | null;
  } | null;
  evidenceBundles?: RightsEvidenceBundleRecord[];
};

export type RightsRouteReassessmentRecord = {
  id: string;
  releaseId: string;
  trigger: RightsRouteReassessmentTrigger;
  status: RightsRouteReassessmentStatus;
  previousRoute?: UploadRightsRoute | string | null;
  recommendedRoute?: UploadRightsRoute | string | null;
  nextRoute?: UploadRightsRoute | string | null;
  reason: string;
  actorAddress?: string | null;
  evidenceSubjectType?: string | null;
  evidenceSubjectId?: string | null;
  trustedSourceLinkId?: string | null;
  rightsUpgradeRequestId?: string | null;
  policyVersion?: string | null;
  flags?: string[] | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  release?: {
    id: string;
    title: string;
    artistId: string;
    rightsRoute?: string | null;
    rightsFlags?: string[] | null;
    rightsReason?: string | null;
    rightsSourceType?: string | null;
    artist?: {
      id: string;
      userId: string;
      displayName: string;
    } | null;
  } | null;
};

export async function getTrustTier(artistId: string, token: string) {
  return apiRequest<TrustTier>(`/api/trust/${artistId}`, { silentErrorCodes: [404] }, token);
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

export async function getCuratorProfile(address: string) {
  return apiRequest<CuratorProfile>(`/metadata/curators/${address.toLowerCase()}`);
}

export async function getCuratorLeaderboard(limit = 20) {
  return apiRequest<CuratorProfile[]>(`/metadata/curators/leaderboard?limit=${limit}`);
}

export async function getCuratorReportingPolicy(address: string) {
  return apiRequest<CuratorReportingPolicy>(`/metadata/curators/${address.toLowerCase()}/reporting-policy`);
}

export async function getHumanVerificationStatus(address: string) {
  return apiRequest<HumanVerificationStatus>(`/metadata/curators/${address.toLowerCase()}/verification`);
}

export async function getReleaseContentProtectionStatus(releaseId: string) {
  const response = await fetch(`${API_BASE}/metadata/content-protection/release/${releaseId}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`API ${response.status}: ${detail || response.statusText}`);
  }
  return response.json() as Promise<ReleaseContentProtectionData>;
}

export async function submitHumanVerification(
  address: string,
  input: { provider?: string; proof?: string },
) {
  return apiRequest<CuratorProfile>(`/metadata/curators/${address.toLowerCase()}/verification`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function submitRightsEvidenceBundle(
  input: RightsEvidenceBundleInput,
  token: string,
) {
  return apiRequest<RightsEvidenceBundleRecord>("/metadata/evidence/bundles", {
    method: "POST",
    body: JSON.stringify(input),
  }, token);
}

export async function createRightsRouteReassessment(
  releaseId: string,
  input: {
    trigger?: RightsRouteReassessmentTrigger;
    reason?: string;
    recommendedRoute?: UploadRightsRoute;
    evidenceSubjectType?: string;
    evidenceSubjectId?: string;
    trustedSourceLinkId?: string;
    rightsUpgradeRequestId?: string;
    flags?: string[];
  },
  token: string,
) {
  return apiRequest<RightsRouteReassessmentRecord>(
    `/metadata/rights-reassessments/releases/${releaseId}`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function sampleRightsRouteAudits(
  input: { limit?: number; reason?: string },
  token: string,
) {
  return apiRequest<RightsRouteReassessmentRecord[]>(
    "/metadata/rights-reassessments/audit-sample",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function listPendingRightsRouteReassessments(
  token: string,
  limit = 20,
) {
  return apiRequest<RightsRouteReassessmentRecord[]>(
    `/metadata/rights-reassessments/pending?limit=${limit}`,
    {},
    token,
  );
}

export async function listReleaseRightsRouteReassessmentHistory(
  releaseId: string,
  token: string,
) {
  return apiRequest<RightsRouteReassessmentRecord[]>(
    `/metadata/rights-reassessments/releases/${releaseId}`,
    {},
    token,
  );
}

export async function reviewRightsRouteReassessment(
  reassessmentId: string,
  input: {
    action: "apply_route" | "confirm_current" | "dismiss";
    nextRoute?: UploadRightsRoute;
    reason?: string;
  },
  token: string,
) {
  return apiRequest<RightsRouteReassessmentRecord>(
    `/metadata/rights-reassessments/${reassessmentId}/review`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function submitTrustedSourceLinkRequest(
  input: {
    requestedSourceType: TrustedSourceType;
    sourceName: string;
    sourceKey?: string;
    requestedTrustLevel?: TrustedSourceTrustLevel;
    proofSummary: string;
    domain?: string;
    feedUrl?: string;
    traceability?: Record<string, unknown>;
    evidences?: RightsEvidenceInput[];
  },
  token: string,
) {
  return apiRequest<TrustedSourceLinkRequestRecord>(
    "/metadata/trusted-sources/link-requests",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function listMyTrustedSourceLinkRequests(token: string) {
  return apiRequest<TrustedSourceLinkRequestRecord[]>(
    "/metadata/trusted-sources/link-requests/me",
    {},
    token,
  );
}

export async function listMyTrustedSourceLinks(token: string) {
  return apiRequest<TrustedSourceArtistLinkRecord[]>(
    "/metadata/trusted-sources/links/me",
    {},
    token,
  );
}

export async function listPendingTrustedSourceLinkRequests(
  token: string,
  limit = 20,
) {
  return apiRequest<TrustedSourceLinkRequestRecord[]>(
    `/metadata/trusted-sources/link-requests/pending?limit=${limit}`,
    {},
    token,
  );
}

export async function reviewTrustedSourceLinkRequest(
  requestId: string,
  input: {
    action: "under_review" | "approve" | "deny";
    decisionReason?: string;
    trustLevel?: TrustedSourceTrustLevel;
    reviewState?: "active" | "suspended" | "revoked";
  },
  token: string,
) {
  return apiRequest<TrustedSourceLinkRequestRecord>(
    `/metadata/trusted-sources/link-requests/${requestId}/review`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function revokeTrustedSourceArtistLink(
  linkId: string,
  input: { reason?: string },
  token: string,
) {
  return apiRequest<TrustedSourceArtistLinkRecord>(
    `/metadata/trusted-sources/links/${linkId}/revoke`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function getLatestReleaseRightsUpgradeRequest(
  releaseId: string,
  token: string,
) {
  return apiRequest<ReleaseRightsUpgradeRequestRecord | null>(
    `/metadata/release-rights/releases/${releaseId}`,
    {},
    token,
  );
}

export async function submitReleaseRightsUpgradeRequest(
  releaseId: string,
  input: {
    summary: string;
    requestedRoute?: ReleaseRightsUpgradeRequestedRoute;
    evidences: RightsEvidenceInput[];
  },
  token: string,
) {
  return apiRequest<ReleaseRightsUpgradeRequestRecord>(
    `/metadata/release-rights/releases/${releaseId}/request`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function listPendingReleaseRightsUpgradeRequests(
  token: string,
  limit = 20,
) {
  return apiRequest<ReleaseRightsUpgradeRequestRecord[]>(
    `/metadata/release-rights/requests/pending?limit=${limit}`,
    {},
    token,
  );
}

export async function getReleaseRightsUpgradeRequestById(
  requestId: string,
  token: string,
) {
  return apiRequest<ReleaseRightsUpgradeRequestRecord>(
    `/metadata/release-rights/requests/${requestId}`,
    {},
    token,
  );
}

export async function reviewReleaseRightsUpgradeRequest(
  requestId: string,
  input: {
    action: ReleaseRightsUpgradeRequestStatus;
    decisionReason?: string;
    note?: string;
    evidences?: RightsEvidenceInput[];
  },
  token: string,
) {
  return apiRequest<ReleaseRightsUpgradeRequestRecord>(
    `/metadata/release-rights/requests/${requestId}/review`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );
}

export async function createRelease(
  token: string,
  input: {
    title: string;
    type?: string;
    primaryArtist?: string;
    featuredArtists?: string[];
    artistCredits?: Array<{
      artistId?: string | null;
      displayName?: string | null;
      role: string;
      sortOrder?: number;
    }>;
    genre?: string;
    moods?: string[];
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
  let release: Release | null = null;
  let usedOwnerScopedEndpoint = false;

  if (token) {
    try {
      release = await apiRequest<Release>(
        `/catalog/me/releases/${releaseId}`,
        {},
        token,
      );
      usedOwnerScopedEndpoint = !!release;
    } catch (error) {
      if (!isApiStatusError(error, [401, 403, 404])) {
        throw error;
      }
    }
  }

  if (!release) {
    release = await apiRequest<Release>(`/catalog/releases/${releaseId}`, {}, token);
  }

  if (release && release.artworkMimeType) {
    if (
      token &&
      usedOwnerScopedEndpoint &&
      !isPublicReleaseRoute(release.rightsRoute)
    ) {
      release.artworkUrl =
        (await getOwnerScopedArtworkObjectUrl(release.id, token)) ||
        undefined;
    } else {
      release.artworkUrl = getReleaseArtworkUrl(release.id);
    }
  }
  return release;
}

export async function waitForReleaseAvailability(
  releaseId: string,
  options: {
    token?: string | null;
    timeoutMs?: number;
    intervalMs?: number;
  } = {}
) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      return await getRelease(releaseId, options.token);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("API 404:")) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError ?? new Error(`Release ${releaseId} is not available yet`);
}

export async function getTrack(trackId: string, token?: string | null) {
  const track = await apiRequest<Track>(`/catalog/tracks/${trackId}`, {}, token);
  if (track && track.release && track.release.artworkMimeType) {
    track.release.artworkUrl = getReleaseArtworkUrl(track.release.id);
  }
  return track;
}

export type PlayerTrackActionKey =
  | "save"
  | "add_to_playlist"
  | "inspect_stems"
  | "buy_license"
  | "remix"
  | "artist_room"
  | "shows_campaign"
  | "collect_drop";

export type PlayerTrackActionStatus = "available" | "disabled" | "planned";

export type PlayerTrackAction = {
  key: PlayerTrackActionKey;
  label: string;
  status: PlayerTrackActionStatus;
  href?: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean | string[] | null>;
};

export type PlayerTrackActionsResponse = {
  track: {
    id: string;
    title: string;
    releaseId: string;
    releaseTitle: string;
    artistId: string;
    artistName: string | null;
    genre: string | null;
    moods: string[];
  };
  recommendation?: {
    summary: string;
    reasons: string[];
  };
  actions: PlayerTrackAction[];
};

export async function getPlayerTrackActions(
  trackId: string,
  input: { reasons?: string[] } = {},
) {
  const params = new URLSearchParams();
  for (const reason of input.reasons ?? []) {
    if (reason.trim()) params.append("reason", reason.trim());
  }
  const query = params.toString();
  return apiRequest<PlayerTrackActionsResponse>(
    `/catalog/tracks/${encodeURIComponent(trackId)}/actions${query ? `?${query}` : ""}`,
  );
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

type PublicPlaylistSummaryResponse = Omit<PublicPlaylistSummary, "coverArtworkUrls"> & {
  coverArtworkPaths?: string[];
};

/** Resolve the backend's relative catalog artwork paths into absolute, renderable URLs. */
export function mapPublicPlaylistSummary(item: PublicPlaylistSummaryResponse): PublicPlaylistSummary {
  const { coverArtworkPaths, ...rest } = item;
  return {
    ...rest,
    coverArtworkUrls: (coverArtworkPaths ?? []).map((path) => `${API_BASE}${path}`),
  };
}

/** Public playlists for the global catalog / home discovery surfaces (no auth required). */
export async function listPublicPlaylists(limit = 50): Promise<PublicPlaylistSummary[]> {
  const items = await apiRequest<PublicPlaylistSummaryResponse[]>(
    `/catalog/playlists?limit=${encodeURIComponent(String(limit))}`,
    {},
  );
  return items.map(mapPublicPlaylistSummary);
}

export type SongRecommendationItem = {
  id: string;
  title: string;
  artistId: string;
  artist?: string | null;
  releaseId?: string;
  releaseTitle?: string;
  genre?: string | null;
  moods?: string[];
  score?: number;
  reasons?: string[];
};

export type SongRecommendationsResponse = {
  userId: string;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    allowExplicit?: boolean;
  };
  cohortContext?: {
    applied: boolean;
    count: number;
    cohorts: Array<{
      cohortId: string;
      cohortType: string;
      reasonCode: string;
      title: string;
    }>;
  };
  items: SongRecommendationItem[];
};

export async function getSongRecommendations(
  userId: string,
  token: string,
  limit = 6,
  preferences?: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    allowExplicit?: boolean;
  },
): Promise<SongRecommendationsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (preferences?.mood) params.set("mood", preferences.mood);
  if (preferences?.energy) params.set("energy", preferences.energy);
  if (preferences?.genres?.length) params.set("genres", preferences.genres.join(","));
  if (preferences?.allowExplicit !== undefined) {
    params.set("allowExplicit", String(preferences.allowExplicit));
  }
  return apiRequest<SongRecommendationsResponse>(
    `/recommendations/${encodeURIComponent(userId)}?${params}`,
    {},
    token,
  );
}

export type TasteMemorySettings = {
  socialMatchingEnabled: boolean;
  citySceneDiscoveryEnabled: boolean;
  agentPlaybackTrainingEnabled: boolean;
  recommendationExplanationPreference: "compact" | "balanced" | "detailed";
  resetAt: string | null;
};

export type TasteSignalControl = {
  id: string;
  signalType: "genre" | "mood" | "artist" | "scene" | "intent" | "novelty" | "replay" | "commerce";
  value: string;
  action: "hidden" | "downranked";
  source: string | null;
  createdAt: string;
};

export type TasteMemoryResponse = {
  schemaVersion: "listener-taste-memory/v1";
  settings: TasteMemorySettings;
  summary: {
    favoredGenres: string[];
    favoredMoods: string[];
    favoredArtists: string[];
    recentIntents: string[];
    noveltyPattern: string;
    commercePreference: string;
    explanationPreference: string;
  };
  controls: TasteSignalControl[];
  privacy: {
    socialMatching: "enabled" | "disabled";
    citySceneDiscovery: "enabled" | "disabled";
    agentPlaybackTraining: "enabled" | "disabled";
    notes: string[];
  };
};

export async function getTasteMemory(token: string): Promise<TasteMemoryResponse> {
  return apiRequest<TasteMemoryResponse>("/recommendations/taste-memory", {}, token);
}

export async function updateTasteMemorySettings(
  token: string,
  input: Partial<Omit<TasteMemorySettings, "resetAt">>,
): Promise<TasteMemorySettings> {
  return apiRequest<TasteMemorySettings>(
    "/recommendations/taste-memory/settings",
    { method: "PATCH", body: JSON.stringify(input) },
    token,
  );
}

export async function resetTasteMemory(token: string): Promise<TasteMemorySettings> {
  return apiRequest<TasteMemorySettings>(
    "/recommendations/taste-memory/reset",
    { method: "POST" },
    token,
  );
}

export async function upsertTasteSignalControl(
  token: string,
  input: Pick<TasteSignalControl, "signalType" | "value"> & { action?: TasteSignalControl["action"]; source?: string },
): Promise<TasteSignalControl> {
  return apiRequest<TasteSignalControl>(
    "/recommendations/taste-memory/signals",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export async function removeTasteSignalControl(
  token: string,
  controlId: string,
): Promise<{ status: string; control: TasteSignalControl }> {
  return apiRequest<{ status: string; control: TasteSignalControl }>(
    `/recommendations/taste-memory/signals/${encodeURIComponent(controlId)}`,
    { method: "DELETE" },
    token,
  );
}

export type CommunityProfileVisibility = "private" | "community" | "followers" | "public";

export type CommunityVisibilitySettings = {
  showTasteBadges: boolean;
  showOwnedItems: boolean;
  showCampaignSupport: boolean;
  showShowAttendance: boolean;
  showPlaylists: boolean;
  showWalletAddress: boolean;
  allowTasteMatching: boolean;
  allowCityScenes: boolean;
};

export type CommunityProfile = {
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  profileVisibility: CommunityProfileVisibility;
  createdAt: string;
  updatedAt: string;
};

export type CommunityProfileResponse = {
  schemaVersion: "community-profile/v1";
  profile: CommunityProfile;
  visibility: CommunityVisibilitySettings;
  privacy?: {
    notes: string[];
  };
};

export type PublicCommunityProfileResponse = {
  schemaVersion: "community-public-profile/v1";
  profile: Pick<CommunityProfile, "userId" | "displayName" | "bio" | "avatarUrl" | "profileVisibility">;
  showcase: {
    tasteBadgesVisible: boolean;
    ownedItemsVisible: boolean;
    campaignSupportVisible: boolean;
    campaignSupport: Array<{
      campaignId: string;
      campaignSlug: string;
      campaignTitle: string;
      artistDisplayName: string;
      city: string;
      country: string;
      grantedAt: string;
    }>;
    showAttendanceVisible: boolean;
    playlistsVisible: boolean;
    walletAddress: string | null;
  };
  redactions: string[];
};

export async function getMyCommunityProfile(token: string): Promise<CommunityProfileResponse> {
  return apiRequest<CommunityProfileResponse>("/community/profile/me", {}, token);
}

export async function updateMyCommunityProfile(
  token: string,
  input: {
    displayName?: string;
    bio?: string | null;
    avatarUrl?: string | null;
    profileVisibility?: CommunityProfileVisibility;
    visibility?: Partial<CommunityVisibilitySettings>;
  },
): Promise<CommunityProfileResponse> {
  return apiRequest<CommunityProfileResponse>(
    "/community/profile/me",
    { method: "PATCH", body: JSON.stringify(input) },
    token,
  );
}

export async function getPublicCommunityProfile(userId: string): Promise<PublicCommunityProfileResponse> {
  return apiRequest<PublicCommunityProfileResponse>(
    `/community/profile/${encodeURIComponent(userId)}`,
    { cache: "no-store", silentErrorCodes: [404] },
  );
}

export type CommunityCohortType = "taste" | "artist_affinity" | "city_scene" | "collector" | "campaign";
export type CommunityCohortMembershipStatus = "suggested" | "joined" | "left" | "hidden";

export type CommunityCohortMembership = {
  status: CommunityCohortMembershipStatus | string;
  suggestedAt: string;
  joinedAt: string | null;
  leftAt: string | null;
  hiddenAt: string | null;
};

export type CommunityCohort = {
  id: string;
  cohortType: CommunityCohortType | string;
  reasonCode: string;
  title: string;
  safeExplanation: string;
  minimumSize: number;
  visibleMemberCount: number;
  memberCountLabel: string;
  status: string;
  membership: CommunityCohortMembership;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommunityCohortDetailSummary = Omit<CommunityCohort, "minimumSize" | "visibleMemberCount">;

export type CommunityCohortDetailAction = {
  id: string;
  label: string;
  description: string;
  href: string;
  status: "available" | "coming_soon" | string;
};

export type CommunityCohortVisibleMember = {
  memberKey: string;
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  profileVisibility: CommunityProfileVisibility | string;
  cohortMembershipStatus: CommunityCohortMembershipStatus | string;
  profileHref: string | null;
};

export type CommunityCohortMemberVisibility = {
  visibilityScope: string;
  memberListLabel: string;
  anonymousMemberLabel: string;
  visibleMemberLimit: number;
  visibleMembers: CommunityCohortVisibleMember[];
  currentViewer: {
    canAppear: boolean;
    profileVisibility: CommunityProfileVisibility | string;
    cohortMembershipStatus: CommunityCohortMembershipStatus | string;
    matchingConsentEnabled: boolean;
    reason: string;
  };
};

export type CommunityCohortSuggestionsResponse = {
  schemaVersion: "community-cohort-suggestions/v1";
  cohorts: CommunityCohort[];
  privacy: {
    minimumSizeEnforced: boolean;
    explanationScope: string;
    otherListenerIdentities: string;
  };
};

export type CommunityCohortDetailResponse = {
  schemaVersion: "community-cohort-detail/v1";
  cohort: CommunityCohortDetailSummary;
  context: {
    signalLabel: string;
    reasonCode: string;
    memberCountLabel: string;
    visibility: string;
    status: string;
  };
  actions: CommunityCohortDetailAction[];
  redactions: string[];
  memberVisibility?: CommunityCohortMemberVisibility;
  privacy: {
    minimumSizeEnforced: boolean;
    memberCountsAreBucketed: boolean;
    otherListenerIdentities: string;
    walletAddresses: string;
    rawListeningHistory: string;
    visibilityScope: string;
  };
};

export type CommunityCohortMembershipResponse = {
  schemaVersion: "community-cohort-membership/v1";
  cohort: CommunityCohort;
  membership: CommunityCohortMembership;
  privacy: {
    onChain: boolean;
    deletable: boolean;
    otherListenerIdentities: string;
  };
};

export type CommunityRoomMembership = {
  role: string;
  status: string;
  joinedAt: string;
  endedAt: string | null;
};

export type CommunityCohortRoomAccess = {
  joinable: boolean;
  reason: string;
  reasons?: string[];
};

export type CommunityRoomSummary = {
  id: string;
  roomType: string;
  ownerType: string;
  ownerId: string;
  artistId: string | null;
  title: string;
  description: string | null;
  status: string;
  membership: CommunityRoomMembership | null;
  access: CommunityCohortRoomAccess;
  createdAt: string;
  updatedAt: string;
};

export type CommunityCohortRoomResponse = {
  schemaVersion: "community-cohort-room/v1";
  cohort: CommunityCohortDetailSummary;
  room: CommunityRoomSummary;
  emptyState: {
    title: string;
    description: string;
  };
  privacy: {
    onChain: boolean;
    otherListenerIdentities: string;
    memberList: string;
    walletAddresses: string;
    rawListeningHistory: string;
    accessDerivedServerSide: boolean;
    moderation: string;
  };
};

export type CommunityCohortRoomMembershipResponse = {
  schemaVersion: "community-cohort-room-membership/v1";
  cohort: CommunityCohortDetailSummary;
  room: CommunityRoomSummary;
  membership: CommunityRoomMembership;
  privacy: CommunityCohortRoomResponse["privacy"];
};

export type CommunityCohortQualityReasonSummary = {
  cohortType: string;
  reasonCode: string;
  cohortCount: number;
  activeCount: number;
  archivedCount: number;
  expiredCount: number;
  belowThresholdCount: number;
  visibleMemberBucket: string;
};

export type CommunityCohortQualityResponse = {
  schemaVersion: "community-cohort-quality/v1";
  generatedAt: string;
  cohorts: {
    total: number;
    visibleNow: number;
    belowThreshold: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    generated: {
      total: number;
      visibleNow: number;
      belowThreshold: number;
      byStatus: Record<string, number>;
      byType: Record<string, number>;
    };
  };
  memberships: {
    total: number;
    stale: number;
    byStatus: Record<string, number>;
    disabledConsent: {
      total: number;
      byType: Record<string, number>;
    };
  };
  actions: {
    total: number;
    byEvent: Array<{ key: string; count: number }>;
    source: string;
  };
  reasonCodes: {
    limit: number;
    total: number;
    summaries: CommunityCohortQualityReasonSummary[];
  };
  privacy: {
    aggregateOnly: boolean;
    noListenerIdentifiers: boolean;
    noWalletAddresses: boolean;
    noRawListeningHistory: boolean;
    noFineLocation: boolean;
    reasonCodesAreBounded: boolean;
    memberCountsAreBucketed: boolean;
  };
};

export type CommunityCohortGenerationResponse = {
  schemaVersion: "community-cohort-generation/v1";
  generatedAt: string;
  summary: {
    candidateCohorts: number;
    cohortsMaterialized: number;
    cohortsReconciled: number;
    visibleCohorts: number;
    cohortsActivated: number;
    cohortsArchived: number;
    cohortsExpired: number;
    membershipsCreated: number;
    membershipsPreserved: number;
    hiddenMembershipsPreserved: number;
    staleMembershipsMarked: number;
    staleMembershipsRestored: number;
  };
  cohorts: Array<{
    cohortId: string;
    cohortType: string;
    reasonCode: string;
    status: string;
    lifecycleAction: "activated" | "archived" | "expired" | "unchanged" | string;
    visibleMemberCount: number;
    minimumSize: number;
    membershipsCreated: number;
    membershipsPreserved: number;
    hiddenMembershipsPreserved: number;
    staleMembershipsMarked: number;
    staleMembershipsRestored: number;
  }>;
  privacy: {
    minimumSizeEnforced: boolean;
    consentGated: boolean;
    aggregateCountsOnly: boolean;
    otherListenerIdentities: string;
  };
};

export async function getCommunityCohortSuggestions(token: string): Promise<CommunityCohortSuggestionsResponse> {
  return apiRequest<CommunityCohortSuggestionsResponse>(
    "/community/cohorts/suggestions",
    { cache: "no-store" },
    token,
  );
}

export async function getCommunityCohortDetail(
  token: string,
  cohortId: string,
): Promise<CommunityCohortDetailResponse> {
  return apiRequest<CommunityCohortDetailResponse>(
    `/community/cohorts/${encodeURIComponent(cohortId)}`,
    { cache: "no-store" },
    token,
  );
}

export async function joinCommunityCohort(token: string, cohortId: string): Promise<CommunityCohortMembershipResponse> {
  return apiRequest<CommunityCohortMembershipResponse>(
    `/community/cohorts/${encodeURIComponent(cohortId)}/join`,
    { method: "POST" },
    token,
  );
}

export async function leaveCommunityCohort(token: string, cohortId: string): Promise<CommunityCohortMembershipResponse> {
  return apiRequest<CommunityCohortMembershipResponse>(
    `/community/cohorts/${encodeURIComponent(cohortId)}/leave`,
    { method: "POST" },
    token,
  );
}

export async function hideCommunityCohort(token: string, cohortId: string): Promise<CommunityCohortMembershipResponse> {
  return apiRequest<CommunityCohortMembershipResponse>(
    `/community/cohorts/${encodeURIComponent(cohortId)}/hide`,
    { method: "POST" },
    token,
  );
}

export async function getCommunityCohortRoom(
  token: string,
  cohortId: string,
): Promise<CommunityCohortRoomResponse> {
  return apiRequest<CommunityCohortRoomResponse>(
    `/community/cohorts/${encodeURIComponent(cohortId)}/room`,
    { cache: "no-store", silentErrorCodes: [403, 404] },
    token,
  );
}

export async function joinCommunityCohortRoom(
  token: string,
  cohortId: string,
): Promise<CommunityCohortRoomMembershipResponse> {
  return apiRequest<CommunityCohortRoomMembershipResponse>(
    `/community/cohorts/${encodeURIComponent(cohortId)}/room/join`,
    { method: "POST" },
    token,
  );
}

export async function getCommunityCohortQuality(token: string): Promise<CommunityCohortQualityResponse> {
  return apiRequest<CommunityCohortQualityResponse>(
    "/admin/community/cohorts/quality",
    { cache: "no-store" },
    token,
  );
}

export async function generateCommunityCohorts(
  token: string,
  input: { minimumSize?: number } = {},
): Promise<CommunityCohortGenerationResponse> {
  return apiRequest<CommunityCohortGenerationResponse>(
    "/admin/community/cohorts/generate",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export type CommunityModerationAction =
  | "no_action"
  | "delete_message"
  | "remove_member"
  | "ban_member"
  | "pause_room"
  | "archive_room";

export type CommunityModerationReport = {
  id: string;
  status: "open" | "resolved" | "dismissed" | string;
  reason: string;
  reporterUserId: string;
  createdAt: string;
  resolvedAt: string | null;
  room: {
    id: string;
    roomType: string;
    ownerType: string;
    ownerId: string;
    artistId: string | null;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  message: {
    id: string;
    roomId: string;
    authorUserId: string;
    bodyPreview: string | null;
    messageType: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  } | null;
  context: {
    roomOpenReports: number;
    messageReportCount: number;
    roomMembershipsByStatus: Record<string, number>;
  };
  assist?: {
    summary: string;
    severity: "low" | "medium" | "high" | string;
    likelihood: "low" | "medium" | "high" | string;
    reasonCodes: string[];
    reviewFocus: string[];
    source: "bounded_moderation_context" | string;
    strategy?: "deterministic" | "model-assisted" | string;
    model?: string;
    fallbackReason?: string;
    advisory: {
      noAutoEnforcement: boolean;
      copy: string;
    };
  };
};

export type CommunityModerationQueueResponse = {
  schemaVersion: "community-moderation-queue/v1";
  generatedAt: string;
  filters: { status: string; limit: number };
  summary: {
    returnedReports: number;
    openReports: number;
    pausedRooms: number;
    archivedRooms: number;
  };
  reports: CommunityModerationReport[];
  actions: CommunityModerationAction[];
  privacy: {
    operatorOnly: boolean;
    noWalletAddresses: boolean;
    noUserEmails: boolean;
    noAccessPolicyPayloads: boolean;
    messageBodiesArePreviewed: boolean;
    actionNotesStored: boolean;
  };
};

export type CommunityModerationResolutionResponse = {
  schemaVersion: "community-moderation-resolution/v1";
  report: CommunityModerationReport;
  action: {
    type: CommunityModerationAction;
    status: string;
    noteStored: boolean;
  };
  privacy: CommunityModerationQueueResponse["privacy"];
};

export async function getCommunityModerationQueue(
  token: string,
  input: { status?: "open" | "resolved" | "dismissed"; limit?: number } = {},
): Promise<CommunityModerationQueueResponse> {
  const params = new URLSearchParams();
  if (input.status) params.set("status", input.status);
  if (input.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return apiRequest<CommunityModerationQueueResponse>(
    `/admin/community/moderation/reports${query ? `?${query}` : ""}`,
    { cache: "no-store" },
    token,
  );
}

export async function resolveCommunityModerationReport(
  token: string,
  reportId: string,
  input: { action: CommunityModerationAction; note?: string },
): Promise<CommunityModerationResolutionResponse> {
  return apiRequest<CommunityModerationResolutionResponse>(
    `/admin/community/moderation/reports/${encodeURIComponent(reportId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
    token,
  );
}

export type CommunityRoomType = "artist_public" | "artist_holder" | "show_campaign_supporter" | "show_city_demand";
export type CommunityRoomStatus = "active" | "paused" | "archived";
export type CommunityMembershipStatus = "active" | "left" | "removed" | "banned";
export type CommunityMessageType = "message" | "announcement" | "campaign_update";

export type CommunityRoomAccess = {
  joinable: boolean;
  reason: "open" | "eligible" | "holder_required" | string;
  reasons?: string[];
};

export type CommunityMembership = {
  role: string;
  status: CommunityMembershipStatus | string;
  joinedAt: string;
  endedAt: string | null;
};

export type CommunityArtistRoom = {
  id: string;
  roomType: CommunityRoomType | string;
  ownerType: string;
  ownerId: string;
  artistId: string | null;
  title: string;
  description: string | null;
  status: CommunityRoomStatus | string;
  membership: CommunityMembership | null;
  access: CommunityRoomAccess;
  createdAt: string;
  updatedAt: string;
};

export type CommunityArtistRoomsResponse = {
  schemaVersion: "community-artist-rooms/v1";
  artist: {
    id: string;
    displayName: string;
    imageUrl: string | null;
  };
  discord?: CommunityDiscordPublicLink | null;
  rooms: CommunityArtistRoom[];
};

export type CommunityDiscordPublicLink = {
  serverName: string | null;
  inviteUrl: string | null;
};

export type CommunityDiscordRoleMapping = {
  id: string;
  resonateRole: string;
  scopeType: string;
  scopeId: string;
  discordRoleId: string;
  label: string | null;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastStatus: string;
  lastReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommunityDiscordAttempt = {
  id: string;
  action: string;
  status: string;
  messageId: string | null;
  roleMappingId: string | null;
  retryOfId: string | null;
  attemptCount: number;
  requestSummary: unknown;
  responseStatus: number | null;
  errorReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type CommunityDiscordBridge = {
  id: string;
  artistId: string;
  provider: "discord" | string;
  serverId?: string | null;
  serverName: string | null;
  channelId?: string | null;
  channelName: string | null;
  webhookUrlMasked?: string;
  inviteUrl: string | null;
  publicLinkEnabled: boolean;
  announcementMirrorEnabled?: boolean;
  roleSyncEnabled?: boolean;
  status: string;
  lastTestedAt: string | null;
  lastMirroredAt: string | null;
  lastRoleSyncAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  roleMappings: CommunityDiscordRoleMapping[];
  recentAttempts: CommunityDiscordAttempt[];
  createdAt: string;
  updatedAt: string;
  privacy: {
    webhookUrlReturned: false;
    memberDetailsReturned: false;
  };
};

export type CommunityDiscordBridgeResponse = {
  schemaVersion: "community-discord-bridge/v1";
  artistId: string;
  bridge: CommunityDiscordBridge | null;
};

export type CommunityBenefitRuleStatus = "draft" | "active" | "paused" | "expired";
export type CommunityBenefitType =
  | "room_access"
  | "discount"
  | "early_access"
  | "fee_discount"
  | "drop_priority"
  | "ticket_priority"
  | "remix_eligibility";

export type CommunityBenefitRule = {
  id: string;
  artistId: string | null;
  title: string;
  description: string | null;
  benefitType: CommunityBenefitType | string;
  status: CommunityBenefitRuleStatus | string;
  eligibility: {
    type: string;
    label: string;
    scope?: string;
    campaignId?: string | null;
    minStatus?: string;
    sourceType?: string | null;
    scopeType?: string | null;
    policyCount?: number;
  };
  redemption: {
    singleUse: boolean;
    settlementType: string;
  };
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommunityBenefit = {
  id: string;
  title: string;
  description: string | null;
  benefitType: CommunityBenefitType | string;
  artistId: string | null;
  eligible: boolean;
  redeemable: boolean;
  redeemed: boolean;
  redemptionStatus: string | null;
  redeemedAt: string | null;
  reasons: string[];
  privacy: {
    proofDetails: "private" | string;
  };
};

export type CommunityBenefitsResponse = {
  schemaVersion: "community-benefits/v1";
  benefits: CommunityBenefit[];
  privacy: {
    proofDetails: "private" | string;
    walletAddressVisible: boolean;
    ownershipDisplayVisible: boolean;
  };
};

export type CommunityBenefitRedemptionResponse = {
  schemaVersion: "community-benefit-redemption/v1";
  idempotent: boolean;
  benefit: CommunityBenefit;
  redemption: {
    id: string;
    status: string;
    settlementType: string;
    settlementReference: string | null;
    redeemedAt: string | null;
  };
};

export type CommunityBenefitRuleInput = {
  title: string;
  description?: string;
  benefitType: CommunityBenefitType;
  status?: "draft" | "active";
  eligibilityPolicy: Record<string, unknown>;
  redemptionPolicy?: Record<string, unknown>;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type CommunityBenefitRulesResponse = {
  schemaVersion: "community-benefit-rules/v1";
  artistId: string;
  rules: CommunityBenefitRule[];
};

export type CommunityBenefitRuleResponse = {
  schemaVersion: "community-benefit-rule/v1";
  artistId: string;
  rule: CommunityBenefitRule;
};

export type CommunityMessage = {
  id: string;
  roomId: string;
  // `authorId` is redacted to `null` for other listeners in privacy-scoped rooms
  // (e.g. cohort rooms); it is only present for the viewer's own messages there.
  authorId: string | null;
  // Server-provided display label for privacy-scoped rooms: "You" for the
  // viewer's own messages, "Cohort member" for redacted peers, otherwise null.
  // Optional so parallel message shapes (e.g. campaign rooms) stay assignable.
  authorLabel?: string | null;
  body: string | null;
  messageType: CommunityMessageType | string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CommunityMessagesResponse = {
  schemaVersion: "community-messages/v1";
  room: CommunityArtistRoom;
  messages: CommunityMessage[];
};

export async function listArtistCommunityRooms(
  artistId: string,
  token?: string | null,
): Promise<CommunityArtistRoomsResponse> {
  const path = token
    ? `/community/artists/${encodeURIComponent(artistId)}/rooms/me`
    : `/community/artists/${encodeURIComponent(artistId)}/rooms`;
  return apiRequest<CommunityArtistRoomsResponse>(path, { cache: "no-store" }, token);
}

export async function enableArtistCommunity(token: string, artistId: string): Promise<CommunityArtistRoomsResponse> {
  return apiRequest<CommunityArtistRoomsResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/rooms/enable`,
    { method: "POST" },
    token,
  );
}

export async function getArtistDiscordBridge(token: string, artistId: string): Promise<CommunityDiscordBridgeResponse> {
  return apiRequest<CommunityDiscordBridgeResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/discord/manage`,
    { cache: "no-store" },
    token,
  );
}

export async function getMyCommunityBenefits(token: string): Promise<CommunityBenefitsResponse> {
  return apiRequest<CommunityBenefitsResponse>(
    "/community/benefits/me",
    { cache: "no-store" },
    token,
  );
}

export async function redeemCommunityBenefit(
  token: string,
  benefitRuleId: string,
): Promise<CommunityBenefitRedemptionResponse> {
  return apiRequest<CommunityBenefitRedemptionResponse>(
    `/community/benefits/${encodeURIComponent(benefitRuleId)}/redeem`,
    { method: "POST" },
    token,
  );
}

export async function listArtistBenefitRules(
  token: string,
  artistId: string,
): Promise<CommunityBenefitRulesResponse> {
  return apiRequest<CommunityBenefitRulesResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/benefit-rules`,
    { cache: "no-store" },
    token,
  );
}

export async function createArtistBenefitRule(
  token: string,
  artistId: string,
  input: CommunityBenefitRuleInput,
): Promise<CommunityBenefitRuleResponse> {
  return apiRequest<CommunityBenefitRuleResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/benefit-rules`,
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export async function pauseArtistBenefitRule(
  token: string,
  artistId: string,
  ruleId: string,
): Promise<CommunityBenefitRuleResponse> {
  return apiRequest<CommunityBenefitRuleResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/benefit-rules/${encodeURIComponent(ruleId)}/pause`,
    { method: "POST" },
    token,
  );
}

export async function expireArtistBenefitRule(
  token: string,
  artistId: string,
  ruleId: string,
): Promise<CommunityBenefitRuleResponse> {
  return apiRequest<CommunityBenefitRuleResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/benefit-rules/${encodeURIComponent(ruleId)}/expire`,
    { method: "POST" },
    token,
  );
}

export async function connectArtistDiscordBridge(
  token: string,
  artistId: string,
  input: {
    webhookUrl: string;
    inviteUrl?: string;
    serverName?: string;
    channelName?: string;
    publicLinkEnabled?: boolean;
    announcementMirrorEnabled?: boolean;
    roleSyncEnabled?: boolean;
  },
): Promise<CommunityDiscordBridgeResponse> {
  return apiRequest<CommunityDiscordBridgeResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/discord/connect`,
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export async function disconnectArtistDiscordBridge(token: string, artistId: string): Promise<CommunityDiscordBridgeResponse> {
  return apiRequest<CommunityDiscordBridgeResponse>(
    `/community/artists/${encodeURIComponent(artistId)}/discord/disconnect`,
    { method: "POST" },
    token,
  );
}

export async function testArtistDiscordBridge(token: string, artistId: string) {
  return apiRequest<{ schemaVersion: "community-discord-bridge-test/v1"; ok: boolean; attempt: CommunityDiscordAttempt; bridge: CommunityDiscordBridge | null }>(
    `/community/artists/${encodeURIComponent(artistId)}/discord/test`,
    { method: "POST" },
    token,
  );
}

export async function retryArtistDiscordAttempt(token: string, artistId: string, attemptId: string) {
  return apiRequest<{ schemaVersion: "community-discord-retry/v1"; ok: boolean; attempt: CommunityDiscordAttempt }>(
    `/community/artists/${encodeURIComponent(artistId)}/discord/retry/${encodeURIComponent(attemptId)}`,
    { method: "POST" },
    token,
  );
}

export async function joinCommunityRoom(token: string, roomId: string) {
  return apiRequest<{ schemaVersion: "community-membership/v1"; room: CommunityArtistRoom; membership: CommunityMembership }>(
    `/community/rooms/${encodeURIComponent(roomId)}/join`,
    { method: "POST" },
    token,
  );
}

export async function leaveCommunityRoom(token: string, roomId: string) {
  return apiRequest<{ schemaVersion: "community-membership/v1"; membership: CommunityMembership }>(
    `/community/rooms/${encodeURIComponent(roomId)}/leave`,
    { method: "POST" },
    token,
  );
}

export async function listCommunityRoomMessages(token: string, roomId: string): Promise<CommunityMessagesResponse> {
  return apiRequest<CommunityMessagesResponse>(
    `/community/rooms/${encodeURIComponent(roomId)}/messages`,
    { cache: "no-store" },
    token,
  );
}

export async function createCommunityRoomMessage(
  token: string,
  roomId: string,
  input: { body: string; messageType?: CommunityMessageType },
) {
  return apiRequest<{ schemaVersion: "community-message/v1"; message: CommunityMessage }>(
    `/community/rooms/${encodeURIComponent(roomId)}/messages`,
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
}

export async function reportCommunityMessage(token: string, messageId: string, reason: string) {
  return apiRequest<{ schemaVersion: "community-moderation-report/v1"; report: { id: string; status: string } }>(
    `/community/messages/${encodeURIComponent(messageId)}/report`,
    { method: "POST", body: JSON.stringify({ reason }) },
    token,
  );
}

export async function deleteCommunityMessage(token: string, messageId: string) {
  return apiRequest<{ schemaVersion: "community-message/v1"; message: CommunityMessage }>(
    `/community/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
    token,
  );
}

export async function moderateCommunityRoomMember(
  token: string,
  roomId: string,
  userId: string,
  action: "remove" | "ban",
) {
  return apiRequest<{ schemaVersion: "community-membership/v1"; membership: CommunityMembership }>(
    `/community/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/moderate`,
    { method: "POST", body: JSON.stringify({ action }) },
    token,
  );
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
  input: { name?: string; folderId?: string | null; trackIds?: string[]; visibility?: PlaylistVisibility }
) {
  return apiRequest<APIPlaylist>(
    `/playlists/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    token
  );
}

export async function setPlaylistVisibilityAPI(
  id: string,
  token: string,
  visibility: PlaylistVisibility
) {
  return apiRequest<APIPlaylist>(
    `/playlists/${id}`,
    { method: "PUT", body: JSON.stringify({ visibility }) },
    token
  );
}

export async function deletePlaylistAPI(id: string, token: string) {
  return apiRequest<void>(`/playlists/${id}`, { method: "DELETE" }, token);
}

// ========== Public & saved playlists ==========

/**
 * Fetch a public playlist for viewing/playback. Works unauthenticated; passing
 * a token lets the backend report `isOwner`/`isSaved` for the current user.
 */
export async function getPublicPlaylistAPI(id: string, token?: string) {
  return apiRequest<PublicPlaylistView>(
    `/playlists/public/${id}`,
    { silentErrorCodes: [404] },
    token
  );
}

export async function savePlaylistAPI(token: string, sourcePlaylistId: string) {
  return apiRequest<SavedPlaylistView>(
    "/playlists/saved",
    { method: "POST", body: JSON.stringify({ sourcePlaylistId }) },
    token
  );
}

export async function listSavedPlaylistsAPI(token: string) {
  return apiRequest<SavedPlaylistView[]>("/playlists/saved", {}, token);
}

export async function removeSavedPlaylistAPI(savedPlaylistId: string, token: string) {
  return apiRequest<{ removed: boolean }>(
    `/playlists/saved/${savedPlaylistId}`,
    { method: "DELETE" },
    token
  );
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
  licenseType?: "personal" | "remix" | "commercial";
  tierListings?: Partial<Record<"personal" | "remix" | "commercial", string>> | null;
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
  const result = await apiRequest<{ listings: APIListing[]; total: number }>(
    `/metadata/listings?status=active&stemId=${encodeURIComponent(stemId)}&limit=20&offset=0`,
    {}
  );
  return result.listings;
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

export type StemMintAuthorization = {
  stemId: string;
  chainId: number;
  contractAddress: `0x${string}`;
  tokenURI: string;
  authorization: {
    minter: `0x${string}`;
    to: `0x${string}`;
    amount: string;
    protectionId: string;
    royaltyReceiver: `0x${string}`;
    royaltyBps: number;
    remixable: boolean;
    parentIds: string[];
    deadline: string;
    nonce: `0x${string}`;
  };
  signature: `0x${string}`;
};

export async function createStemMintAuthorization(
  token: string,
  input: {
    stemId: string;
    chainId: number;
    minterAddress: string;
    to?: string;
    amount?: string;
    royaltyReceiver?: string;
    royaltyBps?: number;
    remixable?: boolean;
    parentIds?: string[];
    protectionId?: string;
  }
) {
  return apiRequest<StemMintAuthorization>(
    "/contracts/mint-authorizations",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function createBatchStemMintAuthorizations(
  token: string,
  input: {
    authorizations: Array<{
      stemId: string;
      chainId: number;
      minterAddress: string;
      to?: string;
      amount?: string;
      royaltyReceiver?: string;
      royaltyBps?: number;
      remixable?: boolean;
      parentIds?: string[];
      protectionId?: string;
    }>;
  }
) {
  return apiRequest<{ authorizations: StemMintAuthorization[] }>(
    "/contracts/mint-authorizations/batch",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

// ========== Agent Config API ==========

export type AgentIdentityStatus = "local" | "pending" | "minted" | "attested";

export type AgentConfig = {
  id: string;
  userId: string;
  name: string;
  vibes: string[];
  stemTypes: string[];
  sessionMode: "curate" | "buy";
  monthlyCapUsd: number;
  isActive: boolean;
  identityStatus: AgentIdentityStatus;
  identityChainId: number | null;
  identityRegistry: string | null;
  identityTokenId: string | null;
  identityTxHash: string | null;
  identityCredential: Record<string, unknown> | null;
  learnedTasteProfile: {
    schemaVersion: "agent-taste-profile/v1";
    score: number;
    tier: "New" | "Emerging" | "Focused" | "Deep";
    signals: number;
    positiveSignals: number;
    negativeSignals: number;
    acceptanceRate: number;
    genresExplored: string[];
    favoredGenres: string[];
    genreWeights: Record<string, number>;
    diversity: number;
    depth: number;
    consistency: number;
    updatedAt: string;
  } | null;
  tasteScore: number;
  tasteUpdatedAt: string | null;
  reputationScore: number;
  reputationSnapshot: {
    score: number;
    tier: "New" | "Emerging" | "Trusted" | "Proven";
    sessions: number;
    tracksCurated: number;
    totalSpendUsd: number;
    monthlyCapUsd: number;
    genresExplored: string[];
    acceptanceRate: number;
    budgetUtilization: number;
    tasteDepth: number;
    updatedAt: string;
  } | null;
  reputationAttestedAt: string | null;
  reputationTxHash: string | null;
  createdAt: string;
  updatedAt: string;
  onchain?: {
    status: AgentIdentityStatus;
    chainId: number | null;
    registry: string | null;
    txHash: string | null;
    tokenId: string | null;
    reason?: "erc8004_disabled" | "missing_session_key" | "already_minted" | "missing_token_id";
  };
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

export async function mintAgentIdentity(token: string): Promise<AgentConfig> {
  return apiRequest<AgentConfig>(
    "/agents/config/identity/mint",
    { method: "POST" },
    token
  );
}

export async function attestAgentReputation(token: string): Promise<AgentConfig> {
  return apiRequest<AgentConfig>(
    "/agents/config/identity/attest",
    { method: "POST" },
    token
  );
}

export async function recordAgentSignal(
  token: string,
  input: {
    trackId: string;
    action: "accept" | "skip" | "complete" | "save" | "replay" | "add_to_playlist" | "purchase";
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ status: string; profile?: AgentConfig["learnedTasteProfile"]; config?: AgentConfig | null }> {
  return apiRequest<{ status: string; profile?: AgentConfig["learnedTasteProfile"]; config?: AgentConfig | null }>(
    "/agents/config/signals",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function startAgentSession(
  token: string,
  input?: { preferences?: AgentNextPreferences },
): Promise<{ status: string; sessionId?: string }> {
  return apiRequest<{ status: string; sessionId?: string }>(
    "/agents/config/session",
    { method: "POST", body: JSON.stringify(input ?? {}) },
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
  recommendation?: AgentRecommendationSummary | null;
  track: {
    id: string;
    title: string;
    artist: string | null;
    releaseId: string;
    release: { id: string; artworkMimeType: string | null; artworkUrl?: string | null; title: string };
  };
}

export type AgentRecommendationSignal = {
  label: string;
  weight: number;
  reason: string;
};

export type AgentAudioFeatureSummary = {
  source?: string;
  confidence?: number;
  tempoBpm?: number;
  energyBand?: "low" | "medium" | "high";
  warnings?: string[];
};

export type AgentRecommendationSummary = {
  recommendation?: {
    score?: number;
    explanation?: string[];
    signals?: AgentRecommendationSignal[];
    audioFeatures?: AgentAudioFeatureSummary;
  } | null;
  reason?: string;
  reasoning?: string;
  source?: string;
  runtime?: string;
};

export interface AgentSession {
  id: string;
  budgetCapUsd: number;
  spentUsd: number;
  startedAt: string;
  endedAt: string | null;
  licenses: AgentSessionLicense[];
  agentTransactions: AgentTransaction[];
}

export type AgentNextPreferences = {
  mood?: string;
  energy?: "low" | "medium" | "high";
  genres?: string[];
  allowExplicit?: boolean;
  licenseType?: "personal" | "remix" | "commercial";
  sessionIntent?: string;
  sessionIntentName?: string;
  queueStyle?: string;
  source?: string;
};

export type AgentNextPickResponse = {
  status: "ok" | "session_inactive" | "no_tracks" | "all_rejected" | "rejected" | string;
  track?: {
    id: string;
    title: string;
    artistId: string;
  };
  licenseType?: "personal" | "remix" | "commercial";
  priceUsd?: number;
  score?: number;
  explanation?: string[];
  signals?: AgentRecommendationSignal[];
  audioFeatures?: AgentAudioFeatureSummary;
  runtimeStatus?: string;
  reason?: string;
  tracks?: Array<{
    trackId: string;
    licenseType: "personal" | "remix" | "commercial";
    priceUsd: number;
    reason?: string;
    score?: number;
    explanation?: string[];
    signals?: AgentRecommendationSignal[];
  }>;
  generationsUsed?: number;
  generationSpendUsd?: number;
};

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

export async function getAgentNextPick(
  token: string,
  input: { sessionId: string; preferences?: AgentNextPreferences },
): Promise<AgentNextPickResponse> {
  return apiRequest<AgentNextPickResponse>(
    "/sessions/agent/next",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
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
  errorMessage: string | null;
  createdAt: string;
  confirmedAt: string | null;
  stemName: string | null;
  trackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
};

export type EnableAgentWalletResponse = {
  agentAddress: string;
  status: AgentWalletStatus;
};

export async function enableAgentWallet(
  token: string,
  input?: {
    permissions?: SessionKeyPermissions;
    validityHours?: number;
  },
): Promise<EnableAgentWalletResponse> {
  return apiRequest<EnableAgentWalletResponse>(
    "/wallet/agent/enable",
    {
      method: "POST",
      ...(input
        ? {
            body: JSON.stringify(input),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    },
    token
  );
}

export async function activateAgentSessionKey(
  token: string,
  input: {
    approvalData: string;
    txHash?: string;
  },
): Promise<{ id: string; userId: string; agentAddress: string }> {
  return apiRequest<{ id: string; userId: string; agentAddress: string }>(
    "/wallet/agent/session-key/activate",
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    },
    token
  );
}

export async function rotateAgentKey(
  token: string,
  input?: {
    permissions?: Record<string, unknown>;
    validityHours?: number;
  },
): Promise<{ agentAddress: string; oldAgentAddress: string | null }> {
  return apiRequest<{ agentAddress: string; oldAgentAddress: string | null }>(
    "/wallet/agent/rotate",
    {
      method: "POST",
      ...(input
        ? {
            body: JSON.stringify(input),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
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
  status: "queued" | "generating" | "storing" | "finalizing" | "complete" | "completed" | "failed";
  trackId?: string;
  releaseId?: string;
  error?: string;
};

export function isGenerationStatusComplete(status: GenerationStatusResponse["status"]) {
  return status === "complete" || status === "completed";
}

export async function createGeneration(
  token: string,
  input: {
    prompt: string;
    artistId: string;
    negativePrompt?: string;
    seed?: number;
    durationSeconds?: 30 | 60 | 120 | 180;
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
  artistId: string;
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

// ---------------------------------------------------------------------------
// Remix Studio (#891): eligibility + remix projects
// ---------------------------------------------------------------------------

export type RemixDenialReason = {
  code: string;
  message: string;
};

export type RemixEligibilityResponse = {
  allowed: boolean;
  requiredLicense: "remix" | null;
  allowedActions: Array<"private_draft" | "publish_resonate" | "export">;
  reasons: RemixDenialReason[];
  /** Caller owns the source artist profile — license satisfied by ownership (#1174). */
  creatorOwner?: boolean;
  policyVersion: string;
  source: {
    trackId: string;
    rightsRoute: string | null;
    contentStatus: string;
  };
  stems: Array<{
    stemId: string;
    remixable: boolean | null;
    licensed: boolean;
  }>;
};

export type RemixProjectStem = {
  stemId: string;
  type: string;
  title: string | null;
  /** Worker-measured musical features (#1184): tempo, key, beats, energy. */
  audioFeatures?: {
    schemaVersion?: string;
    tempoBpm?: number | null;
    tempoConfidence?: number | null;
    beatCount?: number | null;
    firstBeatSec?: number | null;
    key?: { tonic: string; mode: "major" | "minor"; confidence: number | null } | null;
    energyRms?: number | null;
    onsetDensity?: number | null;
    durationSeconds?: number | null;
    sampleRate?: number | null;
  } | null;
  role: string | null;
  gainDb: number | null;
  muted: boolean;
  arrangement: unknown;
};

export type RemixProjectSource = {
  trackId: string;
  trackTitle: string;
  releaseId: string;
  releaseTitle: string;
  artistName: string | null;
  rightsRoute: string | null;
  contentStatus: string;
};

export type RemixSectionInterval = { startSec: number; endSec: number };

/**
 * The project's section grid (#1314), derived server-side from measured stem
 * features so the studio, PATCH validation, and the render worker share one
 * derivation. Null when nothing is measured or the track is too short.
 */
export type RemixSectionGrid = {
  kind: "bars" | "time";
  sections: RemixSectionInterval[];
  sectionSeconds: number;
  durationSeconds: number;
  bpm: number | null;
};

export type RemixProjectMode = "stem_mix" | "variation" | "extension";

export type RemixGenerationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type RemixGenerationGrounding =
  | "stem_audio"
  | "stem_plus_ai"
  | "audio_conditioned"
  | "feature_conditioned"
  | "prompt_only";

export type RemixGeneratedLayerMetadata = {
  kind?: "generated_layer" | string;
  provider?: string;
  jobId?: string;
  prompt?: string | null;
  constraints?: Record<string, unknown>;
  output?: {
    outputUri?: string | null;
    mimeType?: string | null;
    synthIdPresent?: boolean | null;
    seed?: number | null;
    sampleRate?: number | null;
  } | null;
};

export type RemixRenderMetadata = {
  schemaVersion: string;
  targetLufs: number;
  loudnessRangeLufs: number;
  truePeakDbtp: number;
  outputCodec: "mp3" | string;
  outputMimeType: "audio/mpeg" | string;
  outputBitrateKbps: number;
  outputSampleRateHz: number;
  outputChannels: number;
  inputCount: number;
  activeStemCount: number;
};

export type RemixGenerationMetadata = {
  status?: RemixGenerationStatus;
  mode?: RemixProjectMode | string;
  /** Honest provenance (#1181): what of the source audio shaped this draft. */
  grounding?: RemixGenerationGrounding | string;
  /** #1209: generated additive layers mixed over the source stem backbone. */
  generatedLayers?: RemixGeneratedLayerMetadata[];
  /** #1209: saved stem arrangement used as the final source-audio backbone. */
  sourceArrangement?: Array<{ stemId: string; gainDb?: number | null; muted?: boolean }>;
  /** #1210: versioned final-render settings for reproducibility/audit. */
  renderMetadata?: RemixRenderMetadata;
  /** Measured tempo/key hints applied to the prompt (#1182 slice 3). */
  sourceFeatureHints?: { bpm?: number; key?: string };
  stemIds?: string[];
  constraints?: Record<string, unknown>;
  estimatedCostUsd?: number | null;
  policyVersion?: string;
  voiceLikenessAllowed?: false;
  output?: {
    outputUri: string | null;
    mimeType?: string | null;
    synthIdPresent?: boolean | null;
    seed?: number | null;
    sampleRate?: number | null;
  } | null;
  requestedAt?: string;
  processingStartedAt?: string;
  completedAt?: string | null;
  failedAt?: string | null;
  retryOfJobId?: string | null;
  providerJobId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean | null;
};

/**
 * A source-track stem NOT yet in the remix session (#1312), with the state the
 * studio needs to render the "Also on this track" panel: addable, license
 * required (routes to /stem/[tokenId]), or honestly blocked.
 */
export type RemixProjectAvailableStem = {
  stemId: string;
  type: string;
  title: string | null;
  /** Minted token id (stringified BigInt) for the /stem/[tokenId] license page; null when unminted. */
  tokenId: string | null;
  remixable: boolean | null;
  licensed: boolean;
  addable: boolean;
};

export type RemixProject = {
  id: string;
  creatorUserId: string;
  sourceTrackId: string;
  title: string;
  status: string;
  mode: string;
  licenseType: string;
  licenseId: string | null;
  prompt: string | null;
  generationProvider: string | null;
  generationJobId: string | null;
  generationMetadata: RemixGenerationMetadata | null;
  attribution: string | null;
  exportPolicy: unknown;
  policyVersion: string;
  /** Set once the draft is published as a catalog remix release (#1196). */
  publishedReleaseId: string | null;
  createdAt: string;
  updatedAt: string;
  source: RemixProjectSource;
  stems: RemixProjectStem[];
  /** Present on draft-project reads only (#1312). */
  availableStems?: RemixProjectAvailableStem[];
  /** Derived section grid (#1314); null when the source has no measured duration. */
  sectionGrid?: RemixSectionGrid | null;
  eligibility?: RemixEligibilityResponse;
};

/** Shape returned by POST /remix/projects/:id/publish (#1196). */
export type RemixPublishResult = RemixProject & {
  publishedRelease: { releaseId: string; trackId: string };
};

export type RemixProjectPatch = {
  title?: string;
  prompt?: string | null;
  status?: string;
  mode?: string;
  stems?: Array<{
    stemId: string;
    role?: string | null;
    gainDb?: number | null;
    muted?: boolean;
    arrangement?: unknown;
  }>;
  /** Eligibility-checked stem additions to the session (#1312). */
  addStemIds?: string[];
};

export async function updateRemixProject(
  token: string,
  projectId: string,
  patch: RemixProjectPatch
) {
  return apiRequest<RemixProject>(
    `/remix/projects/${projectId}`,
    { method: "PATCH", body: JSON.stringify(patch) },
    token
  );
}

export type RemixGenerationError = {
  code:
    | "provider_disabled"
    | "invalid_input"
    | "provider_rejected"
    | "provider_unavailable";
  message: string;
  retryable: boolean;
};

export async function generateRemixDraft(
  token: string,
  projectId: string,
  options: { force?: boolean; retry?: boolean } = {}
) {
  return apiRequest<RemixProject>(
    `/remix/projects/${projectId}/generate`,
    { method: "POST", body: JSON.stringify(options) },
    token
  );
}

export async function getRemixDraftAudioBlob(
  token: string,
  projectId: string,
) {
  const response = await fetch(
    `${API_BASE}/remix/projects/${projectId}/draft-audio`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      formatApiErrorMessage(response.status, response.statusText, detail),
    );
  }

  return response.blob();
}

export async function getRemixEligibility(
  token: string,
  trackId: string,
  stemIds?: string[]
) {
  const params = new URLSearchParams({ trackId });
  if (stemIds?.length) {
    params.set("stemIds", stemIds.join(","));
  }
  return apiRequest<RemixEligibilityResponse>(
    `/remix/eligibility?${params.toString()}`,
    {},
    token
  );
}

export async function createRemixProject(
  token: string,
  input: {
    sourceTrackId: string;
    stemIds: string[];
    title: string;
    mode?: string;
    prompt?: string | null;
  }
) {
  return apiRequest<RemixProject>(
    "/remix/projects",
    { method: "POST", body: JSON.stringify(input) },
    token
  );
}

export async function publishRemixProject(token: string, projectId: string) {
  return apiRequest<RemixPublishResult>(
    `/remix/projects/${projectId}/publish`,
    { method: "POST" },
    token
  );
}

export async function getRemixProject(token: string, projectId: string) {
  return apiRequest<RemixProject>(
    `/remix/projects/${projectId}`,
    {},
    token
  );
}

export async function listRemixProjects(token: string) {
  return apiRequest<RemixProject[]>("/remix/projects", {}, token);
}
