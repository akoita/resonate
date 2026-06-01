"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import {
  getArtistMe,
  listMyReleases,
  listPublishedReleases,
  type ArtistProfile,
} from "../../lib/api";
import {
  createShowCampaignDraft,
  buildCatalogArtistCandidates,
  deleteShowCampaignVisual,
  replaceShowCampaignVisual,
  reorderShowCampaignVisuals,
  updateShowCampaignDraft,
  uploadShowCampaignVisuals,
  type Campaign,
  type CatalogArtistCandidate,
  type ShowCampaignDraftTierInput,
} from "../../lib/shows";

type TierForm = {
  title: string;
  description: string;
  amount: string;
};

type GalleryEditorVisual = {
  id: string;
  persistedId?: string;
  url: string;
  file?: File;
  label: string;
};

const PAYMENT_DECIMALS = 6;
const PAYMENT_SYMBOL = "USDC";
const PUBLIC_CATALOG_STATUSES = new Set(["ready", "published"]);
const MAX_GALLERY_VISUALS = 8;
const CAMPAIGN_VISUAL_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function addDaysForInput(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
}

function isoToInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function inputDateToIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function decimalToUnits(value: string, decimals: number) {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Amounts must be positive numbers.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  const units = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(padded || "0");
  if (units <= 0n) {
    throw new Error("Amounts must be greater than zero.");
  }
  return units.toString();
}

function centsToDecimal(cents: number) {
  return (cents / 100).toString();
}

function validateCampaignVisualFile(file: File, label: string) {
  if (!CAMPAIGN_VISUAL_MIME_TYPES.has(file.type)) {
    throw new Error(`${label} must be a JPEG, PNG, or WebP image.`);
  }
}

function validateCampaignVisualFiles(files: Array<{ file?: File | null; label: string }>) {
  files.forEach(({ file, label }) => {
    if (file) validateCampaignVisualFile(file, label);
  });
}

function initialTiers(campaign?: Campaign): TierForm[] {
  if (campaign?.tiers.length) {
    return campaign.tiers.map((tier) => ({
      title: tier.title,
      description: tier.description ?? "",
      amount: centsToDecimal(tier.amountCents),
    }));
  }
  return [
    { title: "Fan Signal", description: "Refundable support signal and campaign receipt.", amount: "25" },
    { title: "Ticket Intent", description: "Priority allocation if the show is booked.", amount: "75" },
    { title: "Patron Circle", description: "Premium campaign receipt and patron allocation.", amount: "250" },
  ];
}

export function CampaignDraftForm({ campaign }: { campaign?: Campaign }) {
  const router = useRouter();
  const { token, status, role, connect } = useAuth();
  const { chainId } = useZeroDev();
  const galleryObjectUrlsRef = useRef<Set<string>>(new Set());
  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [artistLoaded, setArtistLoaded] = useState(false);
  const [artistHasCatalogContent, setArtistHasCatalogContent] = useState<boolean | null>(null);
  const [artistCandidates, setArtistCandidates] = useState<CatalogArtistCandidate[]>([]);
  const [artistCandidatesLoaded, setArtistCandidatesLoaded] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState(campaign?.artistId ? `profile:${campaign.artistId}` : "");
  const [artistDisplayName, setArtistDisplayName] = useState(campaign?.artistName ?? "");
  const [title, setTitle] = useState(campaign?.title ?? "");
  const [description, setDescription] = useState(campaign?.tagline ?? "");
  const [city, setCity] = useState(campaign?.city ?? "");
  const [country, setCountry] = useState(campaign?.country ?? "");
  const [venueTarget, setVenueTarget] = useState(campaign?.venue ?? "");
  const [targetDate, setTargetDate] = useState(isoToInput(campaign?.targetDate) || addDaysForInput(120));
  const [deadline, setDeadline] = useState(isoToInput(campaign?.deadline) || addDaysForInput(30));
  const [bookingDeadline, setBookingDeadline] = useState(isoToInput(campaign?.bookingDeadline) || addDaysForInput(45));
  const [goalAmount, setGoalAmount] = useState(campaign ? centsToDecimal(campaign.goalCents) : "10000");
  const [minimumBackers, setMinimumBackers] = useState(campaign?.thresholdBackers ? String(campaign.thresholdBackers) : "300");
  const [beneficiaryAddress, setBeneficiaryAddress] = useState(campaign?.beneficiaryAddress ?? "");
  const [authorityEvidenceBundleId, setAuthorityEvidenceBundleId] = useState(campaign?.authorityEvidenceBundleId ?? "");
  const [paymentTokenAddress, setPaymentTokenAddress] = useState(campaign?.paymentTokenAddress ?? "");
  const [tiers, setTiers] = useState<TierForm[]>(() => initialTiers(campaign));
  const [heroVisualFile, setHeroVisualFile] = useState<File | null>(null);
  const [cardVisualFile, setCardVisualFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState(campaign?.heroImage ?? "");
  const [cardPreviewUrl, setCardPreviewUrl] = useState(campaign?.cardImage ?? "");
  const [galleryVisuals, setGalleryVisuals] = useState<GalleryEditorVisual[]>(
    () => campaign?.visuals
      .filter((visual) => visual.role === "gallery")
      .map((visual, index) => ({
        id: visual.id,
        persistedId: visual.id,
        url: visual.url,
        label: visual.caption || `Gallery visual ${index + 1}`,
      })) ?? [],
  );
  const [deletedGalleryVisualIds, setDeletedGalleryVisualIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(campaign);
  const isPrivileged = role === "admin" || role === "operator";
  const selectedArtistCandidate = artistCandidates.find((candidate) => candidate.optionId === selectedArtistId);
  const canSubmit = status === "authenticated"
    && Boolean(token)
    && Boolean(selectedArtistCandidate)
    && (isPrivileged || (artistLoaded && artistHasCatalogContent === true));
  const needsArtistProfile = status === "authenticated" && artistLoaded && !artist && !isPrivileged;
  const needsArtistCatalogContent = status === "authenticated"
    && !isPrivileged
    && artistLoaded
    && Boolean(artist)
    && artistHasCatalogContent === false;
  const draftTitle = useMemo(
    () => title.trim() || (artistDisplayName && city ? `${artistDisplayName} in ${city}` : ""),
    [artistDisplayName, city, title],
  );
  const initialGalleryOrder = useMemo(
    () => campaign?.visuals.filter((visual) => visual.role === "gallery").map((visual) => visual.id) ?? [],
    [campaign?.visuals],
  );
  const currentGalleryOrder = useMemo(
    () => galleryVisuals.map((visual) => visual.persistedId ?? visual.id),
    [galleryVisuals],
  );
  const galleryOrderChanged = currentGalleryOrder.length !== initialGalleryOrder.length
    || currentGalleryOrder.some((id, index) => id !== initialGalleryOrder[index]);

  useEffect(() => {
    if (!token || status !== "authenticated") {
      setArtist(null);
      setArtistLoaded(false);
      return;
    }

    let active = true;
    getArtistMe(token)
      .then(async (profile) => {
        if (!active) return;
        setArtist(profile);
        if (profile && !isPrivileged) {
          setBeneficiaryAddress(profile.payoutAddress || "");
          setPaymentTokenAddress("");
          return;
        }
        setArtistHasCatalogContent(null);
        setArtistDisplayName((current) => current || profile?.displayName || "");
        setBeneficiaryAddress((current) => current || profile?.payoutAddress || "");
      })
      .catch(() => {
        if (active) {
          setArtist(null);
          setArtistHasCatalogContent(null);
        }
      })
      .finally(() => {
        if (active) setArtistLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [isPrivileged, status, token]);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      setArtistCandidates([]);
      setArtistCandidatesLoaded(false);
      return;
    }

    let active = true;
    const releasesPromise = isPrivileged
      ? listPublishedReleases(100)
      : listMyReleases(token);

    releasesPromise
      .then((releases) => {
        if (!active) return;
        const visibleReleases = releases.filter((release) => PUBLIC_CATALOG_STATUSES.has(release.status));
        const candidates = buildCatalogArtistCandidates(visibleReleases);
        setArtistCandidates(candidates);
        if (!isPrivileged) {
          setArtistHasCatalogContent(candidates.length > 0);
        }
        setSelectedArtistId((current) => {
          if (current && candidates.some((candidate) => candidate.optionId === current)) return current;
          const byLegacyProfileId = current
            ? candidates.find((candidate) => candidate.artistId === current)
            : null;
          if (byLegacyProfileId) return byLegacyProfileId.optionId;

          const existingCampaignArtist = campaign?.artistName?.trim().toLowerCase();
          const byCampaignName = existingCampaignArtist
            ? candidates.find((candidate) => candidate.name.trim().toLowerCase() === existingCampaignArtist)
            : null;
          return byCampaignName?.optionId ?? candidates[0]?.optionId ?? "";
        });
      })
      .catch(() => {
        if (active) {
          setArtistCandidates([]);
          if (!isPrivileged) setArtistHasCatalogContent(false);
        }
      })
      .finally(() => {
        if (active) setArtistCandidatesLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [campaign?.artistName, isPrivileged, status, token]);

  useEffect(() => {
    if (!selectedArtistId) return;
    const selected = artistCandidates.find((candidate) => candidate.optionId === selectedArtistId);
    if (selected) setArtistDisplayName(selected.name);
  }, [artistCandidates, selectedArtistId]);

  useEffect(() => {
    if (!heroVisualFile) {
      setHeroPreviewUrl(campaign?.heroImage ?? "");
      return;
    }
    const previewUrl = URL.createObjectURL(heroVisualFile);
    setHeroPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [campaign?.heroImage, heroVisualFile]);

  useEffect(() => {
    if (!cardVisualFile) {
      setCardPreviewUrl(campaign?.cardImage ?? "");
      return;
    }
    const previewUrl = URL.createObjectURL(cardVisualFile);
    setCardPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [campaign?.cardImage, cardVisualFile]);

  useEffect(() => () => {
    galleryObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    galleryObjectUrlsRef.current.clear();
  }, []);

  function createGalleryPreviewUrl(file: File) {
    const previewUrl = URL.createObjectURL(file);
    galleryObjectUrlsRef.current.add(previewUrl);
    return previewUrl;
  }

  function revokeGalleryPreviewUrl(previewUrl: string) {
    if (!galleryObjectUrlsRef.current.delete(previewUrl)) return;
    URL.revokeObjectURL(previewUrl);
  }

  function updateTier(index: number, patch: Partial<TierForm>) {
    setTiers((current) => current.map((tier, tierIndex) => (
      tierIndex === index ? { ...tier, ...patch } : tier
    )));
  }

  function removeTier(index: number) {
    setTiers((current) => current.filter((_, tierIndex) => tierIndex !== index));
  }

  function addGalleryFiles(files: File[]) {
    if (files.length === 0) return;
    const additions = files
      .slice(0, Math.max(0, MAX_GALLERY_VISUALS - galleryVisuals.length))
      .map((file, index) => ({
        id: `new-${Date.now()}-${index}-${file.name}`,
        url: createGalleryPreviewUrl(file),
        file,
        label: file.name,
      }));
    if (additions.length === 0) return;
    setGalleryVisuals((current) => [...current, ...additions]);
  }

  function replaceGalleryVisual(id: string, file: File | null) {
    if (!file) return;
    const previous = galleryVisuals.find((visual) => visual.id === id);
    if (!previous) return;
    const previewUrl = createGalleryPreviewUrl(file);
    setGalleryVisuals((current) => current.map((visual) => (
      visual.id === id
        ? {
          ...visual,
          url: previewUrl,
          file,
          label: file.name,
        }
        : visual
    )));
    if (previous) revokeGalleryPreviewUrl(previous.url);
  }

  function removeGalleryVisual(id: string) {
    const removed = galleryVisuals.find((visual) => visual.id === id);
    if (removed) revokeGalleryPreviewUrl(removed.url);
    if (removed?.persistedId) {
      setDeletedGalleryVisualIds((deleted) => (
        deleted.includes(removed.persistedId!) ? deleted : [...deleted, removed.persistedId!]
      ));
    }
    setGalleryVisuals((current) => current.filter((visual) => visual.id !== id));
  }

  function moveGalleryVisual(index: number, delta: -1 | 1) {
    setGalleryVisuals((current) => {
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const updated = [...current];
      const [item] = updated.splice(index, 1);
      updated.splice(nextIndex, 0, item);
      return updated;
    });
  }

  async function submit() {
    if (!token) {
      await connect();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const normalizedTiers: ShowCampaignDraftTierInput[] = tiers
        .filter((tier) => tier.title.trim() && tier.amount.trim())
        .map((tier, index) => ({
          title: tier.title.trim(),
          description: tier.description.trim() || null,
          amountUnits: decimalToUnits(tier.amount, PAYMENT_DECIMALS),
          currency: campaign?.currency ?? "USD",
          paymentAssetSymbol: PAYMENT_SYMBOL,
          paymentAssetDecimals: PAYMENT_DECIMALS,
          sortOrder: index,
        }));

      if (normalizedTiers.length === 0) {
        throw new Error("Add at least one pledge tier.");
      }
      const replacementVisuals = galleryVisuals.filter((visual) => visual.persistedId && visual.file);
      const newGalleryVisuals = galleryVisuals.filter((visual) => !visual.persistedId && visual.file);
      validateCampaignVisualFiles([
        { file: heroVisualFile, label: "Hero visual" },
        { file: cardVisualFile, label: "Preview visual" },
        ...replacementVisuals.map((visual, index) => ({
          file: visual.file,
          label: `Replacement gallery visual ${index + 1}`,
        })),
        ...newGalleryVisuals.map((visual, index) => ({
          file: visual.file,
          label: `New gallery visual ${index + 1}`,
        })),
      ]);

      const draft = {
        artistId: selectedArtistCandidate?.artistId ?? null,
        artistDisplayName: (selectedArtistCandidate?.name ?? artistDisplayName).trim(),
        title: draftTitle,
        description: description.trim() || null,
        city: city.trim(),
        country: country.trim().toUpperCase() || "US",
        venueTarget: venueTarget.trim() || null,
        targetDate: inputDateToIso(targetDate),
        deadline: inputDateToIso(deadline) ?? "",
        bookingDeadline: inputDateToIso(bookingDeadline),
        goalAmountUnits: decimalToUnits(goalAmount, PAYMENT_DECIMALS),
        minimumBackers: minimumBackers ? Number(minimumBackers) : null,
        currency: campaign?.currency ?? "USD",
        paymentAssetSymbol: PAYMENT_SYMBOL,
        paymentAssetDecimals: PAYMENT_DECIMALS,
        paymentTokenAddress: isPrivileged ? paymentTokenAddress.trim() || null : null,
        beneficiaryAddress: (isPrivileged ? beneficiaryAddress : artist?.payoutAddress ?? beneficiaryAddress).trim() || null,
        beneficiaryType: (isPrivileged ? beneficiaryAddress : artist?.payoutAddress ?? beneficiaryAddress).trim()
          ? "wallet" as const
          : null,
        authorityEvidenceBundleId: authorityEvidenceBundleId.trim() || null,
        tiers: normalizedTiers,
      };

      let saved = campaign
        ? await updateShowCampaignDraft({ campaign, token, draft })
        : await createShowCampaignDraft({ token, draft });
      for (const visual of replacementVisuals) {
        if (visual.persistedId && visual.file) {
          saved = await replaceShowCampaignVisual({
            campaign: saved,
            token,
            visualId: visual.persistedId,
            visual: visual.file,
          });
        }
      }
      const galleryIdMap = new Map<string, string>();
      for (const visualId of deletedGalleryVisualIds) {
        saved = await deleteShowCampaignVisual({ campaign: saved, token, visualId });
      }
      if (heroVisualFile || cardVisualFile || newGalleryVisuals.length > 0) {
        const visuals = new FormData();
        if (heroVisualFile) visuals.append("hero", heroVisualFile);
        if (cardVisualFile) visuals.append("card", cardVisualFile);
        const knownGalleryIds = new Set(saved.visuals.filter((visual) => visual.role === "gallery").map((visual) => visual.id));
        newGalleryVisuals.forEach((visual) => {
          if (visual.file) visuals.append("gallery", visual.file);
        });
        saved = await uploadShowCampaignVisuals({ campaign: saved, token, visuals });
        const createdGalleryVisuals = saved.visuals
          .filter((visual) => visual.role === "gallery" && !knownGalleryIds.has(visual.id))
          .sort((left, right) => left.sortOrder - right.sortOrder);
        newGalleryVisuals.forEach((visual, index) => {
          const created = createdGalleryVisuals[index];
          if (created) galleryIdMap.set(visual.id, created.id);
        });
      }
      const resolvedGalleryOrder = galleryVisuals
        .map((visual) => visual.persistedId ?? galleryIdMap.get(visual.id))
        .filter((visualId): visualId is string => Boolean(visualId));
      if (
        deletedGalleryVisualIds.length > 0
        || newGalleryVisuals.length > 0
        || galleryVisuals.some((visual) => visual.persistedId && visual.file)
        || galleryOrderChanged
      ) {
        saved = await reorderShowCampaignVisuals({ campaign: saved, token, visualIds: resolvedGalleryOrder });
      }
      router.push(`/shows/${saved.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save campaign.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status !== "authenticated") {
    return (
      <section className="shows-create__panel">
        <h2>Connect wallet</h2>
        <p>Campaign drafting requires an artist, admin, or operator account.</p>
        <button type="button" onClick={connect}>Connect wallet</button>
      </section>
    );
  }

  if (needsArtistProfile) {
    return (
      <section className="shows-create__panel">
        <h2>Artist onboarding required</h2>
        <p>Create an artist profile before opening an artist-owned campaign.</p>
        <Link href="/artist/onboarding?returnUrl=/shows/create">Open artist onboarding</Link>
      </section>
    );
  }

  if (needsArtistCatalogContent) {
    return (
      <section className="shows-create__panel">
        <h2>Catalog release required</h2>
        <p>Escrow campaigns can only open for an artist profile with at least one ready or published release on Resonate.</p>
        <Link href="/artist/upload">Upload a release</Link>
      </section>
    );
  }

  return (
    <section className="shows-create__form" aria-label={isEdit ? "Edit show campaign" : "Create show campaign"}>
      <div className="shows-create__panel">
        <h2>Campaign</h2>
        <label>
          Artist {!isPrivileged ? "(from your managed catalog)" : ""}
          <select
            value={selectedArtistId}
            onChange={(event) => setSelectedArtistId(event.target.value)}
            disabled={!artistCandidatesLoaded}
          >
            <option value="">Select a catalog artist</option>
            {artistCandidates.map((candidate) => (
              <option key={candidate.optionId} value={candidate.optionId}>
                {candidate.name} · {candidate.releaseCount} release{candidate.releaseCount === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        {selectedArtistCandidate ? (
          <div className="shows-create__artist-context">
            {selectedArtistCandidate.artworkUrl ? (
              <span
                aria-hidden
                className="shows-create__artist-art"
                style={{ backgroundImage: `url(${selectedArtistCandidate.artworkUrl})` }}
              />
            ) : (
              <span aria-hidden>{artistDisplayName[0]?.toUpperCase() ?? "?"}</span>
            )}
            <p>
              {selectedArtistCandidate.latestReleaseTitle}
            </p>
          </div>
        ) : null}
        <label>
          Campaign title
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={draftTitle || "Artist in City"} />
        </label>
        <label>
          Pitch
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
        </label>
        <div className="shows-create__split">
          <label>
            City
            <input value={city} onChange={(event) => setCity(event.target.value)} />
          </label>
          <label>
            Country
            <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="FR" />
          </label>
        </div>
        <label>
          Venue target
          <input value={venueTarget} onChange={(event) => setVenueTarget(event.target.value)} />
        </label>
      </div>

      <div className="shows-create__panel shows-create__panel--wide">
        <div className="shows-create__panel-header">
          <h2>Campaign visuals</h2>
          <span className="shows-create__panel-note">JPEG, PNG, or WebP</span>
        </div>
        <div className="shows-create__visual-grid">
          <label className="shows-create__visual-upload">
            <span>Hero visual</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setHeroVisualFile(event.target.files?.[0] ?? null)}
            />
            <span
              className="shows-create__visual-preview shows-create__visual-preview--hero"
              style={heroPreviewUrl ? { backgroundImage: `url(${heroPreviewUrl})` } : undefined}
            >
              {!heroPreviewUrl ? "16:9 stage atmosphere" : null}
            </span>
          </label>
          <label className="shows-create__visual-upload">
            <span>Preview visual</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setCardVisualFile(event.target.files?.[0] ?? null)}
            />
            <span
              className="shows-create__visual-preview shows-create__visual-preview--card"
              style={cardPreviewUrl ? { backgroundImage: `url(${cardPreviewUrl})` } : undefined}
            >
              {!cardPreviewUrl ? "Card crop preview" : null}
            </span>
          </label>
        </div>
        <div className="shows-create__visual-upload shows-create__visual-upload--gallery">
          <div className="shows-create__gallery-toolbar">
            <span>Gallery visuals</span>
            <label className="shows-create__gallery-file-control">
              <span>Add images</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={galleryVisuals.length >= MAX_GALLERY_VISUALS}
                onChange={(event) => {
                  addGalleryFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="shows-create__visual-gallery">
            {galleryVisuals.length > 0 ? galleryVisuals.map((visual, index) => (
              <figure key={visual.id} className="shows-create__visual-gallery-card">
                <span
                  className="shows-create__visual-gallery-item"
                  style={{ backgroundImage: `url(${visual.url})` }}
                />
                <figcaption>
                  <span>{index + 1}</span>
                  <div className="shows-create__gallery-actions">
                    <button
                      type="button"
                      aria-label={`Move ${visual.label} earlier`}
                      disabled={index === 0}
                      onClick={() => moveGalleryVisual(index, -1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${visual.label} later`}
                      disabled={index === galleryVisuals.length - 1}
                      onClick={() => moveGalleryVisual(index, 1)}
                    >
                      Down
                    </button>
                    <label className="shows-create__gallery-file-control">
                      <span>Replace</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          replaceGalleryVisual(visual.id, event.target.files?.[0] ?? null);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <button type="button" onClick={() => removeGalleryVisual(visual.id)}>
                      Delete
                    </button>
                  </div>
                </figcaption>
              </figure>
            )) : (
              <span className="shows-create__visual-gallery-empty">Visual story set</span>
            )}
          </div>
        </div>
      </div>

      <div className="shows-create__panel">
        <h2>Escrow terms</h2>
        <div className="shows-create__split">
          <label>
            Goal ({PAYMENT_SYMBOL})
            <input value={goalAmount} onChange={(event) => setGoalAmount(event.target.value)} inputMode="decimal" />
          </label>
          <label>
            Minimum backers
            <input value={minimumBackers} onChange={(event) => setMinimumBackers(event.target.value)} inputMode="numeric" />
          </label>
        </div>
        <label>
          Funding deadline
          <input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
        <label>
          Booking deadline
          <input type="datetime-local" value={bookingDeadline} onChange={(event) => setBookingDeadline(event.target.value)} />
        </label>
        <label>
          Target show date
          <input type="datetime-local" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </label>
        <label>
          Payment token address {!isPrivileged ? "(configured by platform)" : ""}
          <input
            value={paymentTokenAddress}
            onChange={(event) => setPaymentTokenAddress(event.target.value)}
            placeholder={isPrivileged ? "0x..." : "Platform default"}
            readOnly={!isPrivileged}
          />
        </label>
        <small>Chain {chainId}. Asset defaults to {PAYMENT_SYMBOL} with {PAYMENT_DECIMALS} decimals.</small>
      </div>

      <div className="shows-create__panel">
        <h2>Authority</h2>
        <label>
          Beneficiary wallet {!isPrivileged ? "(from your payout profile)" : ""}
          <input
            value={beneficiaryAddress}
            onChange={(event) => setBeneficiaryAddress(event.target.value)}
            placeholder="0x..."
            readOnly={!isPrivileged}
          />
        </label>
        <label>
          Authority evidence bundle
          <input value={authorityEvidenceBundleId} onChange={(event) => setAuthorityEvidenceBundleId(event.target.value)} />
        </label>
        <p>
          This records the artist-provided beneficiary and evidence reference.
          An operator still needs to approve authority before activation.
        </p>
      </div>

      <div className="shows-create__panel shows-create__panel--wide">
        <div className="shows-create__panel-header">
          <h2>Pledge tiers</h2>
          <button type="button" onClick={() => setTiers((current) => [...current, { title: "", description: "", amount: "" }])}>
            Add tier
          </button>
        </div>
        <div className="shows-create__tiers">
          {tiers.map((tier, index) => (
            <div key={index} className="shows-create__tier">
              <label>
                Title
                <input value={tier.title} onChange={(event) => updateTier(index, { title: event.target.value })} />
              </label>
              <label>
                Amount ({PAYMENT_SYMBOL})
                <input value={tier.amount} onChange={(event) => updateTier(index, { amount: event.target.value })} inputMode="decimal" />
              </label>
              <label>
                Description
                <input value={tier.description} onChange={(event) => updateTier(index, { description: event.target.value })} />
              </label>
              {tiers.length > 1 ? (
                <button type="button" className="shows-create__remove-tier" onClick={() => removeTier(index)}>
                  Remove tier
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="shows-create__submit">
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" onClick={submit} disabled={!canSubmit || submitting}>
          {submitting ? "Saving draft..." : isEdit ? "Save draft" : "Create draft campaign"}
        </button>
      </div>
    </section>
  );
}
