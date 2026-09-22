"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiRequestError, submitArtistClaim, type ArtistClaim } from "../../lib/api";
import { useToast } from "../ui/Toast";
import { Button } from "../ui/Button";

export const CLAIM_EVIDENCE_MIN = 20;
export const CLAIM_EVIDENCE_MAX = 4000;

type ArtistClaimCalloutProps = {
  artistId: string;
  artistName: string;
  token: string | null | undefined;
  /** The viewer's latest claim, already filtered to this artist. */
  claim: ArtistClaim | null;
  onSignIn: () => void;
  onSubmitted: (claim: ArtistClaim) => void;
};

function apiErrorText(error: ApiRequestError): string {
  const parts: string[] = [error.message];
  const details = error.details;
  if (details && typeof details === "object" && "message" in details) {
    const message = (details as { message?: unknown }).message;
    if (typeof message === "string") parts.push(message);
    if (Array.isArray(message)) parts.push(message.filter((m) => typeof m === "string").join(" "));
  }
  return parts.join(" ").toLowerCase();
}

/** Maps a claim-submission failure to plain-language copy for the claimant. */
export function claimSubmitErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.status) {
      case 409:
        return apiErrorText(error).includes("pending")
          ? "You already have a claim under review for this profile."
          : "This profile can't be claimed right now. It may already be claimed, or it has no confirmed releases yet.";
      case 400:
        return "Evidence must be between 20 and 4,000 characters.";
      case 401:
        return "Your session expired. Sign in again, then resubmit.";
      case 404:
        return "This artist profile no longer exists.";
      case 429:
        return "Too many attempts. Wait a few minutes and try again.";
      default:
        break;
    }
  }
  return "We couldn't submit your claim. Check your connection and try again.";
}

function formatClaimDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Compact, collapsed-by-default "Are you {artist}?" callout shown on an
 * unclaimed public artist page (#1492). Sits below the listener actions so it
 * never pushes Play all down for ordinary visitors.
 */
export function ArtistClaimCallout({
  artistId,
  artistName,
  token,
  claim,
  onSignIn,
  onSubmitted,
}: ArtistClaimCalloutProps) {
  const { addToast } = useToast();
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const evidenceId = `${baseId}-evidence`;
  const helpId = `${baseId}-help`;
  const counterId = `${baseId}-counter`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (expanded) textareaRef.current?.focus();
  }, [expanded]);

  if (claim?.status === "pending") {
    const submittedOn = formatClaimDate(claim.createdAt);
    return (
      <section className="artist-claim artist-claim--pending" aria-labelledby={headingId}>
        <div className="artist-claim__header">
          <h2 id={headingId} className="artist-claim__title">Your claim for {artistName}</h2>
          <span className="artist-claim__status">Pending review</span>
        </div>
        <p className="artist-claim__text">
          We received your claim{submittedOn ? ` on ${submittedOn}` : ""}. An operator will review your
          evidence — nothing on this page changes until it&apos;s approved.
        </p>
      </section>
    );
  }

  const retry = claim?.status === "rejected" || claim?.status === "revoked";
  const trimmedLength = evidence.trim().length;
  const tooShort = trimmedLength < CLAIM_EVIDENCE_MIN;

  const collapse = () => {
    setExpanded(false);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || busy || tooShort) return;
    setBusy(true);
    setError(null);
    try {
      const request = await submitArtistClaim(token, artistId, evidence);
      onSubmitted(request);
      setEvidence("");
      setExpanded(false);
      addToast({
        type: "success",
        title: "Claim submitted",
        message: "An operator will review your evidence. Nothing on this page changes until it's approved.",
      });
    } catch (err) {
      setError(claimSubmitErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="artist-claim" aria-labelledby={headingId}>
      <div className="artist-claim__header">
        <h2 id={headingId} className="artist-claim__title">Are you {artistName}?</h2>
      </div>
      <p className="artist-claim__text">
        This profile was created from release credits and hasn&apos;t been claimed yet.
      </p>
      {claim?.status === "rejected" ? (
        <p className="artist-claim__text artist-claim__text--notice">
          Your previous claim wasn&apos;t approved. You can submit new evidence.
        </p>
      ) : null}
      {claim?.status === "revoked" ? (
        <p className="artist-claim__text artist-claim__text--notice">
          Your earlier access to this profile was revoked. You can submit new evidence.
        </p>
      ) : null}

      {!token ? (
        <div className="artist-claim__actions">
          <Button type="button" variant="ghost" className="artist-claim__cta" onClick={onSignIn}>
            Sign in to claim
          </Button>
        </div>
      ) : !expanded ? (
        <div className="artist-claim__actions">
          <Button
            type="button"
            variant="ghost"
            className="artist-claim__cta"
            aria-expanded={false}
            onClick={() => setExpanded(true)}
          >
            {retry ? "Submit new evidence" : "Claim this profile"}
          </Button>
        </div>
      ) : (
        <form className="artist-claim__form" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor={evidenceId} className="artist-claim__label">
            Evidence for review
          </label>
          <p id={helpId} className="artist-claim__help">
            Show that you represent {artistName} — for example a distributor or label reference, a
            rights document, or an official account that links here.
          </p>
          <textarea
            ref={textareaRef}
            id={evidenceId}
            className="ui-input artist-claim__textarea"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            aria-describedby={`${helpId} ${counterId}`}
            maxLength={CLAIM_EVIDENCE_MAX}
            rows={4}
            disabled={busy}
          />
          <p
            id={counterId}
            className={`artist-claim__counter${tooShort ? " artist-claim__counter--short" : ""}`}
            aria-live="polite"
          >
            {tooShort
              ? `${CLAIM_EVIDENCE_MIN - trimmedLength} more characters needed`
              : `${trimmedLength.toLocaleString("en-US")} / 4,000`}
          </p>
          <p className="artist-claim__scope">
            Approval lets you edit this public page. It doesn&apos;t transfer releases, rights,
            payouts, or private analytics.
          </p>
          {error ? (
            <p className="artist-claim__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="artist-claim__actions">
            <Button type="submit" disabled={busy || tooShort}>
              {busy ? "Submitting…" : "Submit for review"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={collapse}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
