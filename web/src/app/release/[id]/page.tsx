"use client";

import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getRelease,
  Release,
  type Track,
  getLatestReleaseRightsUpgradeRequest,
  type ReleaseRightsUpgradeRequestRecord,
  updateReleaseArtwork,
  getReleaseArtworkUrl,
  getOwnerScopedTrackStreamObjectUrl,
  getReleaseTrackStreamUrl,
  getStemPreviewUrl,
  waitForReleaseAvailability,
  getReleaseContentProtectionStatus,
  type ReleaseContentProtectionData,
  listMyTrustedSourceLinks,
  type TrustedSourceArtistLinkRecord,
} from "../../../lib/api";
import { LocalTrack, saveTracksMetadata } from "../../../lib/localLibrary";
import { Button } from "../../../components/ui/Button";
import { RemixCta } from "../../../components/remix/RemixCta";
import { useBreakpoint } from "../../../hooks/useBreakpoint";
import { usePlayer } from "../../../lib/playerContext";
import { AddToPlaylistModal } from "../../../components/library/AddToPlaylistModal";
import { MixerConsole } from "../../../components/player/MixerConsole";

import { useToast } from "../../../components/ui/Toast";
// import { addTracksByCriteria } from "../../../lib/playlistStore";
import { formatDuration } from "../../../lib/metadataExtractor";
import { useAuth } from "../../../components/auth/AuthProvider";
import { artistCreditHref } from "../../../lib/artistRoutes";
import { buildTrackStreamUrl } from "../../../lib/urlUtils";
import { MintStemButton } from "../../../components/marketplace/MintStemButton";
import { BatchMintListModal } from "../../../components/marketplace/BatchMintListModal";
import { useAttestAndStake, type BatchStemItem } from "../../../hooks/useContracts";
import { useTrustTier } from "../../../hooks/useTrustTier";
import { TrackActionMenu } from "../../../components/ui/TrackActionMenu";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { ErrorDetailsDialog } from "../../../components/ui/ErrorDetailsDialog";
import { useWebSockets, TrackStatusUpdate, ReleaseStatusUpdate, ReleaseProgressUpdate, type ReleaseRightsRequestUpdate } from "../../../hooks/useWebSockets";
import { StemPricingPanel } from "../../../components/release/StemPricingPanel";
import { LicensingInfoSection } from "../../../components/release/LicensingInfoSection";
import { ProcessingFailureCallout } from "../../../components/release/ProcessingFailureCallout";
import { ReleaseOverviewStrip } from "../../../components/release/ReleaseOverviewStrip";
import { summarizeProcessingFailure } from "../../../components/release/processingFailure";
import ReleaseContentProtection from "../../../components/content-protection/ReleaseContentProtection";
import ReportContentModal from "../../../components/disputes/ReportContentModal";
import ReleaseRightsUpgradeModal from "../../../components/rights/ReleaseRightsUpgradeModal";
import { DEFAULT_MARKETPLACE_LISTING_PRICE_WEI } from "../../../lib/stakeSafeListingPrice";
import {
  RIGHTS_VERIFICATION_COPY,
  normalizeRightsVerificationState,
} from "../../../lib/verificationSemantics";
import { buildReleaseRightsOnboardingContext } from "../../../lib/rightsOnboarding";
import "../../../styles/license-badges.css";

// Helper to get duration from track's first stem
const getTrackDuration = (track: { stems?: Array<{ durationSeconds?: number | null }> }): number => {
  return track.stems?.[0]?.durationSeconds ?? 0;
};

const normalizeArtistCredit = (value?: string | null) =>
  (value || "")
    .trim()
    .toLowerCase()
    .replace(/^[\s._-]*\d+[\s._-]+/, "")
    .replace(/[\s._-]+/g, " ");

const getReleaseArtistCredit = (release?: Release | null) =>
  release?.primaryArtist || release?.artist?.displayName || "Unknown Artist";

const getTrackArtistCredit = (track: Track, release?: Release | null) => {
  const trackArtist = track.artist?.trim();
  const releaseArtist = getReleaseArtistCredit(release);
  if (!trackArtist) return releaseArtist;

  const normalizedTrackArtist = normalizeArtistCredit(trackArtist);
  const normalizedTitle = normalizeArtistCredit(track.title);
  if (normalizedTrackArtist && normalizedTrackArtist === normalizedTitle) {
    return releaseArtist;
  }

  return trackArtist;
};

const MIXER_STEM_TYPES = ["vocals", "drums", "bass", "piano", "guitar", "other"] as const;

const normalizeStemType = (type?: string | null): string => type?.trim().toLowerCase() ?? "";

const hasMixerStem = (
  stems?: Array<{ type?: string | null }> | null,
  selectedType?: string,
): boolean => {
  const normalizedSelectedType = normalizeStemType(selectedType);

  return stems?.some((stem) => {
    const type = normalizeStemType(stem.type);
    if (!type || type === "original" || type === "master") {
      return false;
    }
    return normalizedSelectedType ? type === normalizedSelectedType : true;
  }) ?? false;
};

type PlaybackStem = NonNullable<Track["stems"]>[number];

const withPreviewUrlsForMixerStems = (stems?: PlaybackStem[]): PlaybackStem[] | undefined => {
  return stems?.map((stem) => {
    if (!hasMixerStem([stem])) {
      return stem;
    }

    return {
      ...stem,
      uri: getStemPreviewUrl(stem.id),
      isEncrypted: false,
      encryptionMetadata: null,
    };
  });
};

const isPreviewBackedMixerStem = (
  stem?: { id?: string | null; uri?: string | null; isEncrypted?: boolean } | null,
): boolean => {
  if (!stem?.id || !stem.uri) {
    return false;
  }

  return !stem.isEncrypted && stem.uri === getStemPreviewUrl(stem.id);
};

type MintReadiness = {
  ready: boolean;
  protectionId?: bigint;
};

function parseProtectionTokenId(value?: string | null): bigint | undefined {
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function slugifyReleaseTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function hashReleaseTracks(
  releaseId: string,
  trackIds: string[],
  token: string,
): Promise<`0x${string}`> {
  const buffers = await Promise.all(
    trackIds.map(async (trackId) => {
      const response = await fetch(
        getReleaseTrackStreamUrl(releaseId, trackId, { ownerScoped: true }),
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch track audio for attestation (${trackId}).`);
      }
      return response.arrayBuffer();
    }),
  );

  const combined = new Uint8Array(
    buffers.reduce((total, buffer) => total + buffer.byteLength, 0),
  );
  let offset = 0;
  for (const buffer of buffers) {
    combined.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }

  const digest = await crypto.subtle.digest("SHA-256", combined);
  return `0x${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

const formatRightsLabel = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  return value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

/**
 * Listener-facing AI-provenance label for a published remix release (#1196),
 * mirroring the studio's honest grounding copy (#1194) in third person.
 */
const remixProvenanceLabel = (
  grounding?: string | null,
): { text: string; ai: boolean } | null => {
  switch (grounding) {
    case "stem_audio":
      return {
        text: "Made from the source's licensed stems — this release contains the source audio itself.",
        ai: false,
      };
    case "stem_plus_ai":
      return {
        text: "Made from the source's licensed stems plus AI-generated layers mixed on top.",
        ai: true,
      };
    case "audio_conditioned":
      return {
        text: "AI-generated draft conditioned on the source stem audio. The model heard the arranged stems, but this is draft-quality audio, not a master.",
        ai: true,
      };
    case "feature_conditioned":
      return {
        text: "AI-generated, matched to the source stems' measured tempo and key. The model did not hear the source audio.",
        ai: true,
      };
    case "prompt_only":
      return {
        text: "AI-generated from a text prompt only — not derived from the source audio.",
        ai: true,
      };
    default:
      return null;
  }
};

const formatRightsUpgradeStatusLabel = (value?: string | null): string => {
  switch (value) {
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under Review";
    case "more_evidence_requested":
      return "More Evidence Needed";
    case "approved_standard_escrow":
      return "Approved: Standard Escrow";
    case "approved_trusted_fast_path":
      return "Approved: Trusted Fast Path";
    case "denied":
      return "Denied";
    default:
      return "No Request Submitted";
  }
};

const getRightsUpgradeStatusColor = (status?: string | null): { bg: string; fg: string } => {
  if (status === "approved_standard_escrow" || status === "approved_trusted_fast_path")
    return { bg: "rgba(16, 185, 129, 0.12)", fg: "#6ee7b7" };
  if (status === "submitted" || status === "under_review" || status === "more_evidence_requested")
    return { bg: "rgba(245, 158, 11, 0.12)", fg: "#fcd34d" };
  if (status === "denied")
    return { bg: "rgba(239, 68, 68, 0.12)", fg: "#fca5a5" };
  return { bg: "rgba(96, 165, 250, 0.12)", fg: "#93c5fd" };
};

const isPublicReleaseRoute = (route?: string | null): boolean => {
  return !route || ["LIMITED_MONITORING", "STANDARD_ESCROW", "TRUSTED_FAST_PATH"].includes(route);
};

const isMarketplaceAllowedRoute = (route?: string | null): boolean => {
  return !route || ["STANDARD_ESCROW", "TRUSTED_FAST_PATH"].includes(route);
};

const formatReleaseStatusLabel = (status?: string | null): string => {
  switch (status) {
    case "ready":
      return "Ready";
    case "processing":
      return "Processing";
    case "failed":
      return "Needs attention";
    case "pending":
      return "Preparing";
    case "draft":
      return "Draft";
    default:
      return status ? formatRightsLabel(status) || status : "Unknown";
  }
};

const getReleaseStatusTone = (status?: string | null): "neutral" | "success" | "warning" | "danger" => {
  if (status === "ready") return "success";
  if (status === "failed") return "danger";
  if (status === "processing" || status === "pending") return "warning";
  return "neutral";
};

const getRightsTone = (route?: string | null) => {
  switch (route) {
    case "BLOCKED":
      return {
        border: "rgba(239, 68, 68, 0.35)",
        background: "rgba(127, 29, 29, 0.18)",
        color: "#fca5a5",
        badgeBg: "rgba(239, 68, 68, 0.12)",
        icon: "x-circle" as const,
      };
    case "QUARANTINED_REVIEW":
      return {
        border: "rgba(245, 158, 11, 0.35)",
        background: "rgba(120, 53, 15, 0.18)",
        color: "#fcd34d",
        badgeBg: "rgba(245, 158, 11, 0.12)",
        icon: "alert-triangle" as const,
      };
    case "LIMITED_MONITORING":
      return {
        border: "rgba(96, 165, 250, 0.35)",
        background: "rgba(30, 64, 175, 0.18)",
        color: "#93c5fd",
        badgeBg: "rgba(96, 165, 250, 0.12)",
        icon: "eye" as const,
      };
    case "TRUSTED_FAST_PATH":
      return {
        border: "rgba(16, 185, 129, 0.35)",
        background: "rgba(6, 78, 59, 0.18)",
        color: "#6ee7b7",
        badgeBg: "rgba(16, 185, 129, 0.12)",
        icon: "shield-check" as const,
      };
    default:
      return {
        border: "rgba(255, 255, 255, 0.12)",
        background: "rgba(255, 255, 255, 0.04)",
        color: "rgba(255,255,255,0.88)",
        badgeBg: "rgba(255, 255, 255, 0.06)",
        icon: "help-circle" as const,
      };
  }
};

export default function ReleaseDetails() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    playQueue,
    mixerMode,
    toggleMixerMode,
    setMixerVolumes,
    isPlaying,
    currentTrack
  } = usePlayer();
  const { addToast } = useToast();
  const { token, userId, login } = useAuth();
  const { trustTier } = useTrustTier();
  const { attestAndStake, pending: attestationPending } = useAttestAndStake();
  const { isPhone } = useBreakpoint();
  // Owner-only info cards (rights-upgrade request + limited monitoring
  // banner) are heavy and dominate the mobile above-the-fold. Default
  // them collapsed on phone; user taps the summary row to expand.
  const [rightsUpgradeCardOpen, setRightsUpgradeCardOpen] = useState(false);
  const [rightsMonitorCardOpen, setRightsMonitorCardOpen] = useState(false);
  useEffect(() => {
    setRightsUpgradeCardOpen(!isPhone);
    setRightsMonitorCardOpen(!isPhone);
  }, [isPhone]);
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [attestationFlowPending, setAttestationFlowPending] = useState(false);
  const [isUpdatingArtwork, setIsUpdatingArtwork] = useState(false);
  const [tracksToAddToPlaylist, setTracksToAddToPlaylist] = useState<LocalTrack[] | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [trackStems, setTrackStems] = useState<Record<string, string>>({}); // trackId -> stemType (e.g. 'vocals')
  const [expandedNftTracks, setExpandedNftTracks] = useState<Set<string>>(new Set());
  const artworkInputRef = useRef<HTMLInputElement>(null);
  const ownerScopedTrackUrlsRef = useRef<Record<string, string>>({});
  const rightsUpgradeStatusRef = useRef<string | null>(null);
  const [recentlyCompletedTracks, setRecentlyCompletedTracks] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; variant: "danger" | "warning" | "default"; confirmLabel: string; onConfirm: () => Promise<void> } | null>(null);
  const [trackProgress, setTrackProgress] = useState<Record<string, number>>({});
  const [selectedNftStems, setSelectedNftStems] = useState<Set<string>>(new Set());
  const [batchModalStems, setBatchModalStems] = useState<BatchStemItem[] | null>(null);
  const [batchModalProtectionId, setBatchModalProtectionId] = useState<bigint | undefined>(undefined);
  const [freshReleaseProtectionId, setFreshReleaseProtectionId] = useState<bigint | undefined>(undefined);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showRightsUpgradeModal, setShowRightsUpgradeModal] = useState(false);
  const [releaseProtection, setReleaseProtection] = useState<ReleaseContentProtectionData | null>(null);
  const [rightsUpgradeRequest, setRightsUpgradeRequest] = useState<ReleaseRightsUpgradeRequestRecord | null>(null);
  const [trustedSourceLinks, setTrustedSourceLinks] = useState<TrustedSourceArtistLinkRecord[]>([]);
  const [errorDetails, setErrorDetails] = useState<{ title: string; message: string } | null>(null);
  const indexedReleaseProtectionId = parseProtectionTokenId(releaseProtection?.tokenId);
  const availableReleaseProtectionId = freshReleaseProtectionId ?? indexedReleaseProtectionId;
  const shouldWaitForPendingRelease = searchParams.get("pending") === "1";
  const rightsTone = getRightsTone(release?.rightsRoute);
  const rightsRouteLabel = formatRightsLabel(release?.rightsRoute) || "Not Evaluated";
  const rightsSourceLabel = formatRightsLabel(release?.rightsSourceType);
  const isAiGeneratedRelease = release?.type?.toLowerCase() === "ai_generated";
  const rightsFlagsForDisplay = isAiGeneratedRelease
    ? release?.rightsFlags?.filter((flag) => flag !== "NEEDS_PROOF_OF_CONTROL")
    : release?.rightsFlags;
  const isOwner = release?.artist?.userId?.toLowerCase() === userId?.toLowerCase();
  const hasFailedProcessing = release?.status === "failed" || release?.tracks?.some(t => t.processingStatus === "failed");
  const isProcessingRelease = release?.status === "processing";
  const hasUnprocessedTracks = release?.tracks?.some(t => !t.stems || t.stems.length <= 1);
  const separatedStemCount = release?.tracks?.reduce((total, track) => {
    const stems = track.stems?.filter((stem) => hasMixerStem([stem])) ?? [];
    return total + stems.length;
  }, 0) ?? 0;
  const totalDurationSeconds = release?.tracks?.reduce((total, track) => total + getTrackDuration(track), 0) ?? 0;
  const stemsOverviewLabel = isProcessingRelease
    ? "In progress"
    : hasFailedProcessing
      ? "Needs retry"
      : separatedStemCount > 0
        ? `${separatedStemCount} ready`
        : "Not produced";
  const marketplaceRestrictedByRights =
    !!release?.rightsRoute && !isMarketplaceAllowedRoute(release.rightsRoute);
  const marketplaceApprovedByRights =
    !!release?.rightsRoute && isMarketplaceAllowedRoute(release.rightsRoute);
  const canUseMixerPreview = !!token;
  const overviewItems = [
    {
      label: "Release",
      value: formatReleaseStatusLabel(release?.status),
      tone: getReleaseStatusTone(release?.status),
    },
    {
      label: "Rights",
      value: rightsRouteLabel,
      tone: marketplaceApprovedByRights ? "success" as const : marketplaceRestrictedByRights ? "warning" as const : "neutral" as const,
    },
    {
      label: "Stems",
      value: stemsOverviewLabel,
      tone: hasFailedProcessing ? "danger" as const : separatedStemCount > 0 ? "success" as const : isProcessingRelease ? "warning" as const : "neutral" as const,
    },
    {
      label: "Runtime",
      value: totalDurationSeconds > 0 ? formatDuration(totalDurationSeconds) : "Not timed",
      tone: "accent" as const,
    },
  ];
  const rightsUpgradeStatus =
    rightsUpgradeRequest?.status || releaseProtection?.rightsUpgradeRequestStatus || null;
  const rightsUpgradeStatusLabel =
    isAiGeneratedRelease && !rightsUpgradeStatus
      ? "Automated Provenance"
      : formatRightsUpgradeStatusLabel(rightsUpgradeStatus);
  const rightsReviewDisplay =
    RIGHTS_VERIFICATION_COPY[normalizeRightsVerificationState(
      releaseProtection?.rightsReviewState || releaseProtection?.rightsVerificationStatus,
    )];
  const rightsReviewDescription = isAiGeneratedRelease
    ? marketplaceApprovedByRights
      ? "Resonate generated this release and recorded system provenance automatically. Marketplace access uses the platform AI-generated-work policy rather than creator proof-of-control evidence."
      : "Resonate generated this release and recorded system provenance automatically. Marketplace and payout restrictions are platform policy for AI-generated work, not missing artist proof-of-control evidence."
    : rightsReviewDisplay.description;
  const rightsUpgradeDecisionReason =
    rightsUpgradeRequest?.decisionReason || releaseProtection?.rightsUpgradeDecisionReason || null;
  const canSubmitRightsUpgrade =
    isOwner &&
    !isAiGeneratedRelease &&
    marketplaceRestrictedByRights &&
    (!rightsUpgradeStatus ||
      rightsUpgradeStatus === "more_evidence_requested" ||
      rightsUpgradeStatus === "denied");
  const rightsUpgradeButtonLabel =
    rightsUpgradeStatus === "more_evidence_requested"
      ? "Submit More Evidence"
      : rightsUpgradeStatus === "denied"
        ? "Resubmit Request"
        : "Unlock Marketplace Rights";
  const rightsOnboardingContext = useMemo(
    () =>
      buildReleaseRightsOnboardingContext({
        release,
        releaseProtection,
        trustedSourceLinks,
      }),
    [release, releaseProtection, trustedSourceLinks],
  );
  const guidedRightsOnboarding =
    rightsOnboardingContext.mode === "guided_trusted_source" ? rightsOnboardingContext : null;
  useEffect(() => {
    rightsUpgradeStatusRef.current = rightsUpgradeStatus;
  }, [rightsUpgradeStatus]);
  const needsAttestationForMinting =
    marketplaceApprovedByRights && !!releaseProtection && !releaseProtection.attested;
  const canCompleteAttestation =
    isOwner &&
    needsAttestationForMinting &&
    !!release?.id &&
    !!release?.tracks?.length &&
    !!token;
  const attestationInProgress = attestationPending || attestationFlowPending;
  const mintingBlockedReason = marketplaceRestrictedByRights
    ? `Marketplace minting is disabled while this release is routed as ${rightsRouteLabel}.`
    : needsAttestationForMinting && !canCompleteAttestation
      ? "Marketplace access is approved. The creator wallet must protect this release on-chain before minting and listing stems."
      : null;
  const attestationMintNotice = needsAttestationForMinting
    ? canCompleteAttestation
      ? "Marketplace access is approved. Mint & List will protect this release on-chain first, then continue with the selected stems."
      : mintingBlockedReason
    : null;
  const requestedListingPriceWei = DEFAULT_MARKETPLACE_LISTING_PRICE_WEI;

  const handleRetryProcessing = useCallback(async () => {
    if (!token || !release?.id) return;

    try {
      const { retryRelease } = await import("../../../lib/api");
      await retryRelease(token, release.id);
      addToast({ type: "success", title: "Retrying...", message: "Processing restarted." });
      setRelease(prev => prev ? {
        ...prev,
        status: "processing",
        processingError: null,
        tracks: prev.tracks?.map(t => ({
          ...t,
          processingStatus: "separating" as const,
          processingError: null,
        })),
      } : null);
    } catch (e) {
      console.error(e);
      addToast({ type: "error", title: "Retry failed", message: "Could not restart processing." });
    }
  }, [addToast, release?.id, token]);

  const handleProduceStems = useCallback(async () => {
    if (!token || !release?.id) return;

    try {
      const { retryRelease } = await import("../../../lib/api");
      await retryRelease(token, release.id);
      addToast({ type: "success", title: "Stems processing started!", message: "Your tracks are being separated into stems by Demucs." });
      setRelease(prev => prev ? {
        ...prev,
        status: "processing",
        processingError: null,
        tracks: prev.tracks?.map(t =>
          (!t.stems || t.stems.length <= 1)
            ? { ...t, processingStatus: "separating" as const, processingError: null }
            : t
        ),
      } : null);
    } catch (e) {
      console.error(e);
      addToast({ type: "error", title: "Failed", message: "Could not start stem production." });
    }
  }, [addToast, release?.id, token]);

  // Handle real-time track progress updates via WebSocket
  const handleProgressUpdate = useCallback((data: ReleaseProgressUpdate) => {
    if (data.releaseId !== id) return;
    setTrackProgress(prev => ({ ...prev, [data.trackId]: data.progress }));
    // When progress arrives, ensure the track shows "Separating X%"
    setRelease(prev => {
      if (!prev) return prev;
      const needsUpdate = prev.status === 'pending' || prev.tracks?.some(
        t => t.id === data.trackId && t.processingStatus === 'pending'
      );
      if (!needsUpdate) return prev;
      return {
        ...prev,
        status: prev.status === 'pending' ? 'processing' : prev.status,
        tracks: prev.tracks?.map(t =>
          t.id === data.trackId && t.processingStatus === 'pending'
            ? { ...t, processingStatus: 'separating' as const }
            : t
        ),
      };
    });
  }, [id]);

  // Handle real-time track status updates via WebSocket
  const handleTrackStatusUpdate = useCallback((data: TrackStatusUpdate) => {
    if (data.releaseId !== id) return;

    setRelease(prev => {
      if (!prev || !prev.tracks) return prev;
      return {
        ...prev,
        tracks: prev.tracks.map(track =>
          track.id === data.trackId
            ? {
              ...track,
              processingStatus: data.status,
              processingError: data.status === "failed" ? (data.error || track.processingError || "Processing failed.") : null,
            }
            : track
        ),
      };
    });

    // Clear progress when status changes away from separating
    if (data.status !== 'separating') {
      setTrackProgress(prev => {
        const next = { ...prev };
        delete next[data.trackId];
        return next;
      });
    }

    // Track completion with visual feedback
    if (data.status === 'complete') {
      setRecentlyCompletedTracks(prev => new Set([...prev, data.trackId]));
      // Remove from recently completed after 3 seconds
      setTimeout(() => {
        setRecentlyCompletedTracks(prev => {
          const next = new Set(prev);
          next.delete(data.trackId);
          return next;
        });
      }, 3000);
    }
  }, [id]);

  // Handle release status updates (for when processing completes)
  const handleReleaseStatusUpdate = useCallback((data: ReleaseStatusUpdate) => {
    if (data.releaseId !== id) return;

    if (data.status === 'ready') {
      // Refresh release data to get updated stems and tracks
      getRelease(id as string, token).then(freshRelease => {
        if (freshRelease) {
          setRelease(freshRelease);
          addToast({
            title: "Processing Complete",
            message: `"${freshRelease.title}" is now ready to play!`,
            type: "success",
          });
        }
      }).catch(console.error);
    } else if (data.status === 'failed') {
      setRelease(prev => prev ? {
        ...prev,
        status: 'failed',
        processingError: data.error || prev.processingError || "There was an error processing this release.",
      } : null);
      addToast({
        title: "Processing Failed",
        message: data.error || "There was an error processing your release.",
        type: "error",
      });
    }
  }, [id, addToast, token]);

  const handleReleaseRightsRealtimeUpdate = useCallback((data: ReleaseRightsRequestUpdate) => {
    if (!release?.id || data.releaseId !== release.id) return;

    const previousStatus = rightsUpgradeStatusRef.current;

    void Promise.all([
      getRelease(release.id, token).catch(() => null),
      token && isOwner ? getLatestReleaseRightsUpgradeRequest(release.id, token).catch(() => null) : Promise.resolve(null),
      getReleaseContentProtectionStatus(release.id).catch(() => null),
    ]).then(([freshRelease, freshRequest, freshProtection]) => {
      if (freshRelease) {
        setRelease(freshRelease);
      }
      if (isOwner) {
        setRightsUpgradeRequest(freshRequest);
      }
      setReleaseProtection(freshProtection);

      if (data.status === previousStatus) {
        return;
      }

      const toastMessageMap: Record<string, { title: string; message: string; type: "info" | "success" | "error" }> = {
        submitted: {
          title: "Request submitted",
          message: "Your marketplace-rights request was submitted for review.",
          type: "info",
        },
        under_review: {
          title: "Under review",
          message: "Marketplace-rights review has started for this release.",
          type: "info",
        },
        more_evidence_requested: {
          title: "More evidence requested",
          message: freshRequest?.decisionReason || "The reviewer asked for stronger proof before approving marketplace access.",
          type: "info",
        },
        approved_standard_escrow: {
          title: "Marketplace access approved",
          message: "This release was approved under the standard escrow route.",
          type: "success",
        },
        approved_trusted_fast_path: {
          title: "Marketplace access approved",
          message: "This release was approved under the trusted fast path.",
          type: "success",
        },
        denied: {
          title: "Marketplace rights denied",
          message: freshRequest?.decisionReason || "This release remains restricted because the submitted proof was not sufficient.",
          type: "error",
        },
      };

      const toast = toastMessageMap[data.status];
      if (toast && isOwner) {
        addToast(toast);
      }
    });
  }, [addToast, isOwner, release?.id, token]);

  // Subscribe to WebSocket events for real-time updates
  useWebSockets(
    handleReleaseStatusUpdate,
    handleProgressUpdate,
    handleTrackStatusUpdate,
    undefined,
    undefined,
    undefined,
    handleReleaseRightsRealtimeUpdate,
  );

  useEffect(() => {
    setReleaseProtection(null);
    setRightsUpgradeRequest(null);
    setFreshReleaseProtectionId(undefined);
    setBatchModalProtectionId(undefined);
    setBatchModalStems(null);
    setSelectedNftStems(new Set());
  }, [id]);

  useEffect(() => {
    if (typeof id === "string") {
      const loadRelease = shouldWaitForPendingRelease
        ? waitForReleaseAvailability(id, { token, timeoutMs: 15000, intervalMs: 500 })
        : getRelease(id, token);

      loadRelease
        .then((r) => {
          if (r) {
            // If a ?rev= param is present (e.g. from post-publish toast), bust artwork cache
            const rev = searchParams.get('rev');
            if (rev && r.artworkUrl) {
              r.artworkUrl = `${r.artworkUrl}?rev=${rev}`;
            }
          }
          setRelease(r);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [id, searchParams, shouldWaitForPendingRelease, token]);

  useEffect(() => {
    if (!release?.id) {
      setReleaseProtection(null);
      return;
    }

    let cancelled = false;
    getReleaseContentProtectionStatus(release.id)
      .then((data) => {
        if (!cancelled) {
          setReleaseProtection(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReleaseProtection(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [release?.id]);

  useEffect(() => {
    if (!release?.id || !token || !isOwner) {
      setRightsUpgradeRequest(null);
      return;
    }

    let cancelled = false;
    getLatestReleaseRightsUpgradeRequest(release.id, token)
      .then((data) => {
        if (!cancelled) {
          setRightsUpgradeRequest(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRightsUpgradeRequest(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOwner, release?.id, token]);

  useEffect(() => {
    if (!token || !isOwner) {
      setTrustedSourceLinks([]);
      return;
    }

    let cancelled = false;
    listMyTrustedSourceLinks(token)
      .then((links) => {
        if (!cancelled) {
          setTrustedSourceLinks(links);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTrustedSourceLinks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOwner, token]);

  useEffect(() => {
    if (!release?.id || !token || !isOwner) return;

    const shouldPollRights =
      rightsUpgradeStatus === "submitted" || rightsUpgradeStatus === "under_review";

    if (!shouldPollRights) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const [request, protection] = await Promise.all([
          getLatestReleaseRightsUpgradeRequest(release.id, token),
          getReleaseContentProtectionStatus(release.id).catch(() => null),
        ]);

        if (cancelled) return;

        setRightsUpgradeRequest(request);
        setReleaseProtection(protection);
      } catch {
        // Ignore transient polling failures; the next interval will retry.
      }
    };

    const interval = window.setInterval(poll, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isOwner, release?.id, rightsUpgradeStatus, token]);

  // Auto-enable mixer mode when navigating from Quick Mix CTA (?mixer=true&stem=vocals)
  useEffect(() => {
    if (searchParams.get('mixer') === 'true' && canUseMixerPreview && !mixerMode && release?.tracks?.length) {
      toggleMixerMode();
      // Solo the specific stem if provided
      const stemParam = searchParams.get('stem');
      if (stemParam) {
        const newVolumes: Record<string, number> = {};
        for (const st of MIXER_STEM_TYPES) {
          newVolumes[st] = st.toLowerCase() === stemParam.toLowerCase() ? 1 : 0;
        }
        setMixerVolumes(newVolumes);
      }
      // Play the first track to activate the mixer immediately
      handlePlayTrack(0);
    }
    // Only run once when release loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release?.id, canUseMixerPreview]);

  useEffect(() => {
    return () => {
      Object.values(ownerScopedTrackUrlsRef.current).forEach((url) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
      ownerScopedTrackUrlsRef.current = {};
    };
  }, []);

  const resolveTrackPlaybackUrl = useCallback(
    async (trackId: string, fallbackStemUri?: string | null) => {
      if (!release?.id) {
        return undefined;
      }

      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
      const publicUrl = buildTrackStreamUrl({
        releaseId: release.id,
        trackId,
        stemUri: fallbackStemUri,
        apiBase,
      });

      if (!isOwner || !token || isPublicReleaseRoute(release.rightsRoute)) {
        return publicUrl;
      }

      const cached = ownerScopedTrackUrlsRef.current[trackId];
      if (cached) {
        return cached;
      }

      const ownerScopedUrl = await getOwnerScopedTrackStreamObjectUrl(
        release.id,
        trackId,
        token,
      );
      if (ownerScopedUrl) {
        ownerScopedTrackUrlsRef.current[trackId] = ownerScopedUrl;
        return ownerScopedUrl;
      }

      return publicUrl;
    },
    [isOwner, release, token],
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handlePlayTrack = async (trackIndex: number, _specificStem?: string) => {
    if (!release?.tracks) return;
    const playableTracks: LocalTrack[] = await Promise.all((release.tracks || []).map(async (t) => {
      // Use ORIGINAL stem for uploaded tracks, or 'master' for AI-generated tracks
      const originalStem = t.stems?.find(s => s.type?.toUpperCase() === 'ORIGINAL')
        || t.stems?.find(s => s.type === 'master')
        || t.stems?.[0]; // fallback to first stem

      const streamUrl = await resolveTrackPlaybackUrl(t.id, originalStem?.uri);

      return {
        id: t.id,
        title: t.title,
        artist: getTrackArtistCredit(t, release),
        albumArtist: null,
        album: release.title,
        year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
        genre: release.genre || null,
        duration: getTrackDuration(t),
        createdAt: t.createdAt,
        remoteUrl: streamUrl,
        remoteArtworkUrl: release.artworkUrl || undefined,
        catalogTrackId: t.id,
        artistId: release.artist?.id || release.artistId,
        source: "remote",
        stems: withPreviewUrlsForMixerStems(t.stems),
      };
    }));
    void playQueue(playableTracks, trackIndex);
  };

  const handleStemChange = (trackId: string, trackIndex: number, type: string) => {
    setTrackStems(prev => ({ ...prev, [trackId]: type }));

    const isOriginal = type.toUpperCase() === "ORIGINAL";
    const isTrackAlreadyPlaying = currentTrack?.id === trackId;
    const currentSelectedStem = currentTrack?.stems?.find(
      (stem) => normalizeStemType(stem.type) === normalizeStemType(type),
    );
    const currentTrackHasSelectedStem = hasMixerStem(currentTrack?.stems, type);
    const currentTrackHasPreviewSelectedStem = isPreviewBackedMixerStem(currentSelectedStem);
    const needsPlayerTrackRefresh =
      !isTrackAlreadyPlaying ||
      !isPlaying ||
      (!isOriginal && (!currentTrackHasSelectedStem || !currentTrackHasPreviewSelectedStem));

    if (isOriginal) {
      // Playing full track - disable mixer mode for clean playback
      if (mixerMode) {
        toggleMixerMode();
      }
      // If track is already playing, don't re-queue (just let mixer mode change take effect)
      if (needsPlayerTrackRefresh) {
        void handlePlayTrack(trackIndex, type);
      }
    } else {
      if (!canUseMixerPreview) {
        addToast({
          title: "Sign in to preview stems",
          message: "Connect your wallet to use the mixer.",
          type: "info",
        });
        return;
      }

      // Playing an individual stem - enable mixer and solo it
      if (!mixerMode) {
        toggleMixerMode();
      }

      // Solo the selected stem: set it to 100%, mute all others
      const newVolumes: Record<string, number> = {};
      for (const stemType of MIXER_STEM_TYPES) {
        newVolumes[stemType] = stemType.toLowerCase() === type.toLowerCase() ? 1 : 0;
      }
      setMixerVolumes(newVolumes);

      // Only start playback if track isn't already playing
      // IMPORTANT: Call synchronously to preserve user gesture context for browser audio
      // The toggleMixerMode above sets the ref immediately, so playTrack will see the correct state
      if (needsPlayerTrackRefresh) {
        void handlePlayTrack(trackIndex, type);
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapToLocalTrack = useCallback((t: any, remoteUrlOverride?: string): LocalTrack => {
    // Use ORIGINAL stem for playback URL (same as handlePlayTrack)
    // stems[0] is typically an encrypted separated stem, NOT the playable original
    const originalStem = t.stems?.find(
      (s: { type?: string }) => s.type?.toUpperCase() === "ORIGINAL",
    );
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
    const streamUrl = buildTrackStreamUrl({
      releaseId: release?.id,
      trackId: t.id,
      stemUri: originalStem?.uri,
      apiBase,
    });
    return {
      id: t.id,
      title: t.title,
      artist: getTrackArtistCredit(t, release),
      albumArtist: null,
      album: release?.title || "Unknown Album",
      year: release?.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
      genre: release?.genre || null,
      duration: getTrackDuration(t),
      createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
      catalogTrackId: t.id,
      artistId: release?.artist?.id || release?.artistId,
      releaseId: release?.id,
      remoteUrl: remoteUrlOverride || streamUrl,
      remoteArtworkUrl: release?.artworkUrl || undefined,
      source: "remote",
      stems: withPreviewUrlsForMixerStems(t.stems),
    };
  }, [release]);

  const mapToPlayableLocalTrack = useCallback(
    async (t: Track): Promise<LocalTrack> => {
      const originalStem = t.stems?.find(
        (s: { type?: string }) => s.type?.toUpperCase() === "ORIGINAL",
      );
      const streamUrl = await resolveTrackPlaybackUrl(t.id, originalStem?.uri);
      return mapToLocalTrack(t, streamUrl);
    },
    [mapToLocalTrack, resolveTrackPlaybackUrl],
  );

  const handlePlayAll = () => handlePlayTrack(0);

  const handleAddReleaseToPlaylist = async () => {
    if (!release?.tracks) return;
    const allTracks = await Promise.all(release.tracks.map((t) => mapToPlayableLocalTrack(t)));
    setTracksToAddToPlaylist(allTracks);
  };

  const handleSaveToLibrary = async () => {
    if (!release?.tracks) return;
    try {
      const allTracks = await Promise.all(release.tracks.map((t) => mapToPlayableLocalTrack(t)));
      await saveTracksMetadata(allTracks, "remote");
      addToast({
        title: "Success",
        message: `Saved ${allTracks.length} tracks to library`,
        type: "success",
      });
    } catch (error) {
      console.error("Failed to save to library:", error);
      addToast({
        title: "Error",
        message: "Failed to save to library",
        type: "error",
      });
    }
  };

  const resolveMintProtectionId = useCallback(async (): Promise<MintReadiness> => {
    if (!release?.id || !release.tracks?.length || !token || !canCompleteAttestation) {
      addToast({
        title: "Creator wallet required",
        message: "This release must be protected on-chain by the creator wallet before minting.",
        type: "warning",
      });
      return { ready: false };
    }

    setAttestationFlowPending(true);
    try {
      addToast({
        title: "Confirm passkey",
        message: "Approve the passkey prompt so Resonate can protect this release before minting.",
        type: "info",
        duration: 10000,
      });

      const loginResult = await login();
      const accountOverride = loginResult?.account;
      if (!accountOverride) {
        throw new Error("Passkey confirmation did not complete. Try again and approve the Resonate prompt.");
      }

      const orderedTrackIds = [...release.tracks]
        .sort((left, right) => {
          const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
          const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
          return leftPosition - rightPosition;
        })
        .map((track) => track.id);
      const contentHash = await hashReleaseTracks(release.id, orderedTrackIds, token);
      const metadataURI = `resonate://release/${slugifyReleaseTitle(release.title)}`;

      addToast({
        title: "Protecting release",
        message: "Submitting this release's Content Protection attestation on-chain.",
        type: "info",
      });

      const attestationResult = await attestAndStake({
        contentHash,
        fingerprintHash: contentHash,
        metadataURI,
        includeStake: false,
        accountOverride,
      });
      const attestedProtectionId = attestationResult.tokenId;

      let refreshedProtection: ReleaseContentProtectionData | null = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        refreshedProtection = await getReleaseContentProtectionStatus(release.id);
        if (
          refreshedProtection?.attested &&
          parseProtectionTokenId(refreshedProtection.tokenId) === attestedProtectionId
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (
        !refreshedProtection?.attested ||
        parseProtectionTokenId(refreshedProtection.tokenId) !== attestedProtectionId
      ) {
        setReleaseProtection(refreshedProtection);
        addToast({
          title: "Protection still syncing",
          message: "Content Protection was submitted, but staging has not indexed this release yet. Wait a moment, then retry Mint & List.",
          type: "info",
        });
        return { ready: false };
      }

      setReleaseProtection(refreshedProtection);
      addToast({
        title: "Release protected",
        message: "Content Protection is complete. Continuing to mint and list.",
        type: "success",
      });
      setFreshReleaseProtectionId(attestedProtectionId);
      return {
        ready: true,
        protectionId: attestedProtectionId,
      };
    } catch (error) {
      console.error("Failed to complete release attestation", error);
      addToast({
        title: "Attestation failed",
        message: error instanceof Error ? error.message : "Failed to complete the on-chain attestation.",
        type: "error",
      });
      return { ready: false };
    } finally {
      setAttestationFlowPending(false);
    }
  }, [
    addToast,
    attestAndStake,
    canCompleteAttestation,
    login,
    release,
    token,
  ]);

  const completeAttestationForMinting = useCallback(async (): Promise<MintReadiness> => {
    const indexedProtectionId = parseProtectionTokenId(releaseProtection?.tokenId);

    if (!needsAttestationForMinting && indexedProtectionId) {
      return { ready: true, protectionId: indexedProtectionId };
    }

    if (releaseProtection?.attested && indexedProtectionId) {
      return { ready: true, protectionId: indexedProtectionId };
    }

    return resolveMintProtectionId();
  }, [
    needsAttestationForMinting,
    releaseProtection?.attested,
    releaseProtection?.tokenId,
    resolveMintProtectionId,
  ]);

  const resolveBatchReleaseProtectionId = useCallback(async (): Promise<bigint | undefined | false> => {
    const readiness = await completeAttestationForMinting();
    if (!readiness.ready) {
      return false;
    }
    return readiness.protectionId;
  }, [completeAttestationForMinting]);

  const handleCompleteAttestation = useCallback(async () => {
    await completeAttestationForMinting();
  }, [completeAttestationForMinting]);

  const handleArtworkChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !release || !token) return;

    // Optional: local preview for instant feedback
    const previewUrl = URL.createObjectURL(file);
    const originalUrl = release.artworkUrl;

    // Optimistic update
    setRelease(prev => prev ? { ...prev, artworkUrl: previewUrl } : null);
    setIsUpdatingArtwork(true);

    try {
      const formData = new FormData();
      formData.append("artwork", file);

      const result = await updateReleaseArtwork(token, release.id, formData);

      if (result.success) {
        // Force refresh the image by using the helper which ensures API_BASE is included
        // and adding a fresh timestamp to bypass browser cache
        const newUrl = `${getReleaseArtworkUrl(release.id)}?rev=${Date.now()}`;
        setRelease(prev => prev ? { ...prev, artworkUrl: newUrl } : null);
        addToast({
          title: "Artwork updated",
          message: "The release cover has been successfully updated.",
          type: "success"
        });
      }
    } catch (err) {
      console.error("Artwork update failed", err);
      // Revert on error
      setRelease(prev => prev ? { ...prev, artworkUrl: originalUrl } : null);
      addToast({
        title: "Update failed",
        message: "Failed to upload new artwork. Please try again.",
        type: "error"
      });
    } finally {
      setIsUpdatingArtwork(false);
    }
  };

  if (loading) return <div className="loading-state">Initializing Studio...</div>;
  if (!release) return <div className="error-state">Release not found.</div>;

  return (
    <>
    <div className="release-details-container fade-in-up">
      <div className="mesh-gradient-bg" />

      <header className="release-header">
        <div
          className={`header-artwork-container draggable-album ${isOwner ? 'editable' : ''}`}
          draggable="true"
          onDragStart={(e) => {
            e.stopPropagation();
            if (!release.tracks) return;

            const allTracks = release.tracks.map((t) => mapToLocalTrack(t));
            const payload = JSON.stringify({
              type: "release-album",
              tracks: allTracks,
              title: release.title,
              count: allTracks.length,
            });

            e.dataTransfer.setData("application/json", payload);
            e.dataTransfer.setData("text/plain", payload);
            e.dataTransfer.effectAllowed = "copy";

            // Set a custom drag image
            const target = e.currentTarget as HTMLElement;
            e.dataTransfer.setDragImage(target, 75, 75);
          }}
          onClick={() => isOwner && artworkInputRef.current?.click()}
          title={isOwner ? "Click to change artwork, drag to add to playlist" : "Drag to add entire album to playlist"}
        >
          {release.artworkUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={release.artworkUrl}
              alt={release.title}
              className={`header-artwork ${isUpdatingArtwork ? 'opacity-50' : ''}`}
              draggable="false"
            />
          ) : (
            <div className="header-artwork-placeholder">🎵</div>
          )}
          {isOwner && (
            <div className="edit-artwork-overlay">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>{isUpdatingArtwork ? 'Uploading...' : 'Change Cover'}</span>
            </div>
          )}
          {isOwner && !isUpdatingArtwork && (
            <div className="edit-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
          )}
          <div className="drag-badge">Drag Album</div>
        </div>

        <input
          type="file"
          ref={artworkInputRef}
          style={{ display: "none" }}
          accept="image/*"
          onChange={handleArtworkChange}
        />

        <div className="header-info">
          <div className="header-metadata">
            <span className="release-type-badge">{release.type}</span>
            <span className="release-year">{release.releaseDate ? new Date(release.releaseDate).getFullYear() : '2026'}</span>
          </div>
          <h1 className="release-title-lg text-gradient">{release.title}</h1>
          <div className="release-artist-row">
            <div className="artist-avatar" />
            {(() => {
              const displayedArtist =
                release.primaryArtist || release.artist?.displayName || "Unknown Artist";
              const href = artistCreditHref(displayedArtist, release);
              return href ? (
                <Link
                  href={href}
                  className="artist-name clickable"
                  onClick={(e) => e.stopPropagation()}
                >
                  {displayedArtist}
                </Link>
              ) : (
                <span className="artist-name">{displayedArtist}</span>
              );
            })()}
            <span className="dot" />
            <span className="track-count">{release.tracks?.length || 0} tracks</span>
          </div>

          {release.remix && (
            <div
              className="release-remix-provenance"
              style={{
                marginTop: 12,
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(139, 92, 246, 0.25)",
                background: "rgba(139, 92, 246, 0.08)",
                maxWidth: 560,
              }}
            >
              <p
                className="release-remix-attribution"
                style={{ margin: 0, fontSize: 13.5, color: "rgba(255,255,255,0.8)" }}
              >
                {release.remix.attribution}
                {release.remix.sourceReleaseId && (
                  <>
                    {" · "}
                    <Link
                      href={`/release/${release.remix.sourceReleaseId}`}
                      className="release-remix-source-link"
                      style={{ color: "#c4b5fd", textDecoration: "underline" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      View source release
                    </Link>
                  </>
                )}
              </p>
              {(() => {
                const provenance = remixProvenanceLabel(release.remix.grounding);
                if (!provenance) return null;
                return (
                  <p
                    className="release-remix-ai-label"
                    style={{
                      margin: "8px 0 0",
                      fontSize: 12.5,
                      color: "rgba(255,255,255,0.6)",
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className={`release-remix-ai-badge release-remix-ai-badge--${
                        provenance.ai ? "ai" : "audio"
                      }`}
                      style={{
                        flexShrink: 0,
                        padding: "1px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        color: provenance.ai ? "#fcd34d" : "#6ee7b7",
                        background: provenance.ai
                          ? "rgba(245, 158, 11, 0.15)"
                          : "rgba(16, 185, 129, 0.15)",
                        border: `1px solid ${
                          provenance.ai
                            ? "rgba(245, 158, 11, 0.3)"
                            : "rgba(16, 185, 129, 0.3)"
                        }`,
                      }}
                    >
                      {provenance.ai ? "AI-generated" : "Stem-based"}
                    </span>
                    <span className="release-remix-ai-text">{provenance.text}</span>
                  </p>
                );
              })()}
            </div>
          )}

          <ReleaseOverviewStrip items={overviewItems} />

          <div className="header-actions">
            <div className="header-action-group header-action-group--primary">
              <Button onClick={handlePlayAll} className="btn-play-all">
                Play All
              </Button>
              <Button variant="ghost" className="btn-save" onClick={handleAddReleaseToPlaylist}>
                Add to Playlist
              </Button>
              <Button variant="ghost" className="btn-save" onClick={handleSaveToLibrary}>
                Save to Library
              </Button>
              {canUseMixerPreview && hasMixerStem(currentTrack?.stems) && (
                <Button
                  variant="ghost"
                  className={`btn-mixer ${mixerMode ? 'active' : ''}`}
                  onClick={toggleMixerMode}
                >
                  Mixer
                </Button>
              )}
            </div>

            {isOwner && (
              <div className="header-action-group header-action-group--owner">
                {(hasFailedProcessing || isProcessingRelease) && (
                  <Button
                    className="btn-retry"
                    onClick={handleRetryProcessing}
                    style={{
                      backgroundColor: hasFailedProcessing ? 'var(--color-error)' : 'var(--color-warning, #eab308)',
                      color: 'white',
                      borderColor: 'transparent'
                    }}
                  >
                    {hasFailedProcessing ? 'Retry Processing' : 'Restart Processing'}
                  </Button>
                )}
                {!hasFailedProcessing && !isProcessingRelease && hasUnprocessedTracks && (
                  <Button
                    variant="ghost"
                    className="btn-produce-stems"
                    onClick={handleProduceStems}
                  >
                    Produce Stems
                  </Button>
                )}
                <TrackActionMenu
                  actions={[
                    {
                      label: "Edit Cover",
                      icon: <span>🖼️</span>,
                      onClick: () => artworkInputRef.current?.click(),
                    },
                    ...(release.status === 'processing' ? [{
                      label: "Cancel Processing",
                      icon: <span>⏹</span>,
                      variant: "destructive" as const,
                      onClick: () => {
                        if (!token) return;
                        setConfirmDialog({
                          title: "Cancel Processing",
                          message: "Stop processing this release? Tracks will be marked as failed.",
                          variant: "warning",
                          confirmLabel: "Stop Processing",
                          onConfirm: async () => {
                            try {
                              const { cancelProcessing } = await import("../../../lib/api");
                              await cancelProcessing(token, release.id);
                              addToast({ type: "success", title: "Cancelled", message: "Processing has been stopped." });
                              setRelease(prev => prev ? {
                                ...prev,
                                status: 'failed',
                                processingError: "Processing cancelled by user",
                                tracks: prev.tracks?.map(t => ({
                                  ...t,
                                  processingStatus: 'failed' as const,
                                  processingError: "Processing cancelled by user",
                                }))
                              } : null);
                            } catch (e) {
                              console.error(e);
                              addToast({ type: "error", title: "Cancel failed", message: "Could not cancel processing." });
                            } finally {
                              setConfirmDialog(null);
                            }
                          },
                        });
                      },
                    }] : []),
                    {
                      label: "Delete Release",
                      icon: <span>🗑</span>,
                      variant: "destructive" as const,
                      onClick: () => {
                        if (!token) return;
                        setConfirmDialog({
                          title: "Delete Release",
                          message: `Delete "${release.title}"? This action is permanent and cannot be undone.`,
                          variant: "danger",
                          confirmLabel: "Delete Forever",
                          onConfirm: async () => {
                            try {
                              const { deleteRelease } = await import("../../../lib/api");
                              await deleteRelease(token, release.id);
                              addToast({ type: "success", title: "Deleted", message: `"${release.title}" has been removed.` });
                              router.push("/");
                            } catch (e) {
                              console.error(e);
                              addToast({ type: "error", title: "Delete failed", message: "Could not delete the release." });
                            } finally {
                              setConfirmDialog(null);
                            }
                          },
                        });
                      },
                    },
                  ]}
                />
              </div>
            )}
          </div>

          {/* Marketplace restriction CTA — collapsible so it doesn't
           * dominate the mobile above-the-fold. Summary row (icon +
           * chip + chevron) always visible; tap to expand the
           * description, reason, and primary CTA. */}
          {isOwner && marketplaceRestrictedByRights && (() => {
            const upgradeColor = getRightsUpgradeStatusColor(rightsUpgradeStatus);
            return (
              <div
                className="release-rights-upgrade-card"
                style={{
                  marginTop: "16px",
                  borderRadius: "14px",
                  border: `1px solid ${upgradeColor.fg}22`,
                  background: upgradeColor.bg,
                  padding: "12px 16px",
                }}
              >
                <button
                  type="button"
                  className="rights-card-summary"
                  onClick={() => setRightsUpgradeCardOpen((v) => !v)}
                  aria-expanded={rightsUpgradeCardOpen}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    width: "100%",
                    padding: 0,
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={upgradeColor.fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "3px 9px",
                      borderRadius: "999px",
                      background: "rgba(255,255,255,0.06)",
                      color: upgradeColor.fg,
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "0.02em",
                      flexShrink: 0,
                    }}
                  >
                    {rightsUpgradeStatusLabel}
                  </span>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{
                      marginLeft: "auto",
                      flexShrink: 0,
                      opacity: 0.6,
                      transition: "transform 0.2s ease",
                      transform: rightsUpgradeCardOpen ? "rotate(180deg)" : "none",
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {rightsUpgradeCardOpen && (
                  <div
                    className="rights-card-body"
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      marginTop: "10px",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                      <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
                        {isAiGeneratedRelease
                          ? `AI-generated marketplace access uses automated Resonate provenance. Current rights review state: ${rightsReviewDisplay.label}.`
                          : `Marketplace access requires proof-of-control review. Current rights review state: ${rightsReviewDisplay.label}.`}
                      </div>
                      <div style={{ marginTop: "4px", fontSize: "12px", color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
                        {rightsReviewDescription}
                      </div>
                      {canSubmitRightsUpgrade && guidedRightsOnboarding && (
                        <div
                          style={{
                            marginTop: "10px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            padding: "10px 12px",
                            borderRadius: "10px",
                            border: "1px solid rgba(96,165,250,0.2)",
                            background: "rgba(96,165,250,0.08)",
                          }}
                        >
                          <div style={{ fontSize: "12px", color: "#93c5fd", fontWeight: 700 }}>
                            Guided proof-of-control available
                          </div>
                          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.56)", lineHeight: 1.5 }}>
                            Suggested path: {guidedRightsOnboarding.recommendedRoute.replaceAll("_", " ")} via {guidedRightsOnboarding.signalLabel}. Reviewers still make the rights decision.
                          </div>
                        </div>
                      )}
                      {rightsUpgradeDecisionReason && (
                        <div style={{ marginTop: "6px", fontSize: "13px", color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                          {rightsUpgradeDecisionReason}
                        </div>
                      )}
                    </div>

                    {canSubmitRightsUpgrade && (
                      <Button
                        variant="primary"
                        onClick={() => setShowRightsUpgradeModal(true)}
                        style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                      >
                        {rightsUpgradeButtonLabel}
                      </Button>
                    )}
                    {!canSubmitRightsUpgrade && canCompleteAttestation && (
                      <Button
                        variant="primary"
                        onClick={handleCompleteAttestation}
                        disabled={attestationInProgress}
                        style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                      >
                        {attestationInProgress ? "Protecting..." : "Protect Release"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </header>

      {canUseMixerPreview && mixerMode && currentTrack && (
        <div className="mixer-page-section" style={{ marginBottom: 'var(--space-4)' }}>
          <MixerConsole onClose={() => toggleMixerMode()} />
        </div>
      )}

      {/* Rights-monitoring banner is owner-only (#608) and collapsible
       * so it doesn't dominate the mobile above-the-fold. Summary row
       * (icon + badge + chevron) always visible; the source label,
       * timestamp, flag chips, and reason paragraph reveal on tap. */}
      {isOwner && (() => {
        const statusIcon = (() => {
          const common = {
            width: 18, height: 18, viewBox: "0 0 24 24", fill: "none",
            stroke: rightsTone.color, strokeWidth: 2,
            strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
            style: { flexShrink: 0 },
          };
          if (rightsTone.icon === "shield-check") return (<svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>);
          if (rightsTone.icon === "eye") return (<svg {...common}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>);
          if (rightsTone.icon === "alert-triangle") return (<svg {...common}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>);
          if (rightsTone.icon === "x-circle") return (<svg {...common}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>);
          if (rightsTone.icon === "help-circle") return (<svg {...common}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>);
          return null;
        })();
        return (
      <div
        className="release-rights-monitor-card"
        style={{
          marginBottom: "var(--space-4)",
          borderRadius: "14px",
          border: "1px solid rgba(255,255,255,0.06)",
          borderLeft: `3px solid ${rightsTone.color}`,
          background: rightsTone.background,
          padding: "12px 16px",
        }}
      >
        <button
          type="button"
          className="rights-card-summary"
          onClick={() => setRightsMonitorCardOpen((v) => !v)}
          aria-expanded={rightsMonitorCardOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
            padding: 0,
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {statusIcon}
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: "6px",
            padding: "3px 10px",
            background: rightsTone.badgeBg,
            color: rightsTone.color,
            fontWeight: 700,
            fontSize: "0.8rem",
            flexShrink: 0,
          }}>
            {rightsRouteLabel}
          </span>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              opacity: 0.5,
              transition: "transform 0.2s ease",
              transform: rightsMonitorCardOpen ? "rotate(180deg)" : "none",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {rightsMonitorCardOpen && (
          <div className="rights-card-body" style={{ marginTop: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {rightsSourceLabel && (
                <span style={{ fontSize: "0.78rem", opacity: 0.55 }}>
                  {rightsSourceLabel}
                </span>
              )}
              {release.rightsEvaluatedAt && (
                <span style={{ fontSize: "0.72rem", opacity: 0.35, fontFamily: "var(--font-mono)" }}>
                  {new Date(release.rightsEvaluatedAt).toLocaleString()}
                </span>
              )}
              {rightsFlagsForDisplay && rightsFlagsForDisplay.length > 0 && (
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginLeft: "auto" }}>
                  {rightsFlagsForDisplay.map((flag) => (
                    <span key={flag} style={{
                      borderRadius: "4px",
                      padding: "2px 6px",
                      background: "rgba(255,255,255,0.05)",
                      fontSize: "0.68rem",
                      opacity: 0.6,
                      whiteSpace: "nowrap",
                    }}>
                      {formatRightsLabel(flag)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p style={{
              margin: "8px 0 0",
              fontSize: "0.78rem",
              opacity: 0.52,
              lineHeight: 1.5,
            }}>
              {rightsReviewDescription}
            </p>
            {release.rightsReason && (
              <p style={{
                margin: "8px 0 0",
                fontSize: "0.8rem",
                opacity: 0.55,
                lineHeight: 1.5,
              }}>
                {release.rightsReason}
              </p>
            )}
          </div>
        )}
      </div>
        );
      })()}

      {release.status === "failed" && release.processingError && (
        <ProcessingFailureCallout
          error={release.processingError}
          canRetry={isOwner}
          onRetry={handleRetryProcessing}
          onViewDiagnostics={() => setErrorDetails({
            title: "Processing diagnostics",
            message: release.processingError as string,
          })}
        />
      )}

      <section className="tracklist-section glass-panel">
        <div className="tracklist-scroll-container">
          <table className="track-table">
            <thead>
              <tr>
                <th className="th-select">
                  <input
                    type="checkbox"
                    checked={selectedTrackIds.size === (release.tracks?.length || 0) && selectedTrackIds.size > 0}
                    onChange={(e) => {
                      if (e.target.checked && release.tracks) {
                        setSelectedTrackIds(new Set(release.tracks.map(t => t.id)));
                      } else {
                        setSelectedTrackIds(new Set());
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    title="Select all tracks"
                  />
                </th>
                <th>#</th>
                <th>Title</th>
                <th>Status</th>
                <th>Artist</th>
                <th>Genre</th>
                <th className="th-duration">Time</th>
                <th className="th-actions"></th>
              </tr>
            </thead>
            <tbody>
              {release.tracks?.map((track, idx) => {
                const isSelected = selectedTrackIds.has(track.id);
                return (
                  <tr
                    key={track.id}
                    className={`track-row ${isSelected ? "selected" : ""}`}
                    onClick={() => handlePlayTrack(idx)}
                    draggable
                    onDragStart={(e) => {
                      // If this track is selected, drag all selected tracks
                      // Otherwise, just drag this single track
                      if (isSelected && selectedTrackIds.size > 1) {
                        const selectedTracks = release.tracks!
                          .filter(t => selectedTrackIds.has(t.id))
                          .map((t) => mapToLocalTrack(t));
                        const payload = JSON.stringify({
                          type: "release-selection",
                          tracks: selectedTracks,
                          count: selectedTracks.length,
                        });
                        e.dataTransfer.setData("application/json", payload);
                        e.dataTransfer.setData("text/plain", payload);
                      } else {
                        const localTrack = mapToLocalTrack(track);
                        const payload = JSON.stringify({
                          type: "release-track",
                          track: localTrack,
                          title: localTrack.title,
                        });
                        e.dataTransfer.setData("application/json", payload);
                        e.dataTransfer.setData("text/plain", payload);
                      }
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <td className="track-select-cell">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedTrackIds(prev => {
                            const next = new Set(prev);
                            if (next.has(track.id)) {
                              next.delete(track.id);
                            } else {
                              next.add(track.id);
                            }
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="track-num">{idx + 1}</td>
                    <td className="track-title-cell">
                      <div className="track-title-info">
                        <span className="track-title-name">{track.title}</span>
                        {track.explicit && <span className="explicit-tag">E</span>}
                      </div>

                      {canUseMixerPreview && track.stems && track.stems.length > 1 && (
                        <div className="stem-selector" onClick={(e) => e.stopPropagation()}>
                          <div className="stem-btns-group">
                            {(["ORIGINAL", ...MIXER_STEM_TYPES]).map((type) => {
                              const hasStem = track.stems?.some(s => normalizeStemType(s.type) === normalizeStemType(type));
                              if (!hasStem) return null;

                              const isSelected = (trackStems[track.id] || "ORIGINAL").toLowerCase() === type.toLowerCase();
                              return (
                                <button
                                  key={type}
                                  className={`stem-btn ${isSelected ? 'active' : ''}`}
                                  onClick={() => handleStemChange(track.id, idx, type)}
                                  title={`Play ${type}`}
                                >
                                  {type === "ORIGINAL" ? "Full" : type.charAt(0).toUpperCase() + type.slice(1, 4)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="track-status-cell">
                      {/* Processing status badge */}
                      {(track.processingStatus && track.processingStatus !== "complete") || recentlyCompletedTracks.has(track.id) ? (() => {
                        const isFailed = track.processingStatus === "failed";
                        const hasDetails = isFailed && !!track.processingError;
                        const commonStyle: React.CSSProperties = {
                          display: "inline-flex",
                          alignItems: "center",
                          verticalAlign: "middle",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 500,
                          background:
                            recentlyCompletedTracks.has(track.id) ? "#22c55e20" :
                              track.processingStatus === "pending" ? "#3b82f620" :
                                track.processingStatus === "separating" ? "#eab30820" :
                                  track.processingStatus === "encrypting" ? "#f9731620" :
                                    track.processingStatus === "storing" ? "#14b8a620" :
                                      isFailed ? "#ef444420" : "transparent",
                          color:
                            recentlyCompletedTracks.has(track.id) ? "#4ade80" :
                              track.processingStatus === "pending" ? "#60a5fa" :
                                track.processingStatus === "separating" ? "#fbbf24" :
                                  track.processingStatus === "encrypting" ? "#fb923c" :
                                    track.processingStatus === "storing" ? "#2dd4bf" :
                                      isFailed ? "#f87171" : "#a1a1aa",
                          transition: "all 0.3s ease",
                        };
                        const label = (
                          <>
                            {recentlyCompletedTracks.has(track.id) && "✅ Complete"}
                            {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "pending" && "🔵 Pending"}
                            {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "separating" && (
                              trackProgress[track.id] != null
                                ? `🟡 Separating ${trackProgress[track.id]}%`
                                : "🟡 Separating..."
                            )}
                            {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "encrypting" && "🟠 Encrypting..."}
                            {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "storing" && "🟢 Storing..."}
                            {!recentlyCompletedTracks.has(track.id) && isFailed && "🔴 Failed"}
                          </>
                        );
                        if (hasDetails) {
                          const trackFailure = summarizeProcessingFailure(track.processingError);
                          return (
                            <button
                              type="button"
                              className={`processing-badge processing-failed`}
                              title={`${trackFailure.title}. Click to view diagnostics.`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setErrorDetails({
                                  title: `${trackFailure.title} — ${track.title || "track"}`,
                                  message: track.processingError as string,
                                });
                              }}
                              style={{
                                ...commonStyle,
                                border: "1px solid rgba(239, 68, 68, 0.35)",
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                            >
                              {label}
                              <span aria-hidden style={{ opacity: 0.7, marginLeft: 2 }}>›</span>
                            </button>
                          );
                        }
                        return (
                          <span
                            className={`processing-badge processing-${recentlyCompletedTracks.has(track.id) ? 'complete' : track.processingStatus}`}
                            style={commonStyle}
                          >
                            {label}
                          </span>
                        );
                      })() : null}
                    </td>
                    <td
                      className="track-artist"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const name = getTrackArtistCredit(track, release);
                        const href = artistCreditHref(name, release);
                        return href ? (
                          <Link href={href} className="clickable">
                            {name}
                          </Link>
                        ) : (
                          name
                        );
                      })()}
                    </td>
                    <td className="track-genre">{release.genre || "---"}</td>
                    <td className="track-duration">{formatDuration(getTrackDuration(track))}</td>
                    <td className="track-actions-cell">
                      <div
                        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {track.stems && track.stems.length > 0 && (
                          <RemixCta trackId={track.id} trackTitle={track.title} />
                        )}
                        <TrackActionMenu
                          actions={[
                            {
                              label: "Add to Playlist",
                              icon: "🎵",
                              onClick: async () => {
                                setTracksToAddToPlaylist([await mapToPlayableLocalTrack(track)]);
                              },
                            },
                            // Listener path to the stem token pages: every
                            // minted stem of this track gets a menu entry.
                            ...(track.stems ?? [])
                              .filter((stem) => stem.ipnftId)
                              .map((stem) => ({
                                label: `View ${stem.type} stem`,
                                icon:
                                  stem.type === "vocals" ? "🎤" :
                                    stem.type === "drums" ? "🥁" :
                                      stem.type === "bass" ? "🎸" :
                                        stem.type === "piano" ? "🎹" :
                                          stem.type === "guitar" ? "🎸" : "🎵",
                                onClick: () => {
                                  router.push(`/stem/${stem.ipnftId}`);
                                },
                              })),
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* NFT Marketplace Section - Only for owners */}
      {
        isOwner && release.tracks && release.tracks.some(t => t.stems && t.stems.length > 0) && (
          <section id="nft-marketplace" className="nft-section glass-panel">
            <div className="nft-header">
              <div>
                <h3 className="nft-title">NFT Marketplace</h3>
                <p className="nft-subtitle">
                  {marketplaceRestrictedByRights
                    ? "Marketplace actions are restricted until release rights review allows access"
                    : "Mint and list your stems as NFTs"}
                </p>
              </div>
              <a href="/marketplace" className="nft-link">
                View Marketplace →
              </a>
            </div>

            <div className="nft-tracks-scroll-container">
              {marketplaceRestrictedByRights && rightsUpgradeStatus && (() => {
                const upgradeColor = getRightsUpgradeStatusColor(rightsUpgradeStatus);
                return (
                  <div
                    style={{
                      marginBottom: "12px",
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: `1px solid ${upgradeColor.fg}18`,
                      background: upgradeColor.bg,
                      fontSize: "13px",
                      lineHeight: 1.5,
                      color: "rgba(255,255,255,0.74)",
                      display: "flex",
                      alignItems: "baseline",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        background: "rgba(255,255,255,0.06)",
                        color: upgradeColor.fg,
                        fontSize: "11px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {rightsUpgradeStatusLabel}
                    </span>
                    <span>
                      {rightsUpgradeDecisionReason || rightsReviewDisplay.description}
                    </span>
                  </div>
                );
              })()}
              <div className="nft-tracks-accordion">
                {release.tracks.map(track => {
                  const mintableStems = (track.stems || []).filter(s => s.type.toLowerCase() !== "original");
                  if (mintableStems.length === 0) return null;

                  const isExpanded = expandedNftTracks.has(track.id);
                  const toggleExpand = () => {
                    setExpandedNftTracks(prev => {
                      const next = new Set(prev);
                      if (next.has(track.id)) {
                        next.delete(track.id);
                      } else {
                        next.add(track.id);
                      }
                      return next;
                    });
                  };

                  // Batch selection helpers for this track
                  const trackStemIds = mintableStems.map(s => s.id);
                  const selectedInTrack = trackStemIds.filter(id => selectedNftStems.has(id));
                  const allSelectedInTrack = selectedInTrack.length === trackStemIds.length;
                  const someSelectedInTrack = selectedInTrack.length > 0;

                  const toggleSelectAllTrackStems = () => {
                    setSelectedNftStems(prev => {
                      const next = new Set(prev);
                      if (allSelectedInTrack) {
                        trackStemIds.forEach(id => next.delete(id));
                      } else {
                        trackStemIds.forEach(id => next.add(id));
                      }
                      return next;
                    });
                  };

                  const toggleStemSelection = (stemId: string) => {
                    setSelectedNftStems(prev => {
                      const next = new Set(prev);
                      if (next.has(stemId)) {
                        next.delete(stemId);
                      } else {
                        next.add(stemId);
                      }
                      return next;
                    });
                  };

                  const handleBatchMintSelected = async () => {
                    if (mintingBlockedReason) {
                      addToast({
                        type: "warning",
                        title: marketplaceRestrictedByRights ? "Marketplace Restricted" : "Attestation Required",
                        message: mintingBlockedReason,
                      });
                      return;
                    }
                    let releaseProtectionId = availableReleaseProtectionId;
                    if (needsAttestationForMinting) {
                      const mintReadiness = await completeAttestationForMinting();
                      if (!mintReadiness.ready) {
                        return;
                      }
                      releaseProtectionId = mintReadiness.protectionId;
                    }
                    const selected = mintableStems
                      .filter(s => selectedNftStems.has(s.id))
                      .map(s => ({
                        stemId: s.id,
                        stemType: s.type,
                        trackTitle: track.title,
                      }));
                    if (selected.length > 0) {
                      setBatchModalProtectionId(releaseProtectionId);
                      setBatchModalStems(selected);
                    }
                  };

                  return (
                    <div key={track.id} className={`nft-track-group ${isExpanded ? 'expanded' : ''}`}>
                      <button className="nft-track-header" onClick={toggleExpand}>
                        <div className="nft-track-left">
                          <span className="nft-chevron">{isExpanded ? '▼' : '▶'}</span>
                          <span className="nft-track-title">{track.title}</span>
                        </div>
                        <span className="nft-stem-count">{mintableStems.length} stems</span>
                      </button>

                      {isExpanded && (
                        <>
                          {/* Batch action bar */}
                          <div className="nft-batch-bar" onClick={(e) => e.stopPropagation()}>
                            <label className="nft-select-all-label">
                              <input
                                type="checkbox"
                                checked={allSelectedInTrack}
                                ref={(el) => { if (el) el.indeterminate = someSelectedInTrack && !allSelectedInTrack; }}
                                onChange={toggleSelectAllTrackStems}
                                className="nft-batch-checkbox"
                              />
                              <span>{allSelectedInTrack ? 'Deselect All' : 'Select All'}</span>
                            </label>
                            {someSelectedInTrack && (
                              <button
                                className="nft-batch-btn"
                                onClick={handleBatchMintSelected}
                                disabled={!!mintingBlockedReason || attestationInProgress}
                                title={mintingBlockedReason || undefined}
                              >
                                {attestationInProgress ? "Protecting..." : `Mint & List Selected (${selectedInTrack.length})`}
                              </button>
                            )}
                          </div>

                          {attestationMintNotice && (
                            <div className="nft-attestation-notice">
                              <div>{attestationMintNotice}</div>
                            </div>
                          )}

                          <div className="nft-stems-grid">
                            {mintableStems.map(stem => {
                              const isStemSelected = selectedNftStems.has(stem.id);
                              return (
                                <div key={stem.id} className={`nft-stem-chip ${isStemSelected ? 'nft-stem-selected' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={isStemSelected}
                                    onChange={() => toggleStemSelection(stem.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="nft-stem-checkbox"
                                  />
                                  <span className="nft-stem-emoji">
                                    {stem.type === "vocals" ? "🎤" :
                                      stem.type === "drums" ? "🥁" :
                                        stem.type === "bass" ? "🎸" :
                                          stem.type === "piano" ? "🎹" :
                                            stem.type === "guitar" ? "🎸" : "🎵"}
                                  </span>
                                  <span className="nft-stem-name">
                                    {stem.ipnftId ? (
                                      <a
                                        href={`/stem/${stem.ipnftId}`}
                                        title="View the minted stem's token page"
                                        style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {stem.type.charAt(0).toUpperCase() + stem.type.slice(1)}
                                      </a>
                                    ) : (
                                      stem.type.charAt(0).toUpperCase() + stem.type.slice(1)
                                    )}
                                  </span>
                                  {stem.type.toLowerCase() === "master" && (
                                    <span
                                      className="nft-stem-remix-badge"
                                      title="This is the remix master stem — minting it lists your in-app remix for sale."
                                    >
                                      Remix master
                                    </span>
                                  )}
                                  <MintStemButton
                                    stemId={stem.id}
                                    stemType={stem.type}
                                    listingPricePerUnit={requestedListingPriceWei}
                                    releaseProtection={releaseProtection}
                                    trustTier={trustTier}
                                    onBeforeMint={
                                      needsAttestationForMinting && canCompleteAttestation
                                        ? completeAttestationForMinting
                                        : marketplaceApprovedByRights && availableReleaseProtectionId
                                          ? async () => ({ ready: true, protectionId: availableReleaseProtectionId })
                                          : undefined
                                    }
                                    disabled={!!mintingBlockedReason || attestationInProgress}
                                    disabledLabel={
                                      attestationInProgress
                                        ? "Protecting..."
                                        : marketplaceRestrictedByRights
                                          ? "Marketplace Restricted"
                                          : "Creator Wallet Required"
                                    }
                                    disabledReason={mintingBlockedReason || undefined}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="nft-royalties-banner">
              <div className="nft-royalties-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <div className="nft-royalties-title">Enforced Royalties</div>
                <div className="nft-royalties-desc">5% royalty on all secondary sales, paid automatically</div>
              </div>
            </div>
          </section>
        )
      }

      {/* Batch Mint & List Modal */}
      {batchModalStems && batchModalStems.length > 0 && (
        <BatchMintListModal
          stems={batchModalStems}
          listingPriceWei={requestedListingPriceWei}
          releaseProtection={releaseProtection}
          trustTier={trustTier}
          releaseProtectionId={batchModalProtectionId}
          resolveReleaseProtectionId={resolveBatchReleaseProtectionId}
          onClose={() => {
            setBatchModalStems(null);
            setBatchModalProtectionId(undefined);
            setSelectedNftStems(new Set());
          }}
          onComplete={() => {
            // Refresh release to pick up new NFT status
            if (id) {
              getRelease(id as string, token).then(r => setRelease(r)).catch(() => {});
            }
          }}
        />
      )}

      {/* Content Protection — visible to ALL users */}
      <ReleaseContentProtection releaseId={release.id} />

      {/* Report Button — visible to non-owners only */}
      {!isOwner && (
        <>
          <style>{`
            .report-btn { background: rgba(239, 68, 68, 0.06); }
            .report-btn:hover { background: rgba(239, 68, 68, 0.14); border-color: rgba(239, 68, 68, 0.3); }
          `}</style>
          <button
            className="report-btn"
            onClick={() => setShowReportModal(true)}
            style={{
              border: '1px solid rgba(239, 68, 68, 0.15)',
              borderRadius: '10px',
              padding: '10px 18px',
              color: '#ef4444',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              margin: '12px 0',
              transition: 'all 0.2s',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            Report stolen content
          </button>
        </>
      )}

      {/* Modals rendered outside this container via fragment — see bottom of return */}

      {/* Stem Pricing Panel - Only for owners with stems */}
      {isOwner && release.tracks && (() => {
        const pricingTracks = release.tracks
          .map((t) => ({
            trackId: t.id,
            trackTitle: t.title,
            stems: (t.stems || [])
              .filter((s) => hasMixerStem([s]))
              .map((s) => ({ id: s.id, type: s.type })),
          }))
          .filter((t) => t.stems.length > 0);
        if (pricingTracks.length === 0) return null;
        return <StemPricingPanel releaseId={release.id} tracks={pricingTracks} />;
      })()}

      {/* Public Licensing Info — visible to ALL users */}
      <LicensingInfoSection />

      <footer className="release-footer">
        <div className="credits-section">
          <h3>Credits</h3>
          <div className="credits-grid">
            <div className="credit-item">
              <span className="credit-label">Label</span>
              <span className="credit-value">{release.label || "Independent"}</span>
            </div>
            <div className="credit-item">
              <span className="credit-label">Released</span>
              <span className="credit-value">{release.releaseDate ? new Date(release.releaseDate).toLocaleDateString() : "Unknown"}</span>
            </div>
            {release.featuredArtists && (
              <div className="credit-item">
                <span className="credit-label">Featuring</span>
                <span className="credit-value">{release.featuredArtists}</span>
              </div>
            )}
          </div>
        </div>
      </footer>

      <style jsx>{`
        .release-details-container {
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 60px;
          padding: 40px 60px 120px;
        }

        .release-header {
          display: flex;
          gap: clamp(28px, 3vw, 52px);
          /* center (not flex-end) so a long, multi-line title doesn't
             strand the artwork at the bottom and look unbalanced. */
          align-items: center;
          padding-top: 40px;
        }

        .header-artwork-container {
          width: clamp(248px, 22vw, 320px);
          height: clamp(248px, 22vw, 320px);
          flex-shrink: 0;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .header-artwork {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: opacity 0.3s ease;
        }

        .header-artwork-container.editable {
          cursor: pointer;
          position: relative;
        }

        .edit-artwork-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          opacity: 0;
          transition: opacity 0.3s ease;
          color: #fff;
          font-weight: 700;
          font-size: 14px;
        }

        .header-artwork-container.editable:hover .edit-artwork-overlay {
          opacity: 1;
        }

        .edit-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 28px;
          height: 28px;
          background: var(--color-accent);
          color: #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          z-index: 10;
          border: 2px solid rgba(255, 255, 255, 0.2);
        }

        .opacity-50 {
          opacity: 0.5;
        }

        .header-artwork-placeholder {
          width: 100%;
          height: 100%;
          background: var(--studio-surface-raised);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 80px;
        }

        .header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .header-metadata {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 20px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .release-type-badge {
          background: var(--color-accent);
          color: #fff;
          padding: 4px 10px;
          border-radius: 4px;
        }

        .release-year {
          color: var(--color-muted);
        }

        .release-title-lg {
          /* Was a fixed 84px — a long title then wrapped into a giant block
             that dwarfed the artwork. Now it scales and caps sensibly, and
             long words wrap instead of forcing the artwork to shrink. */
          font-size: clamp(40px, 4.6vw, 68px);
          font-weight: 900;
          line-height: 0.98;
          margin-bottom: 28px;
          letter-spacing: -0.03em;
          overflow-wrap: anywhere;
          max-width: 18ch;
        }

        .release-artist-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 22px;
          font-size: 16px;
        }

        .artist-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-accent), #fff);
        }

        .artist-name {
          font-weight: 800;
          color: #fff;
          cursor: pointer;
          transition: color 0.2s;
        }
        .artist-name:hover {
          color: var(--color-accent);
          text-decoration: underline;
        }

        .dot {
          width: 4px;
          height: 4px;
          background: var(--color-muted);
          border-radius: 50%;
        }

        .track-count {
          color: var(--color-muted);
          font-weight: 600;
        }

        .header-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          padding-top: 4px;
        }

        .header-action-group {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .header-action-group--primary {
          flex: 1 1 520px;
        }

        .header-action-group--owner {
          flex: 0 1 auto;
          justify-content: flex-end;
          padding: 6px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 999px;
          background: rgba(255,255,255,0.03);
        }

        .btn-play-all {
          background: #fff !important;
          color: #000 !important;
          font-weight: 700 !important;
          border-radius: 50px !important;
          padding: 0 40px !important;
          height: 56px !important;
        }

        .btn-save {
          border-radius: 50px !important;
          padding: 0 32px !important;
          height: 56px !important;
          border-color: rgba(255, 255, 255, 0.2) !important;
        }

        .btn-retry,
        .btn-produce-stems {
          border-radius: 50px !important;
          padding: 0 24px !important;
          height: 44px !important;
          font-weight: 800 !important;
          white-space: nowrap;
        }

        .btn-produce-stems {
          border-color: var(--color-primary) !important;
          color: var(--color-primary) !important;
          background: rgba(var(--color-accent-rgb), 0.06) !important;
        }

        .btn-mixer {
          border-radius: 50px !important;
          padding: 0 24px !important;
          height: 56px !important;
          border-color: var(--color-accent) !important;
          color: var(--color-accent) !important;
          font-weight: 700 !important;
          transition: all 0.2s ease !important;
        }

        .btn-mixer:hover,
        .btn-mixer.active {
          background: var(--color-accent) !important;
          color: #fff !important;
        }

        .tracklist-section {
          padding: 24px;
          border-radius: 24px;
        }

        .tracklist-scroll-container {
          max-height: 600px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }

        .tracklist-scroll-container::-webkit-scrollbar {
          width: 6px;
        }

        .tracklist-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .tracklist-scroll-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 3px;
        }

        .tracklist-scroll-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .track-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .track-table th {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          color: var(--color-muted);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .th-duration {
          text-align: right;
        }

        .track-row {
          transition: background 0.2s;
          cursor: pointer;
        }

        .track-row:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .track-row td {
          padding: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.02);
          font-size: 14px;
        }

        .track-num {
          width: 40px;
          color: var(--color-muted);
          text-align: center;
          font-family: var(--font-mono);
        }

        .track-title-cell {
          min-width: 250px;
        }

        .track-status-cell {
          width: 140px;
          min-width: 140px;
        }

        .track-title-info {
          display: flex;
          align-items: center;
          flex-wrap: nowrap;
          gap: 8px;
        }

        .track-title-name {
          font-weight: 700;
          color: #fff;
        }

        .explicit-tag {
          font-size: 9px;
          background: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.8);
          padding: 1px 4px;
          border-radius: 2px;
          font-weight: 700;
        }

        .stem-selector {
          display: flex;
          gap: 6px;
          margin-top: 8px;
        }

        .stem-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--color-muted);
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 4px;
          transition: all 0.2s;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .stem-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .stem-btn.active {
          background: var(--color-accent);
          border-color: var(--color-accent);
          color: #fff;
          box-shadow: 0 0 10px rgba(var(--color-accent-rgb), 0.4);
        }

        .track-artist, .track-genre {
          color: var(--color-muted);
        }

        .track-duration {
          text-align: right;
          color: var(--color-muted);
          font-family: var(--font-mono);
        }

        .track-actions-cell {
          text-align: right;
          width: 120px;
        }

        .track-row:hover .track-action-menu-trigger {
          opacity: 1;
        }

        .th-actions {
          width: 120px;
        }

        .release-footer {
          margin-top: 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 60px;
        }

        .credits-section h3 {
          font-size: 20px;
          font-weight: 800;
          margin-bottom: 32px;
        }

        .credits-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 40px;
        }

        .credit-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .credit-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-muted);
          text-transform: uppercase;
        }

        .credit-value {
          font-size: 15px;
          color: #fff;
          font-weight: 600;
        }

        .loading-state, .error-state {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 60vh;
          font-size: 24px;
          font-weight: 700;
          color: var(--color-muted);
        }

        /* NFT Marketplace Accordion Styles */
        .nft-section {
          padding: 24px;
          border-radius: 24px;
        }

        .nft-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }

        .nft-title {
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          margin: 0;
        }

        .nft-subtitle {
          font-size: 14px;
          color: #71717a;
          margin: 4px 0 0;
        }

        .nft-link {
          font-size: 13px;
          color: #10b981;
          text-decoration: none;
          font-weight: 600;
          transition: color 0.2s;
        }

        .nft-link:hover {
          color: #34d399;
        }

        .nft-tracks-accordion {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .nft-tracks-scroll-container {
          max-height: 500px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar {
          width: 6px;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 3px;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .nft-track-group {
          background: #18181b;
          border-radius: 12px;
          border: 1px solid #27272a;
          overflow: hidden;
          transition: border-color 0.2s;
        }

        .nft-track-group.expanded {
          border-color: #3f3f46;
        }

        .nft-track-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: #fff;
          transition: background 0.2s;
        }

        .nft-track-header:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .nft-track-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .nft-chevron {
          font-size: 10px;
          color: #71717a;
          transition: transform 0.2s;
        }

        .nft-track-title {
          font-size: 15px;
          font-weight: 600;
        }

        .nft-stem-count {
          font-size: 12px;
          color: #71717a;
          background: #27272a;
          padding: 4px 10px;
          border-radius: 12px;
        }

        .nft-batch-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 20px;
          border-bottom: 1px solid #27272a;
          animation: fadeSlideIn 0.2s ease;
        }

        .nft-select-all-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #a1a1aa;
          cursor: pointer;
          user-select: none;
          transition: color 0.15s;
        }

        .nft-select-all-label:hover {
          color: #fff;
        }

        .nft-batch-checkbox,
        .nft-stem-checkbox {
          width: 16px;
          height: 16px;
          accent-color: #8b5cf6;
          cursor: pointer;
          flex-shrink: 0;
        }

        .nft-batch-btn {
          padding: 6px 16px;
          background: #8b5cf6;
          border: none;
          border-radius: 8px;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }

        .nft-batch-btn:hover {
          background: #7c3aed;
          transform: translateY(-1px);
        }

        .nft-batch-btn:disabled {
          background: #3f3f46;
          color: #a1a1aa;
          cursor: not-allowed;
          transform: none;
          opacity: 0.8;
        }

        .nft-attestation-notice {
          margin: 0 20px 14px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(245, 158, 11, 0.24);
          background: rgba(245, 158, 11, 0.08);
          color: #fbbf24;
          font-size: 12px;
          line-height: 1.5;
        }

        .nft-stem-selected {
          border-color: #8b5cf6 !important;
          background: rgba(139, 92, 246, 0.1) !important;
        }

        .nft-stems-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 0 20px 20px;
          animation: fadeSlideIn 0.2s ease;
        }

        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .nft-stem-chip {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #27272a;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid #3f3f46;
          transition: border-color 0.2s, background 0.2s;
        }

        .nft-stem-chip:hover {
          background: #3f3f46;
          border-color: #52525b;
        }

        .nft-stem-emoji {
          font-size: 16px;
        }

        .nft-stem-name {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          min-width: 60px;
        }

        .nft-stem-remix-badge {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #10b981;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 999px;
          padding: 2px 8px;
          white-space: nowrap;
        }

        .nft-royalties-banner {
          margin-top: 24px;
          padding: 16px;
          background: #27272a;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .nft-royalties-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: #10b981;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .nft-royalties-title {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
        }

        .nft-royalties-desc {
          font-size: 12px;
          color: #71717a;
        }

        /* ----------------------------------------------------------------
         * Responsive overrides (#565) — release/[id] page
         * Tablet (768–1279): tighter outer padding and header gap, smaller
         *   title, artwork 240px. Header still side-by-side.
         * Phone (<768): stack header (artwork above info), title shrinks
         *   to 36px, container padding collapses to 16px, tracklist max
         *   height shrinks for better scroll ergonomics.
         * ---------------------------------------------------------------- */
        @media (max-width: 1279px) {
          .release-details-container {
            gap: 40px;
            padding: 32px 32px 120px;
          }

          .release-header {
            gap: 32px;
            padding-top: 24px;
          }

          .header-artwork-container {
            width: 240px;
            height: 240px;
          }

          .release-title-lg {
            font-size: 56px;
            margin-bottom: 24px;
          }

          .release-artist-row {
            margin-bottom: 32px;
          }
        }

        @media (max-width: 767px) {
          .release-details-container {
            gap: 28px;
            padding: 16px 16px 120px;
          }

          .release-header {
            flex-direction: column;
            align-items: stretch;
            gap: 20px;
            padding-top: 16px;
          }

          .header-artwork-container {
            width: 100%;
            max-width: 280px;
            height: auto;
            aspect-ratio: 1 / 1;
            margin: 0 auto;
          }

          .release-title-lg {
            font-size: 36px;
            line-height: 1;
            margin-bottom: 16px;
            word-break: break-word;
          }

          .release-artist-row {
            margin-bottom: 20px;
            flex-wrap: wrap;
          }

          .tracklist-section {
            padding: 12px;
          }

          /* Action buttons row: "Play All" + Add to Playlist + Save to
           * Library + (Mixer / Produce Stems) crowd each other on phone.
           * Make Play All the full-width primary CTA, wrap the rest
           * beneath on their own row (#603 follow-up). */
          .header-actions {
            align-items: stretch;
            flex-wrap: wrap;
            gap: 8px;
          }

          .header-action-group {
            width: 100%;
            gap: 8px;
          }

          .header-action-group--owner {
            justify-content: stretch;
            border-radius: 14px;
          }

          .btn-play-all {
            flex-basis: 100% !important;
            height: 48px !important;
            padding: 0 20px !important;
            border-radius: 12px !important;
          }

          .header-action-group > :not(.btn-play-all) {
            flex: 1 1 calc(50% - 4px);
            min-width: 0;
            height: 40px !important;
            padding: 0 10px !important;
            font-size: 13px !important;
            border-radius: 10px !important;
          }

          /* Track table → card mode on phone. The TABLE layout's
           * column competition was squeezing the title cell to ~80px
           * and forcing 7 stem chips into a vertical single-column
           * stack (#603 feedback). Switch the whole table to block
           * layout so each track renders as a top-to-bottom card. */
          .track-table,
          .track-table tbody,
          .track-table tr {
            display: block;
            width: 100%;
          }

          .track-table thead {
            display: none;
          }

          .track-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px 10px;
            padding: 10px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          }

          .track-row td {
            display: block;
            padding: 0;
            border: none;
            min-width: 0;
          }

          .track-num {
            flex: 0 0 auto;
            width: 20px;
            font-size: 13px;
            color: var(--color-muted);
            text-align: left;
            font-family: var(--font-mono);
          }

          /* Title takes the rest of the first row alongside num; use
           * flex: 1 1 0 so it absorbs the remaining width and num
           * stays inline to the left instead of wrapping above. */
          .track-title-cell {
            flex: 1 1 0;
            min-width: 0;
          }

          .track-title-cell .track-title-name {
            font-size: 15px;
            font-weight: 600;
          }

          /* Stem chips: wrap horizontally with plenty of room instead
           * of stacking in a narrow column. The whole .stem-btns-group
           * becomes a flex row with wrap so 4–6 chips fit per line. */
          .track-title-cell .stem-selector {
            width: 100%;
            margin-top: 6px;
          }

          .track-title-cell .stem-btns-group {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
          }

          .track-title-cell .stem-btn {
            flex: 0 0 auto;
          }

          /* Stem buttons should read secondary on phone — the active
           * purple-filled pill + glow was visually dominating the card
           * (#603 follow-up: "make mixer buttons secondary"). Replace
           * the solid fill with a tinted accent outline, drop the
           * glow. !important because the base .stem-btn.active rule
           * sits inside the same scoped style jsx block and can
           * otherwise win via source-order in some hydration
           * orderings. */
          .track-title-cell .stem-btn.active {
            background: rgba(var(--color-accent-rgb), 0.12) !important;
            border-color: rgba(var(--color-accent-rgb), 0.45) !important;
            color: var(--color-accent) !important;
            box-shadow: none !important;
          }

          /* Artist + actions share the bottom row of the card: artist
           * left, ⋮ overflow anchored right. Previously artist took
           * flex: 1 1 100% which forced actions onto yet another row
           * where it floated alone, centered. */
          .track-artist {
            flex: 1 1 0;
            font-size: 12px;
            color: var(--color-muted);
            padding-top: 2px;
            min-width: 0;
          }

          .track-actions-cell {
            flex: 0 0 auto;
            align-self: center;
          }

          /* Hide columns (and their placeholder) that don't fit the
           * card layout. In card mode the <td>s below still render but
           * contribute nothing — hide them so they don't take row
           * space. */
          .track-status-cell,
          .track-genre,
          .track-duration {
            display: none !important;
          }

          .th-select,
          .th-duration,
          .th-actions {
            display: none;
          }

          /* Info cards occupy too much vertical space on phone
           * because they're inline-styled with desktop padding +
           * 40px+ primary CTAs. Tighten paddings, buttons, and
           * typography on phone via classNames added alongside the
           * inline styles (#603 follow-up). */
          .release-rights-upgrade-card,
          .release-rights-monitor-card {
            padding: 10px 12px !important;
            margin-top: 12px !important;
            border-radius: 10px !important;
            flex-wrap: wrap;
          }

          .release-rights-upgrade-card {
            gap: 10px !important;
          }

          /* The Unlock Marketplace Rights CTA inside the upgrade card
           * is big and purple by default. Full-width but shorter on
           * phone so it reads as "next step", not as the page's
           * primary action. */
          .release-rights-upgrade-card > button,
          .release-rights-upgrade-card button {
            flex: 1 1 100%;
            min-height: 40px;
            padding: 0 14px !important;
            font-size: 13px !important;
          }

          .release-rights-monitor-card {
            margin-bottom: 12px !important;
          }

          /* The monitor card's reason paragraph has margin-left: 28px
           * + 0.8rem font + 1.5 line-height inline; tighten. */
          .release-rights-monitor-card p {
            margin-left: 0 !important;
            font-size: 12px !important;
            line-height: 1.4 !important;
            margin-top: 6px !important;
          }
        }
      `}</style>

    </div>

    {/* Modals rendered outside the transformed container so position:fixed works */}
    <AddToPlaylistModal
      tracks={tracksToAddToPlaylist}
      onClose={() => setTracksToAddToPlaylist(null)}
    />

    {showReportModal && (
      <ReportContentModal
        releaseId={release.id}
        onClose={() => setShowReportModal(false)}
        onSubmitted={(result) => {
          addToast({
            type: 'success',
            title: 'Report Filed',
            message: result.disputeId
              ? `Dispute #${result.disputeId} was filed on-chain with a ${result.counterStakeEth} counter-stake.`
              : `Your report was submitted on-chain with a ${result.counterStakeEth} counter-stake.`,
          });
        }}
      />
    )}

    {showRightsUpgradeModal && (
      <ReleaseRightsUpgradeModal
        releaseId={release.id}
        releaseTitle={release.title}
        existingDecisionReason={rightsUpgradeDecisionReason}
        onboardingContext={rightsOnboardingContext}
        onClose={() => setShowRightsUpgradeModal(false)}
        onSubmitted={async (request) => {
          setRightsUpgradeRequest(request);
          setShowRightsUpgradeModal(false);
          const updatedProtection = await getReleaseContentProtectionStatus(release.id).catch(() => null);
          setReleaseProtection(updatedProtection);
        }}
      />
    )}

    <ConfirmDialog
      isOpen={!!confirmDialog}
      title={confirmDialog?.title ?? ""}
      message={confirmDialog?.message ?? ""}
      variant={confirmDialog?.variant ?? "default"}
      confirmLabel={confirmDialog?.confirmLabel ?? "Confirm"}
      onConfirm={confirmDialog?.onConfirm ?? (() => {})}
      onCancel={() => setConfirmDialog(null)}
    />

    <ErrorDetailsDialog
      isOpen={!!errorDetails}
      title={errorDetails?.title ?? ""}
      message={errorDetails?.message ?? ""}
      onClose={() => setErrorDetails(null)}
    />
    </>
  );
}
