"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import {
  getArtistMe,
  listArtistReleases,
  listPublishedReleases,
  type ArtistProfile,
} from "../../lib/api";
import {
  createShowCampaignDraft,
  buildCatalogArtistCandidates,
  updateShowCampaignDraft,
  type Campaign,
  type CatalogArtistCandidate,
  type ShowCampaignDraftTierInput,
} from "../../lib/shows";

type TierForm = {
  title: string;
  description: string;
  amount: string;
};

const PAYMENT_DECIMALS = 6;
const PAYMENT_SYMBOL = "USDC";
const PUBLIC_CATALOG_STATUSES = new Set(["ready", "published"]);

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(campaign);
  const isPrivileged = role === "admin" || role === "operator";
  const selectedArtistCandidate = artistCandidates.find((candidate) => candidate.optionId === selectedArtistId);
  const canSubmit = status === "authenticated"
    && Boolean(token)
    && (isPrivileged ? Boolean(selectedArtistCandidate) : artistLoaded && artistHasCatalogContent === true);
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
          setArtistDisplayName(profile.displayName || "");
          setBeneficiaryAddress(profile.payoutAddress || "");
          setPaymentTokenAddress("");
          const releases = await listArtistReleases(profile.id, token).catch(() => []);
          if (active) {
            setArtistHasCatalogContent(
              releases.some((release) => PUBLIC_CATALOG_STATUSES.has(release.status)),
            );
          }
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
    if (!isPrivileged || status !== "authenticated") {
      setArtistCandidates([]);
      setArtistCandidatesLoaded(false);
      return;
    }

    let active = true;
    listPublishedReleases(100)
      .then((releases) => {
        if (!active) return;
        const candidates = buildCatalogArtistCandidates(releases);
        setArtistCandidates(candidates);
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
        if (active) setArtistCandidates([]);
      })
      .finally(() => {
        if (active) setArtistCandidatesLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [campaign?.artistName, isPrivileged, status]);

  useEffect(() => {
    if (!isPrivileged || !selectedArtistId) return;
    const selected = artistCandidates.find((candidate) => candidate.optionId === selectedArtistId);
    if (selected) setArtistDisplayName(selected.name);
  }, [artistCandidates, isPrivileged, selectedArtistId]);

  function updateTier(index: number, patch: Partial<TierForm>) {
    setTiers((current) => current.map((tier, tierIndex) => (
      tierIndex === index ? { ...tier, ...patch } : tier
    )));
  }

  function removeTier(index: number) {
    setTiers((current) => current.filter((_, tierIndex) => tierIndex !== index));
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

      const draft = {
        artistId: isPrivileged ? selectedArtistCandidate?.artistId ?? null : artist?.id ?? null,
        artistDisplayName: (isPrivileged ? selectedArtistCandidate?.name ?? artistDisplayName : artist?.displayName ?? artistDisplayName).trim(),
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

      const saved = campaign
        ? await updateShowCampaignDraft({ campaign, token, draft })
        : await createShowCampaignDraft({ token, draft });
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
          Artist {!isPrivileged ? "(from your artist profile)" : ""}
          {isPrivileged ? (
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
          ) : (
            <input
              value={artistDisplayName}
              onChange={(event) => setArtistDisplayName(event.target.value)}
              readOnly
            />
          )}
        </label>
        {isPrivileged && selectedArtistCandidate ? (
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
