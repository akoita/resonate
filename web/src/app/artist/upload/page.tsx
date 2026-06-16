"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "../../../components/auth/AuthGate";
import ArtistGate from "../../../components/auth/ArtistGate";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { ArtistAutocomplete, ArtistTagInput } from "../../../components/ui/ArtistAutocomplete";
import { FileDropZone } from "../../../components/ui/FileDropZone";
import { useToast } from "../../../components/ui/Toast";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  getArtistMe,
  submitReleaseRightsUpgradeRequest,
  uploadStems,
  waitForReleaseAvailability,
  type ArtistProfile,
  type RightsEvidenceKind,
  type RightsEvidenceStrength,
} from "../../../lib/api";
import { extractMetadata } from "../../../lib/metadataExtractor";
import {
  CREATOR_RIGHTS_EVIDENCE_OPTIONS,
  RIGHTS_EVIDENCE_STRENGTH_OPTIONS,
  SUBMITTED_RIGHTS_EVIDENCE_COPY,
  getCreatorRightsEvidenceOption,
  normalizeRightsEvidenceUrl,
} from "../../../lib/rightsEvidence";
import { useTrustTier } from "../../../hooks/useTrustTier";
import { useAttestAndStake } from "../../../hooks/useContracts";
import { useFundingOptions, usePaymentAssets, usePaymentQuote } from "../../../hooks/usePaymentAssets";
import { useZeroDev } from "../../../components/auth/ZeroDevProviderClient";
import { FundingActions } from "../../../components/payments/FundingActions";
import StakeDepositCard from "../../../components/upload/StakeDepositCard";
import {
  formatPaymentAmountWithSymbol,
  paymentAssetSupportsSurface,
} from "../../../lib/payments";
import { recordProductAnalytics } from "../../../lib/productAnalytics";
import { ContentProtectionABI, getAddresses } from "../../../contracts_abi";
import type { Address } from "viem";

const MAX_FILE_SIZE_MB = 200;
const MAX_TOTAL_SIZE_MB = 500;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_TOTAL_SIZE = MAX_TOTAL_SIZE_MB * 1024 * 1024;
const MOOD_TAG_OPTIONS = ["Focus", "Hype", "Chill", "Dark", "Zen", "Club", "Late Night", "Warm"];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function slugifyReleaseTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function multiplyDecimalString(value: string | null | undefined, multiplier: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed || multiplier <= 0) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  const [whole, fractional = ""] = trimmed.split(".");
  const scale = 10n ** BigInt(fractional.length);
  const baseUnits = BigInt(whole) * scale + BigInt(fractional || "0");
  const multiplied = baseUnits * BigInt(multiplier);
  const multipliedWhole = multiplied / scale;
  const multipliedFractional = multiplied % scale;

  if (fractional.length === 0) return multipliedWhole.toString();

  const fractionalText = multipliedFractional
    .toString()
    .padStart(fractional.length, "0")
    .replace(/0+$/, "");

  return fractionalText ? `${multipliedWhole}.${fractionalText}` : multipliedWhole.toString();
}

type Stem = {
  id: string;
  name: string;
  status: "Uploading" | "Processing" | "Ready" | "Error";
  progress: number;
  previewUrl?: string;
  artworkUrl?: string;
  artworkBlob?: Blob; // Added for uploading
  file?: File;
  metadata: {
    title: string;
    artist: string;
    isrc: string;
    explicit: boolean;
    featuredArtists: string;
  };
};

function isStakeFundingError(message: string) {
  return message.includes("Content Protection stake") && message.includes("smart account");
}

export default function ArtistUploadPage() {
  const router = useRouter();
  const { token, address, smartAccountAddress, refreshWallet, login } = useAuth();
  const { chainId, publicClient } = useZeroDev();
  const [stems, setStems] = useState<Stem[]>([]);
  const [selectedStemId, setSelectedStemId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [stakeFundingNotice, setStakeFundingNotice] = useState<string | null>(null);
  const { addToast } = useToast();
  const artworkInputRef = useRef<HTMLInputElement>(null);
  const stakeFundingRef = useRef<HTMLDivElement>(null);
  const { trustTier, loading: trustLoading } = useTrustTier();
  const [stakeAcknowledged, setStakeAcknowledged] = useState(false);
  const [stableStakeAmountUnits, setStableStakeAmountUnits] = useState<bigint | null | undefined>(undefined);
  const { attestAndStake, pending: stakePending } = useAttestAndStake();
  const { assets: paymentAssets } = usePaymentAssets(chainId);
  const fundingWallet = smartAccountAddress ?? address;
  const {
    options: stakeFundingOptions,
    loading: stakeFundingLoading,
    error: stakeFundingError,
  } = useFundingOptions({
    chainId,
    wallet: fundingWallet,
    surface: "upload_stake",
  });
  const preferredStableStakeAsset = paymentAssets.find((asset) => {
    return asset.kind === "stablecoin" && paymentAssetSupportsSurface(asset, "upload_stake");
  }) ?? null;

  // Stake is required unless tier is verified (waived) or trust data is still loading
  const stakeRequired = Boolean(!trustLoading && trustTier && trustTier.stakeAmountWei !== "0");
  const releaseTrackCountForStake = Math.max(stems.length, 1);
  const canonicalStakeAmountUsd = trustTier?.stakeAmountUsd ?? null;
  const totalCanonicalStakeAmountUsd = multiplyDecimalString(
    canonicalStakeAmountUsd,
    releaseTrackCountForStake,
  );
  const {
    quotes: stableStakeQuotes,
    loading: stableStakeQuoteLoading,
  } = usePaymentQuote({
    amountUsd: stakeRequired ? totalCanonicalStakeAmountUsd : null,
    chainId,
    assetId: preferredStableStakeAsset?.assetId,
    surface: "upload_stake",
  });
  const quotedStableStakeAmountUnits = stableStakeQuotes[0]?.amountUnits
    ? BigInt(stableStakeQuotes[0].amountUnits)
    : null;
  const contractStableStakeAmountUnits =
    stableStakeAmountUnits && stableStakeAmountUnits > 0n
      ? stableStakeAmountUnits * BigInt(releaseTrackCountForStake)
      : null;
  const effectiveStableStakeAmountUnits = contractStableStakeAmountUnits
    ? [contractStableStakeAmountUnits, quotedStableStakeAmountUnits]
        .filter((amount): amount is bigint => Boolean(amount && amount > 0n))
        .reduce<bigint>((max, amount) => (amount > max ? amount : max), contractStableStakeAmountUnits)
    : null;
  const stableStakeRequirement = preferredStableStakeAsset && effectiveStableStakeAmountUnits && effectiveStableStakeAmountUnits > 0n
    ? {
        asset: preferredStableStakeAsset,
        amountUnits: effectiveStableStakeAmountUnits,
      }
    : null;
  const stakeAssetLabel = stableStakeRequirement
    ? formatPaymentAmountWithSymbol(
        stableStakeRequirement.amountUnits,
        stableStakeRequirement.asset.decimals,
        stableStakeRequirement.asset.symbol,
      )
    : null;
  const stableMaxListingPriceLabel = stableStakeRequirement && trustTier && !trustTier.maxListingPriceUncapped
    ? formatPaymentAmountWithSymbol(
        stableStakeRequirement.amountUnits * BigInt(trustTier.maxPriceMultiplier),
        stableStakeRequirement.asset.decimals,
        stableStakeRequirement.asset.symbol,
      )
    : null;

  const stableStakeLookupPending = Boolean(
    preferredStableStakeAsset &&
      (stableStakeAmountUnits === undefined || stableStakeQuoteLoading)
  );
  const stakeReady = !stakeRequired || (!stableStakeLookupPending && stakeAcknowledged);

  useEffect(() => {
    setStakeAcknowledged(false);
  }, [releaseTrackCountForStake, stakeAssetLabel, stakeRequired]);

  // Form state
  const [formData, setFormData] = useState({
    releaseType: "single",
    releaseTitle: "",
    title: "",
    primaryArtist: "",
    featuredArtists: "",
    genre: "",
    moods: [] as string[],
    isrc: "",
    label: "",
    releaseDate: new Date().toISOString().split('T')[0],
    explicit: false,
    remixPrice: "5",
    commercialPrice: "25",
    artworkUrl: "",
    artworkBlob: undefined as Blob | undefined,
  });
  const [uploadRightsEvidence, setUploadRightsEvidence] = useState({
    summary: "",
    evidenceKind: "proof_of_control" as RightsEvidenceKind,
    title: "",
    sourceUrl: "",
    claimedRightsholder: "",
    sourceLabel: "",
    artistName: "",
    publicationDate: "",
    isrc: "",
    upc: "",
    description: "",
    strength: "high" as RightsEvidenceStrength,
  });

  const selectedUploadRightsEvidence = useMemo(
    () => getCreatorRightsEvidenceOption(uploadRightsEvidence.evidenceKind),
    [uploadRightsEvidence.evidenceKind],
  );
  const hasUploadRightsEvidenceDraft = [
    uploadRightsEvidence.summary,
    uploadRightsEvidence.title,
    uploadRightsEvidence.sourceUrl,
    uploadRightsEvidence.claimedRightsholder,
    uploadRightsEvidence.sourceLabel,
    uploadRightsEvidence.artistName,
    uploadRightsEvidence.publicationDate,
    uploadRightsEvidence.isrc,
    uploadRightsEvidence.upc,
    uploadRightsEvidence.description,
  ].some((value) => value.trim().length > 0);
  const canSubmitUploadRightsEvidence =
    uploadRightsEvidence.summary.trim().length > 20 &&
    uploadRightsEvidence.title.trim().length > 0 &&
    uploadRightsEvidence.sourceUrl.trim().length > 0 &&
    uploadRightsEvidence.claimedRightsholder.trim().length > 0;

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    getArtistMe(token)
      .then((profile) => {
        if (cancelled) return;
        setArtistProfile(profile);
        if (profile?.displayName) {
          setFormData((prev) => ({
            ...prev,
            primaryArtist: prev.primaryArtist || profile.displayName,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setArtistProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!preferredStableStakeAsset || !publicClient) {
      setStableStakeAmountUnits(null);
      return;
    }

    let cancelled = false;
    setStableStakeAmountUnits(undefined);
    try {
      const addresses = getAddresses(chainId);
      if (addresses.contentProtection === "0x0000000000000000000000000000000000000000") {
        setStableStakeAmountUnits(null);
        return;
      }

      publicClient.readContract({
        address: addresses.contentProtection,
        abi: ContentProtectionABI,
        functionName: "stakeAmountsByToken",
        args: [preferredStableStakeAsset.tokenAddress as Address],
      })
        .then((amount) => {
          if (!cancelled) setStableStakeAmountUnits(amount as bigint);
        })
        .catch(() => {
          if (!cancelled) setStableStakeAmountUnits(null);
        });
    } catch {
      setStableStakeAmountUnits(null);
    }

    return () => {
      cancelled = true;
    };
  }, [chainId, preferredStableStakeAsset, publicClient]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const toggleMoodTag = (mood: string) => {
    setFormData((prev) => ({
      ...prev,
      moods: prev.moods.includes(mood)
        ? prev.moods.filter((entry) => entry !== mood)
        : [...prev.moods, mood],
    }));
  };

  const handlePublish = async () => {
    // Validate required fields
    if (!formData.releaseTitle.trim()) {
      addToast({
        type: "error",
        title: "Missing release title",
        message: "Please enter a release title before publishing.",
      });
      return;
    }
    if (stems.length === 0) {
      addToast({
        type: "error",
        title: "No tracks uploaded",
        message: "Please upload at least one track before publishing.",
      });
      return;
    }

    const missingTitles = stems.some(s => !s.metadata.title.trim());
    if (missingTitles) {
      addToast({
        type: "error",
        title: "Missing track titles",
        message: "Please ensure all uploaded tracks have a title.",
      });
      return;
    }
    if (!formData.primaryArtist.trim()) {
      addToast({
        type: "error",
        title: "Missing artist name",
        message: "Please enter the primary artist name.",
      });
      return;
    }
    if (hasUploadRightsEvidenceDraft && !canSubmitUploadRightsEvidence) {
      addToast({
        type: "warning",
        title: "Rights evidence incomplete",
        message: "Complete the rights summary, evidence title, evidence URL, and claimed rightsholder, or clear the evidence fields before publishing.",
      });
      return;
    }
    let normalizedUploadRightsEvidenceUrl: string | null = null;
    if (hasUploadRightsEvidenceDraft) {
      try {
        normalizedUploadRightsEvidenceUrl = normalizeRightsEvidenceUrl(uploadRightsEvidence.sourceUrl);
      } catch (error) {
        addToast({
          type: "warning",
          title: "Invalid evidence URL",
          message:
            error instanceof Error
              ? error.message
              : "Please provide a valid rights evidence URL before publishing.",
        });
        return;
      }
    }

    setIsPublishing(true);
    setStakeFundingNotice(null);

    try {
      if (!token || !address) {
        throw new Error("Not authenticated");
      }

      void recordProductAnalytics(token, "artist.upload_step_completed", {
        source: "artist_upload",
        subjectType: "artist",
        subjectId: artistProfile?.id,
        payload: {
          step: "metadata",
          releaseType: formData.releaseType || "single",
          trackCount: stems.length,
          moodCount: formData.moods.length,
          hasArtwork: Boolean(formData.artworkBlob || stems[0]?.artworkBlob),
          hasRightsEvidence: hasUploadRightsEvidenceDraft,
          stakeRequired,
        },
      });
      void recordProductAnalytics(token, "artist.upload_step_completed", {
        source: "artist_upload",
        subjectType: "artist",
        subjectId: artistProfile?.id,
        payload: {
          step: "stems",
          trackCount: stems.length,
          readyTrackCount: stems.filter((stem) => stem.status === "Ready").length,
          totalBytes: stems.reduce((sum, stem) => sum + (stem.file?.size ?? 0), 0),
        },
      });

      // Step 1: Always attest on-chain; add stake only when the current trust tier requires it.
      {
        addToast({
          type: "info",
          title: "Content Protection",
          message: stakeRequired && trustTier
            ? "Attesting this release and depositing the required on-chain Content Protection stake. You'll be prompted to sign with your passkey."
            : "Attesting this release on-chain before upload. You'll be prompted to sign with your passkey.",
          duration: 5000,
        });

        // Compute contentHash from all audio files
        const fileBuffers = await Promise.all(
          stems.filter(s => s.file).map(s => s.file!.arrayBuffer())
        );
        const combined = new Uint8Array(
          fileBuffers.reduce((total, buf) => total + buf.byteLength, 0)
        );
        let offset = 0;
        for (const buf of fileBuffers) {
          combined.set(new Uint8Array(buf), offset);
          offset += buf.byteLength;
        }
        const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
        const contentHash = ('0x' + Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;

        // Use contentHash as fingerprintHash placeholder (real fingerprint computed server-side)
        const fingerprintHash = contentHash;

        const metadataURI = `resonate://release/${slugifyReleaseTitle(formData.releaseTitle)}`;
        const loginResult = await login();
        const accountOverride = loginResult?.account;
        if (!accountOverride) {
          throw new Error("Passkey confirmation did not complete. Try again and approve the Resonate prompt.");
        }

        const attestationResult = await attestAndStake({
          contentHash,
          fingerprintHash,
          metadataURI,
          includeStake: stakeRequired,
          stakeAmountWei: stakeRequired && trustTier
            ? BigInt(trustTier.stakeAmountWei) * BigInt(releaseTrackCountForStake)
            : 0n,
          stakeAsset: stakeRequired && stableStakeRequirement
            ? {
                tokenAddress: stableStakeRequirement.asset.tokenAddress as Address,
                amountUnits: stableStakeRequirement.amountUnits,
                symbol: stableStakeRequirement.asset.symbol,
                decimals: stableStakeRequirement.asset.decimals,
              }
            : undefined,
          accountOverride,
        });

        addToast({
          type: "success",
          title: stakeRequired ? "Stake deposited!" : "Content Protection attested!",
          message: stakeRequired && trustTier
            ? `${formatPaymentAmountWithSymbol(
                attestationResult.stakeAmountUnits || attestationResult.stakeAmountWei || 0n,
                attestationResult.stakeAssetDecimals || 18,
                attestationResult.stakeAssetSymbol || "ETH",
              )} staked. Now uploading release...`
            : "Release attested on-chain. Now uploading release...",
          duration: 5000,
        });
      }

      // Step 2: Submit to backend for processing
      const artist = await getArtistMe(token);
      if (!artist) throw new Error("Artist profile not found");

      const metadata = {
        type: formData.releaseType || "single",
        title: formData.releaseTitle,
        primaryArtist: formData.primaryArtist,
        genre: formData.genre || undefined,
        moods: formData.moods,
        label: formData.label || undefined,
        releaseDate: formData.releaseDate || undefined,
        remixPrice: formData.remixPrice || undefined,
        commercialPrice: formData.commercialPrice || undefined,
        tracks: stems.map(s => ({
          title: s.metadata.title,
          artist: s.metadata.artist || formData.primaryArtist || undefined,
          isrc: s.metadata.isrc || undefined,
          explicit: s.metadata.explicit,
          featuredArtists: s.metadata.featuredArtists ? s.metadata.featuredArtists.split(",").map((str: string) => str.trim()) : [],
        }))
      };

      // Check total payload size before uploading
      const totalSize = stems.reduce((acc, s) => acc + (s.file?.size ?? 0), 0)
        + (formData.artworkBlob?.size ?? 0);
      if (totalSize > MAX_TOTAL_SIZE) {
        throw new Error(
          `Total upload size is ${formatFileSize(totalSize)} — max ${MAX_TOTAL_SIZE_MB}MB. ` +
          `Consider using FLAC or MP3 instead of WAV, or upload fewer tracks at once.`
        );
      }

      const uploadPayload = new FormData();
      uploadPayload.append("artistId", artist.id);
      uploadPayload.append("metadata", JSON.stringify(metadata));

      // Append real files
      stems.forEach((stem) => {
        if (stem.file) {
          uploadPayload.append("files", stem.file);
        }
      });

      // Append artwork if available
      if (formData.artworkBlob) {
        uploadPayload.append("artwork", formData.artworkBlob, "artwork.png");
      } else if (stems.length > 0 && stems[0].artworkBlob) {
        // Fallback to first track's artwork
        uploadPayload.append("artwork", stems[0].artworkBlob, "artwork.png");
      }

      const result = await uploadStems(token, uploadPayload);

      if (result?.releaseId) {
        void recordProductAnalytics(token, "artist.upload_step_completed", {
          source: "artist_upload",
          subjectType: "release",
          subjectId: result.releaseId,
          payload: {
            step: "publish",
            trackCount: stems.length,
            hasRightsEvidence: hasUploadRightsEvidenceDraft,
            stakeRequired,
          },
        });
      }

      if (hasUploadRightsEvidenceDraft && result?.releaseId) {
        try {
          await waitForReleaseAvailability(result.releaseId, { token, timeoutMs: 6000 });
          await submitReleaseRightsUpgradeRequest(
            result.releaseId,
            {
              summary: uploadRightsEvidence.summary.trim(),
              requestedRoute: "STANDARD_ESCROW",
              evidences: [
                {
                  kind: uploadRightsEvidence.evidenceKind,
                  title: uploadRightsEvidence.title.trim(),
                  sourceUrl: normalizedUploadRightsEvidenceUrl,
                  claimedRightsholder: uploadRightsEvidence.claimedRightsholder.trim(),
                  sourceLabel: uploadRightsEvidence.sourceLabel.trim() || undefined,
                  artistName: uploadRightsEvidence.artistName.trim() || formData.primaryArtist.trim() || undefined,
                  releaseTitle: formData.releaseTitle.trim(),
                  publicationDate: uploadRightsEvidence.publicationDate.trim() || undefined,
                  isrc: uploadRightsEvidence.isrc.trim() || undefined,
                  upc: uploadRightsEvidence.upc.trim() || undefined,
                  description: uploadRightsEvidence.description.trim() || undefined,
                  strength: uploadRightsEvidence.strength,
                  verificationStatus: "unverified",
                  metadata: {
                    submissionContext: "upload_flow",
                    evidenceLabel: selectedUploadRightsEvidence.label,
                  },
                },
              ],
            },
            token,
          );
          addToast({
            type: "success",
            title: "Rights evidence submitted",
            message: "Your structured evidence was attached to a marketplace-rights review request.",
          });
        } catch (error) {
          const message =
            error instanceof Error && error.message.includes("already has marketplace access")
              ? "The release already has marketplace access, so no rights-upgrade request was needed."
              : "The release was uploaded. Submit the same evidence from the release page once rights routing is available.";
          addToast({
            type: error instanceof Error && error.message.includes("already has marketplace access") ? "info" : "warning",
            title: error instanceof Error && error.message.includes("already has marketplace access")
              ? "Rights evidence not needed"
              : "Rights evidence saved for later",
            message,
            duration: 8000,
          });
        }
      }

      addToast({
        type: "success",
        title: "Release submitted!",
        message: `"${formData.releaseTitle}" has been queued for processing. Click to view or it will appear on your dashboard shortly.`,
        duration: 10000,
        onClick: async () => {
          if (result && result.releaseId) {
            try {
              await waitForReleaseAvailability(result.releaseId, { token, timeoutMs: 4000 });
            } catch {
              // The release page will continue polling while the catalog record settles.
            }
            router.push(`/release/${result.releaseId}?pending=1`);
          }
        }
      });

      // Reset form
      setStems([]);
      setFormData({
        releaseType: "single",
        releaseTitle: "",
        title: "", // Still keeping title in state for now although unused, but better to remove later in a full cleanup
        primaryArtist: artistProfile?.displayName || "",
        featuredArtists: "",
        genre: "",
        moods: [],
        isrc: "",
        label: "",
        releaseDate: new Date().toISOString().split('T')[0],
        explicit: false,
        remixPrice: "5",
        commercialPrice: "25",
        artworkUrl: "", // Added for display
        artworkBlob: undefined,
      });
      setUploadRightsEvidence({
        summary: "",
        evidenceKind: "proof_of_control",
        title: "",
        sourceUrl: "",
        claimedRightsholder: "",
        sourceLabel: "",
        artistName: "",
        publicationDate: "",
        isrc: "",
        upc: "",
        description: "",
        strength: "high",
      });
      setSelectedStemId(null);
    } catch (err) {
      const msg = (err as Error).message || "";
      let title = "Failed to publish";
      let message = msg || "An error occurred while publishing. Please try again.";

      let onClick: (() => void) | undefined;

      if (msg.includes("Total upload size") || msg.includes("File too large")) {
        title = "Upload too large";
        message = msg;
      } else if (msg.includes("413") || msg.includes("Content Too Large") || msg.includes("ERR_FAILED")) {
        title = "Upload too large";
        message = `The upload exceeds the server limit. Try compressing your files to FLAC or MP3, or upload fewer tracks at once.`;
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("CORS")) {
        title = "Network error";
        message = "Could not reach the server. Please check your connection and try again.";
      } else if (msg.includes("ERC20: transfer amount exceeds balance")) {
        title = stableStakeRequirement ? `Add stake ${stableStakeRequirement.asset.symbol}` : "Add stake token balance";
        message = stableStakeRequirement
          ? `Your smart account does not have enough ${stableStakeRequirement.asset.symbol} for the Content Protection stake. Expected ${stakeAssetLabel ?? stableStakeRequirement.asset.symbol}. Open funding options below, then try publishing again.`
          : "Your smart account does not have enough token balance for the Content Protection stake. Open funding options below, then try publishing again.";
        setStakeFundingNotice(message);
        onClick = () => {
          stakeFundingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        };
      } else if (isStakeFundingError(msg)) {
        title = stableStakeRequirement ? `Add stake ${stableStakeRequirement.asset.symbol}` : "Add stake ETH";
        message = stableStakeRequirement
          ? `Your smart account needs ${stableStakeRequirement.asset.symbol} for the Content Protection stake. Open funding options below, then try publishing again.`
          : "Your smart account needs ETH for the Content Protection stake. Open funding options below, then try publishing again.";
        setStakeFundingNotice(msg);
        onClick = () => {
          stakeFundingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        };
      } else if (msg.includes("already been attested")) {
        title = "Already attested";
      } else if (msg.includes("already been deposited")) {
        title = "Already staked";
      } else if (msg.includes("does not own this Content Protection record")) {
        title = "Wrong wallet";
      } else if (msg.includes("blacklisted")) {
        title = "Publishing blocked";
      }

      addToast({
        type: "error",
        title,
        message,
        duration: onClick ? 15000 : 10000,
        onClick,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleFilesSelect = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setIsUploading(true);
    void recordProductAnalytics(token, "artist.upload_started", {
      source: "artist_upload",
      subjectType: "artist",
      subjectId: artistProfile?.id,
      payload: {
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        acceptedTypes: [...new Set(files.map((file) => file.type || "unknown"))].slice(0, 8),
      },
    });

    // Process each file
    for (const file of files) {
      // Validate file type
      const validTypes = ["audio/mpeg", "audio/wav", "audio/flac", "audio/aiff", "audio/x-aiff", "audio/m4a", "audio/ogg"];
      if (!validTypes.some(type => file.type.includes(type.split("/")[1] ?? "") || file.name.match(/\.(mp3|wav|flac|aiff|m4a|ogg)$/i))) {
        addToast({
          type: "error",
          title: "Invalid file format",
          message: `Skipping ${file.name}: please select a valid audio file.`,
        });
        continue;
      }

      // Validate individual file size
      if (file.size > MAX_FILE_SIZE) {
        addToast({
          type: "error",
          title: "File too large",
          message: `${file.name} is ${formatFileSize(file.size)} — max ${MAX_FILE_SIZE_MB}MB per file. Consider compressing to FLAC or MP3.`,
          duration: 8000,
        });
        continue;
      }

      const previewUrl = URL.createObjectURL(file);

      // Auto-extract metadata to pre-fill individual track metadata
      extractMetadata(file).then(meta => {
        const extractedArtworkUrl = meta.artworkBlob ? URL.createObjectURL(meta.artworkBlob) : undefined;
        const extractedArtistCredit = !formData.primaryArtist && !artistProfile?.displayName
          ? meta.artist || meta.albumArtist || ""
          : "";

        setStems(prev => prev.map(s => {
          if (s.file === file) {
            return {
              ...s,
              artworkUrl: extractedArtworkUrl,
              artworkBlob: meta.artworkBlob || undefined,
              metadata: {
                ...s.metadata,
                title: meta.title || s.metadata.title,
                artist: s.metadata.artist || extractedArtistCredit,
                isrc: meta.isrc || s.metadata.isrc,
              }
            };
          }
          return s;
        }));

        // Also update global release metadata if it's the first track and empty
        setFormData(prev => {
          // Fallback logic for release title: Album -> Track Title (if first item)
          const detectedTitle = meta.album || (stems.length === 0 ? meta.title : "");

          return {
            ...prev,
            releaseTitle: prev.releaseTitle || detectedTitle || "",
            primaryArtist: prev.primaryArtist || artistProfile?.displayName || meta.artist || meta.albumArtist || "",
            genre: prev.genre || meta.genre || "",
            label: prev.label || meta.label || "",
            releaseDate: meta.year ? `${meta.year}-01-01` : prev.releaseDate,
            artworkUrl: prev.artworkUrl || extractedArtworkUrl || "",
            artworkBlob: prev.artworkBlob || meta.artworkBlob || undefined,
          };
        });
      }).catch(err => console.error("Metadata extraction failed", err));

      // Create a new stem entry
      const newStem: Stem = {
        id: crypto.randomUUID(),
        name: file.name,
        status: "Uploading",
        progress: 0,
        previewUrl,
        file,
        metadata: {
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: "",
          isrc: "",
          explicit: false,
          featuredArtists: "",
        }
      };

      setStems(prev => [...prev, newStem]);
      if (!selectedStemId) setSelectedStemId(newStem.id);

      // Simulate upload progress
      let progress = 0;
      const uploadInterval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress >= 100) {
          progress = 100;
          clearInterval(uploadInterval);

          // Transition to processing
          setStems(prev =>
            prev.map(s =>
              s.id === newStem.id ? { ...s, status: "Processing", progress: 100 } : s
            )
          );

          // Simulate processing
          setTimeout(() => {
            setStems(prev =>
              prev.map(s =>
                s.id === newStem.id ? { ...s, status: "Ready" } : s
              )
            );
            // Only set isUploading to false if all stems are ready or processing
            setStems(currentStems => {
              if (currentStems.every(s => s.status === "Ready" || s.status === "Error")) {
                setIsUploading(false);
              }
              return currentStems;
            });
          }, 2000);
        } else {
          setStems(prev =>
            prev.map(s =>
              s.id === newStem.id ? { ...s, progress: Math.min(progress, 100) } : s
            )
          );
        }
      }, 200);
    }
  }, [addToast, artistProfile?.displayName, artistProfile?.id, formData.primaryArtist, selectedStemId, stems.length, token]);

  const handleRemoveStem = useCallback((id: string) => {
    setStems(prev => prev.filter(s => s.id !== id));
    if (selectedStemId === id) setSelectedStemId(null);
  }, [selectedStemId]);

  const handleArtworkSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setFormData(prev => ({
      ...prev,
      artworkUrl: url,
      artworkBlob: file
    }));

    addToast({
      type: "success",
      title: "Artwork updated",
      message: "Modified release cover art manually"
    });
  };

  const allReady = stems.length > 0 && stems.every(stem => stem.status === "Ready");
  const primaryArtistDiffersFromProfile = Boolean(
    artistProfile?.displayName &&
    formData.primaryArtist.trim() &&
    formData.primaryArtist.trim().toLowerCase() !== artistProfile.displayName.trim().toLowerCase(),
  );

  return (
    <AuthGate title="Connect your wallet to upload releases.">
      <ArtistGate>
        <main className="upload-grid">
          <Card>
            <div className="upload-panel">
              <div className="upload-section-title">Upload your track</div>
              <p className="home-subtitle">
                Drag and drop your audio file to begin stem separation.
              </p>
              <FileDropZone
                onFilesSelect={handleFilesSelect}
                onFileSelect={(f) => handleFilesSelect([f])}
                multiple
                accept="audio/*"
                disabled={isUploading}
              />
              {stems.length > 0 && (
                <div className="upload-list">
                  <div
                    className={`upload-item-global ${!selectedStemId ? 'active' : ''}`}
                    onClick={() => setSelectedStemId(null)}
                  >
                    <div className="upload-item-artwork">
                      {formData.artworkUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={formData.artworkUrl} alt="Release Artwork" />
                      ) : (
                        <div className="artwork-placeholder">📦</div>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="upload-item-name">Release Information</div>
                      <div className="upload-status">Common settings for all tracks</div>
                    </div>
                  </div>
                  {stems.map(stem => (
                    <div
                      key={stem.id}
                      className={`upload-item ${selectedStemId === stem.id ? 'active' : ''}`}
                      onClick={() => setSelectedStemId(stem.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="upload-item-artwork">
                        {stem.artworkUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={stem.artworkUrl} alt={stem.name} />
                        ) : (
                          <div className="artwork-placeholder">🎵</div>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="upload-item-header">
                          <span className="upload-item-name">{stem.name}</span>
                          <button
                            className="upload-item-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveStem(stem.id);
                            }}
                            title="Remove"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                        <div className={`upload-status upload-status-${stem.status.toLowerCase()}`}>
                          {stem.status}
                        </div>
                        {stem.status !== "Ready" && (
                          <div className="upload-progress">
                            <div
                              className="upload-progress-bar"
                              style={{ width: `${stem.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {stem.status === "Ready" && stem.previewUrl && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const audio = new Audio(stem.previewUrl);
                            audio.play().catch(e => console.error("Preview failed", e));
                            addToast({
                              type: "success",
                              title: "Playing preview",
                              message: `Listening to ${stem.name}`
                            });
                          }}
                        >
                          Preview
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="upload-panel">
              <div className="tabs">
                <button
                  className={`tab ${!selectedStemId ? 'active' : ''}`}
                  onClick={() => setSelectedStemId(null)}
                >
                  Release Settings
                </button>
                {stems.length > 0 && (
                  <button
                    className={`tab ${selectedStemId ? 'active' : ''}`}
                    onClick={() => setSelectedStemId(stems[0]?.id || null)}
                  >
                    Track Details
                  </button>
                )}
              </div>

              {!selectedStemId ? (
                <div className="settings-group">
                  <label>
                    Release type
                    <select
                      name="releaseType"
                      className="track-select-dropdown"
                      value={formData.releaseType}
                      onChange={(e) => setFormData(prev => ({ ...prev, releaseType: e.target.value }))}
                    >
                      <option value="single">Single</option>
                      <option value="ep">EP</option>
                      <option value="album">Album</option>
                      <option value="mixtape">Mixtape</option>
                      <option value="compilation">Compilation</option>
                      <option value="remix">Remix</option>
                      <option value="live">Live</option>
                    </select>
                  </label>

                  <div className="artwork-manual-upload" style={{ marginBottom: "var(--space-3)" }}>
                    <div className="studio-label" style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between" }}>
                      <span>Release Artwork</span>
                      {!formData.artworkUrl && <span style={{ color: "var(--color-error)", fontSize: "10px" }}>⚠️ Required for visibility</span>}
                    </div>
                    <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                      <div className="upload-item-artwork" style={{ width: "80px", height: "80px", margin: 0, borderRadius: "8px" }}>
                        {formData.artworkUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={formData.artworkUrl} alt="Artwork" />
                        ) : (
                          <div className="artwork-placeholder" style={{ fontSize: "28px" }}>🖼️</div>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: "12px", opacity: 0.5, marginBottom: "8px", lineHeight: "1.4" }}>
                          {formData.artworkUrl ? "Artwork detected. Override if needed." : "No artwork found. Upload a square cover (min 1500×1500px)."}
                        </p>
                        <input
                          type="file"
                          ref={artworkInputRef}
                          style={{ display: "none" }}
                          accept="image/*"
                          onChange={handleArtworkSelect}
                        />
                        <Button
                          variant="ghost"
                          onClick={() => artworkInputRef.current?.click()}
                          style={{
                            padding: "4px 12px",
                            fontSize: "11px",
                            height: "auto",
                            borderColor: "rgba(255,255,255,0.1)",
                            color: "var(--color-muted)"
                          }}
                        >
                          Change Artwork
                        </Button>
                      </div>
                    </div>
                  </div>

                  <label>
                    Release title
                    <Input name="releaseTitle" placeholder="Night Drive" value={formData.releaseTitle} onChange={handleInputChange} />
                  </label>
                  <label>
                    Primary artist
                    <ArtistAutocomplete
                      token={token}
                      name="primaryArtist"
                      ariaLabel="Primary artist"
                      placeholder="Aya Lune"
                      value={formData.primaryArtist}
                      onChange={(value) => setFormData(prev => ({ ...prev, primaryArtist: value }))}
                    />
                    {artistProfile?.displayName && (
                      <span className="studio-field-help">
                        Defaults to your managed artist profile: {artistProfile.displayName}.
                      </span>
                    )}
                    {primaryArtistDiffersFromProfile && (
                      <span className="studio-field-warning">
                        This release will be managed by {artistProfile?.displayName}, but credited to {formData.primaryArtist}. Marketplace rights may require proof of control.
                      </span>
                    )}
                  </label>
                  <label>
                    Genre
                    <Input
                      name="genre"
                      placeholder="Electronic"
                      list="genre-list"
                      value={formData.genre}
                      onChange={handleInputChange}
                    />
                    <datalist id="genre-list">
                      <option value="Acid House" />
                      <option value="Acid Jazz" />
                      <option value="Acoustic" />
                      <option value="Afro-Pop" />
                      <option value="Afrobeat" />
                      <option value="Amapiano" />
                      <option value="Alternative" />
                      <option value="Ambient" />
                      <option value="Americana" />
                      <option value="Baile Funk" />
                      <option value="Big Room" />
                      <option value="Bluegrass" />
                      <option value="Blues" />
                      <option value="Bossa Nova" />
                      <option value="Breakbeat" />
                      <option value="Classical" />
                      <option value="Country" />
                      <option value="Dance" />
                      <option value="Dancehall" />
                      <option value="Deep House" />
                      <option value="Disco" />
                      <option value="Drill" />
                      <option value="Drum & Bass" />
                      <option value="Dub" />
                      <option value="Dubstep" />
                      <option value="EDM" />
                      <option value="Electronic" />
                      <option value="Electro" />
                      <option value="Experimental" />
                      <option value="Folk" />
                      <option value="Funk" />
                      <option value="Future Bass" />
                      <option value="Future House" />
                      <option value="Garage" />
                      <option value="Glitch" />
                      <option value="Gospel" />
                      <option value="Grime" />
                      <option value="Hardcore" />
                      <option value="Hardstyle" />
                      <option value="Heavy Metal" />
                      <option value="Hip-Hop" />
                      <option value="House" />
                      <option value="Hyperpop" />
                      <option value="IDM" />
                      <option value="Indie" />
                      <option value="Industrial" />
                      <option value="J-Pop" />
                      <option value="Jazz" />
                      <option value="Jungle" />
                      <option value="K-Pop" />
                      <option value="Kuduro" />
                      <option value="Latin" />
                      <option value="Lo-Fi" />
                      <option value="Melodic Techno" />
                      <option value="Metal" />
                      <option value="Minimal" />
                      <option value="Musiques du monde" />
                      <option value="New Age" />
                      <option value="Nu-Disco" />
                      <option value="Opera" />
                      <option value="Phonk" />
                      <option value="Pop" />
                      <option value="Post-Punk" />
                      <option value="Psytrance" />
                      <option value="Psych-Rock" />
                      <option value="Punk" />
                      <option value="R&B" />
                      <option value="Rap" />
                      <option value="Reggae" />
                      <option value="Reggaeton" />
                      <option value="Rock" />
                      <option value="Ska" />
                      <option value="Slap House" />
                      <option value="Soul" />
                      <option value="Soulful House" />
                      <option value="Synthpop" />
                      <option value="Synthwave" />
                      <option value="Tech House" />
                      <option value="Techno" />
                      <option value="Trance" />
                      <option value="Trap" />
                      <option value="Trip-Hop" />
                      <option value="Tropical House" />
                      <option value="UK Garage" />
                      <option value="Vaporwave" />
                      <option value="World" />
                    </datalist>
                  </label>
                  <label>
                    Mood tags
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                      {MOOD_TAG_OPTIONS.map((mood) => {
                        const selected = formData.moods.includes(mood);
                        return (
                          <button
                            key={mood}
                            type="button"
                            onClick={() => toggleMoodTag(mood)}
                            style={{
                              border: selected ? "1px solid rgba(124,58,237,0.6)" : "1px solid rgba(255,255,255,0.12)",
                              borderRadius: "999px",
                              padding: "6px 11px",
                              fontSize: "12px",
                              fontWeight: 700,
                              color: selected ? "#c4b5fd" : "rgba(255,255,255,0.72)",
                              background: selected ? "rgba(124,58,237,0.18)" : "rgba(255,255,255,0.04)",
                              cursor: "pointer",
                            }}
                            aria-pressed={selected}
                          >
                            {mood}
                          </button>
                        );
                      })}
                    </div>
                  </label>
                  <label>
                    Label (optional)
                    <Input name="label" placeholder="Resonate Records" value={formData.label} onChange={handleInputChange} />
                  </label>
                  <label>
                    Release date (optional)
                    <Input
                      type="date"
                      name="releaseDate"
                      value={formData.releaseDate}
                      onChange={handleInputChange}
                      className="track-select-dropdown" /* Reuse dropdown styling for consistency */
                      style={{ colorScheme: "dark" }}
                    />
                  </label>
                  <label>
                    Remix price (USDC)
                    <Input name="remixPrice" placeholder="5" value={formData.remixPrice} onChange={handleInputChange} />
                  </label>
                  <label>
                    Commercial price (USDC)
                    <Input name="commercialPrice" placeholder="25" value={formData.commercialPrice} onChange={handleInputChange} />
                  </label>

                  <div style={{
                    marginTop: "6px",
                    padding: "14px",
                    border: "1px solid rgba(245, 158, 11, 0.22)",
                    borderRadius: "10px",
                    background: "rgba(245, 158, 11, 0.06)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                      <div>
                        <div className="studio-label" style={{ marginBottom: "4px" }}>
                          Marketplace rights evidence
                        </div>
                        <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.45, color: "rgba(255,255,255,0.52)" }}>
                          Optional during upload. {SUBMITTED_RIGHTS_EVIDENCE_COPY}
                        </p>
                      </div>
                      {hasUploadRightsEvidenceDraft && (
                        <span style={{
                          flexShrink: 0,
                          padding: "3px 8px",
                          borderRadius: "999px",
                          border: canSubmitUploadRightsEvidence
                            ? "1px solid rgba(16,185,129,0.3)"
                            : "1px solid rgba(245,158,11,0.3)",
                          color: canSubmitUploadRightsEvidence ? "#34d399" : "#f59e0b",
                          fontSize: "10px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                        }}>
                          {canSubmitUploadRightsEvidence ? "Ready" : "Incomplete"}
                        </span>
                      )}
                    </div>

                    <label>
                      Evidence type
                      <select
                        className="track-select-dropdown"
                        value={uploadRightsEvidence.evidenceKind}
                        onChange={(e) => setUploadRightsEvidence((prev) => ({
                          ...prev,
                          evidenceKind: e.target.value as RightsEvidenceKind,
                        }))}
                      >
                        {CREATOR_RIGHTS_EVIDENCE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="studio-field-help">
                        {selectedUploadRightsEvidence.hint}
                      </span>
                    </label>

                    <label>
                      Rights summary
                      <textarea
                        value={uploadRightsEvidence.summary}
                        onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, summary: e.target.value }))}
                        rows={3}
                        className="track-select-dropdown"
                        style={{ minHeight: "76px", resize: "vertical" }}
                        placeholder="Summarize the rightsholder, publishing authority, prior distribution history, and proof-of-control context."
                      />
                      <span className="studio-field-help">
                        Required only if you submit evidence during upload.
                      </span>
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                      <label>
                        Evidence title
                        <Input
                          value={uploadRightsEvidence.title}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, title: e.target.value }))}
                          placeholder={selectedUploadRightsEvidence.titlePlaceholder}
                        />
                      </label>
                      <label>
                        Claimed rightsholder
                        <Input
                          value={uploadRightsEvidence.claimedRightsholder}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, claimedRightsholder: e.target.value }))}
                          placeholder="Artist, label, publisher, or company"
                        />
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                      <label>
                        Evidence URL
                        <Input
                          value={uploadRightsEvidence.sourceUrl}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, sourceUrl: e.target.value }))}
                          placeholder={selectedUploadRightsEvidence.sourceUrlPlaceholder}
                        />
                      </label>
                      <label>
                        Evidence strength
                        <select
                          className="track-select-dropdown"
                          value={uploadRightsEvidence.strength}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({
                            ...prev,
                            strength: e.target.value as RightsEvidenceStrength,
                          }))}
                        >
                          {RIGHTS_EVIDENCE_STRENGTH_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                      <label>
                        Source label
                        <Input
                          value={uploadRightsEvidence.sourceLabel}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, sourceLabel: e.target.value }))}
                          placeholder={selectedUploadRightsEvidence.sourceLabelPlaceholder}
                        />
                      </label>
                      <label>
                        Official artist
                        <Input
                          value={uploadRightsEvidence.artistName}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, artistName: e.target.value }))}
                          placeholder={formData.primaryArtist || "Official artist name"}
                        />
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
                      <label>
                        Publication date
                        <Input
                          type="date"
                          value={uploadRightsEvidence.publicationDate}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, publicationDate: e.target.value }))}
                          className="track-select-dropdown"
                          style={{ colorScheme: "dark" }}
                        />
                      </label>
                      <label>
                        ISRC
                        <Input
                          value={uploadRightsEvidence.isrc}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, isrc: e.target.value.toUpperCase() }))}
                          placeholder="USRC17607839"
                        />
                      </label>
                      <label>
                        UPC
                        <Input
                          value={uploadRightsEvidence.upc}
                          onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, upc: e.target.value }))}
                          placeholder="012345678905"
                        />
                      </label>
                    </div>

                    <label>
                      Evidence context
                      <textarea
                        value={uploadRightsEvidence.description}
                        onChange={(e) => setUploadRightsEvidence((prev) => ({ ...prev, description: e.target.value }))}
                        rows={2}
                        className="track-select-dropdown"
                        style={{ minHeight: "60px", resize: "vertical" }}
                        placeholder={selectedUploadRightsEvidence.contextPlaceholder}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="settings-group">
                  <div className="track-selection-mini">
                    <select
                      value={selectedStemId}
                      onChange={(e) => setSelectedStemId(e.target.value)}
                      className="track-select-dropdown"
                    >
                      {stems.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {stems.find(s => s.id === selectedStemId) && (
                    <>
                      <label>
                        Track title
                        <Input
                          value={stems.find(s => s.id === selectedStemId)?.metadata.title || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, title: val } } : s));
                          }}
                        />
                      </label>
                      <label>
                        Track artist
                        <ArtistAutocomplete
                          token={token}
                          ariaLabel="Track artist"
                          value={stems.find(s => s.id === selectedStemId)?.metadata.artist || ""}
                          placeholder={formData.primaryArtist || "Official artist name"}
                          onChange={(value) => {
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, artist: value } } : s));
                          }}
                        />
                      </label>
                      <label>
                        Featured artists
                        <ArtistTagInput
                          token={token}
                          ariaLabel="Featured artists"
                          placeholder="Search or add a featured artist…"
                          value={stems.find(s => s.id === selectedStemId)?.metadata.featuredArtists || ""}
                          onChange={(value) => {
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, featuredArtists: value } } : s));
                          }}
                        />
                      </label>
                      <label>
                        ISRC (optional)
                        <Input
                          value={stems.find(s => s.id === selectedStemId)?.metadata.isrc || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, isrc: val } } : s));
                          }}
                        />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <input
                          type="checkbox"
                          checked={stems.find(s => s.id === selectedStemId)?.metadata.explicit || false}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setStems(prev => prev.map(s => s.id === selectedStemId ? { ...s, metadata: { ...s.metadata, explicit: val } } : s));
                          }}
                        />
                        Explicit content
                      </label>
                    </>
                  )}
                </div>
              )}

              <StakeDepositCard
                key={`${stakeAssetLabel ?? "native"}-${releaseTrackCountForStake}-${stakeRequired}`}
                trustTier={trustTier}
                loading={trustLoading || stableStakeLookupPending}
                stakeAssetLabel={stakeAssetLabel}
                stakeAssetKind={stableStakeRequirement ? "stablecoin" : "native"}
                maxListingPriceLabel={stableMaxListingPriceLabel}
                stakeTrackCount={releaseTrackCountForStake}
                onStakeAcknowledged={() => setStakeAcknowledged(true)}
              />

              {!stakeReady && allReady && (
                <div style={{
                  marginTop: "1rem",
                  padding: "12px 16px",
                  background: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontSize: "13px",
                  color: "#f59e0b",
                }}>
                  <span style={{ fontSize: "18px" }}>🔒</span>
                  <span>
                    Acknowledge your <strong>{stakeAssetLabel ?? (trustTier ? `${Number(trustTier.stakeAmountWei) / 1e18} ETH` : "...")}</strong> Content Protection stake above to unlock publishing.
                  </span>
                </div>
              )}

              {stakeFundingNotice && (
                <div ref={stakeFundingRef} className="upload-funding-panel">
                  <div className="upload-funding-panel__header">
                    <div>
                      <div className="upload-funding-panel__title">Funding needed</div>
                      <p className="upload-funding-panel__body">
                        {stakeFundingNotice}
                      </p>
                    </div>
                    <button
                      className="vault-btn vault-btn--ghost vault-btn--sm"
                      type="button"
                      onClick={async () => {
                        await refreshWallet();
                        addToast({
                          type: "info",
                          title: "Balance refreshed",
                          message: "Try publishing again after the funding transaction confirms.",
                        });
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                  {stakeFundingLoading ? (
                    <div className="vault-alert vault-alert--info">Loading funding options...</div>
                  ) : stakeFundingError ? (
                    <div className="vault-alert vault-alert--warning">
                      Could not load funding options. Copy the smart account address from the error above and fund it manually.
                    </div>
                  ) : stakeFundingOptions.length > 0 ? (
                    <FundingActions
                      options={stakeFundingOptions}
                      wallet={fundingWallet}
                      token={token}
                      onFunded={async () => {
                        await refreshWallet();
                        addToast({
                          type: "success",
                          title: "Funding submitted",
                          message: "Once the transaction confirms, publish the release again.",
                        });
                      }}
                    />
                  ) : (
                    <div className="vault-alert vault-alert--warning">
                      No funding provider is configured for this network. Transfer ETH to the smart account address shown above, then refresh.
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: "1rem" }}>
                <Button
                  variant={allReady && stakeReady ? "primary" : "ghost"}
                  disabled={!allReady || isPublishing || !stakeReady || stakePending}
                  onClick={handlePublish}
                  className="w-full"
                >
                  {isPublishing ? "Publishing..." : "Publish release"}
                </Button>
              </div>
            </div>
          </Card>
        </main>
      </ArtistGate>
    </AuthGate>
  );
}
