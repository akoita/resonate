"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  createRemixProject,
  getRemixEligibility,
  listRemixProjects,
  type RemixEligibilityResponse,
  type RemixProject,
} from "../../lib/api";
import {
  recordProductAnalytics,
  type ProductAnalyticsPayload,
} from "../../lib/productAnalytics";

export type RemixCtaVariant = "button" | "chip";

export type RemixCtaState =
  | { kind: "hidden" }
  | { kind: "signed_out"; label: string; reason: string }
  | { kind: "remix"; label: string }
  | { kind: "license_required"; label: string; reason: string }
  | { kind: "blocked"; label: string; reason: string };

/**
 * Pure CTA state resolution so tests can cover every eligibility shape
 * without rendering. The CTA never infers rights client-side; it only
 * translates the eligibility API response into one of the product states.
 */
export function resolveRemixCtaState(input: {
  signedIn: boolean;
  loading: boolean;
  eligibility: RemixEligibilityResponse | null;
}): RemixCtaState {
  if (!input.signedIn) {
    return {
      kind: "signed_out",
      label: "Remix",
      reason: "Sign in to check remix availability for this track.",
    };
  }
  if (input.loading || !input.eligibility) {
    // Fail closed: no CTA while loading or when eligibility is unknown.
    return { kind: "hidden" };
  }
  if (input.eligibility.allowed) {
    return { kind: "remix", label: "Remix" };
  }
  if (input.eligibility.requiredLicense === "remix") {
    return {
      kind: "license_required",
      label: "Get remix license",
      reason:
        "A remix license unlocks Remix Studio for this track's stems.",
    };
  }
  const reason =
    input.eligibility.reasons[0]?.message ||
    "Remixing is not available for this source.";
  return { kind: "blocked", label: "Remix unavailable", reason };
}

/**
 * Compact funnel payload (#1143): ids and state codes only — no titles,
 * prompts, or free-text reasons, per the product-analytics allow-list
 * privacy constraints.
 */
export function buildRemixCtaAnalyticsPayload(input: {
  trackId: string;
  stemIds?: string[];
  stateKind: Exclude<RemixCtaState["kind"], "hidden">;
  variant: RemixCtaVariant;
  licensePathAvailable?: boolean;
}): ProductAnalyticsPayload {
  return {
    trackId: input.trackId,
    stemIds: input.stemIds ?? [],
    state: input.stateKind,
    variant: input.variant,
    ...(input.stateKind === "license_required"
      ? { licensePathAvailable: !!input.licensePathAvailable }
      : {}),
  };
}

/** Where a CTA click routes; recorded alongside remix.cta_clicked. */
export function remixCtaClickOutcome(
  stateKind: "remix" | "license_required" | "signed_out",
  hasLicensePath: boolean,
): "studio_opened" | "license_purchase" | "marketplace" | "login" {
  if (stateKind === "remix") return "studio_opened";
  if (stateKind === "license_required") {
    return hasLicensePath ? "license_purchase" : "marketplace";
  }
  return "login";
}

/**
 * Picks the most recent existing draft for the same source instead of
 * creating a duplicate. When the CTA is stem-scoped, the draft must cover
 * exactly the same stem set.
 */
export function findReusableDraft(
  projects: RemixProject[],
  trackId: string,
  stemIds?: string[],
): RemixProject | null {
  const requestedSet = stemIds?.length
    ? new Set(stemIds)
    : null;
  const candidates = projects
    .filter((project) => {
      if (project.status !== "draft") return false;
      if (project.sourceTrackId !== trackId) return false;
      if (!requestedSet) return true;
      const projectSet = new Set(project.stems.map((stem) => stem.stemId));
      if (projectSet.size !== requestedSet.size) return false;
      for (const stemId of requestedSet) {
        if (!projectSet.has(stemId)) return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  return candidates[0] ?? null;
}

const CHIP_BASE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 10px",
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 500,
  whiteSpace: "nowrap",
  fontFamily: "inherit",
};

export function RemixCta({
  trackId,
  stemIds,
  trackTitle,
  variant = "chip",
  initialEligibility,
  onGetLicense,
  licenseUnavailableReason,
  hideWhenLicenseRequired = false,
}: {
  trackId: string;
  stemIds?: string[];
  trackTitle?: string;
  variant?: RemixCtaVariant;
  /** Skips the eligibility fetch when the caller already holds the response. */
  initialEligibility?: RemixEligibilityResponse | null;
  /**
   * Where "Get remix license" should lead. Stem pages pass their buy-modal
   * opener when a remix-tier listing is purchasable in place; without a
   * handler the CTA falls back to browsing the marketplace.
   */
  onGetLicense?: () => void;
  /**
   * When a license is required but cannot be bought anywhere (e.g. the
   * seller lists no remix tier), the CTA stays visible but inert with this
   * reason instead of dead-ending into the marketplace.
   */
  licenseUnavailableReason?: string | null;
  /**
   * Hides the "Get remix license" state entirely when another control on
   * the page already sells the remix license (e.g. the stem page's primary
   * buy button). The CTA still renders its other states — most importantly
   * "Remix" once the license is owned.
   */
  hideWhenLicenseRequired?: boolean;
}) {
  const { token, login } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const stemIdsKey = useMemo(() => (stemIds ?? []).join(","), [stemIds]);
  const requestKey = `${trackId}|${stemIdsKey}`;

  // Loading is derived from whether the last resolved request matches the
  // current inputs, so the effect never has to set state synchronously.
  const [resolved, setResolved] = useState<{
    key: string;
    eligibility: RemixEligibilityResponse | null;
  } | null>(
    initialEligibility !== undefined
      ? { key: requestKey, eligibility: initialEligibility }
      : null,
  );
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (initialEligibility !== undefined) {
      // Nothing to fetch; the caller already resolved eligibility.
      return;
    }
    if (!token || !trackId) {
      // Nothing to fetch; the signed-out state is derived at render time.
      return;
    }
    let cancelled = false;
    const key = `${trackId}|${stemIdsKey}`;
    const requestedStemIds = stemIdsKey ? stemIdsKey.split(",") : undefined;
    getRemixEligibility(token, trackId, requestedStemIds)
      .then((data) => {
        if (!cancelled) setResolved({ key, eligibility: data });
      })
      .catch(() => {
        // Fail closed: an unresolved eligibility hides the CTA.
        if (!cancelled) setResolved({ key, eligibility: null });
      });
    return () => {
      cancelled = true;
    };
  }, [token, trackId, stemIdsKey, initialEligibility]);

  const eligibility =
    resolved?.key === requestKey ? resolved.eligibility : null;
  const loading = !!token && resolved?.key !== requestKey;

  const state = resolveRemixCtaState({
    signedIn: !!token,
    loading,
    eligibility,
  });

  // Funnel impression (#1143): once per resolved visible state per source.
  // Signed-out states cannot be recorded (the analytics endpoint is
  // authenticated), so impressions cover signed-in sessions only.
  const impressionKeyRef = useRef<string | null>(null);
  const stateKind = state.kind;
  useEffect(() => {
    if (!token || stateKind === "hidden") return;
    if (stateKind === "license_required" && hideWhenLicenseRequired) return;
    const key = `${requestKey}|${stateKind}`;
    if (impressionKeyRef.current === key) return;
    impressionKeyRef.current = key;
    void recordProductAnalytics(token, "remix.cta_impression", {
      source: "remix_cta",
      subjectType: "track",
      subjectId: trackId,
      payload: buildRemixCtaAnalyticsPayload({
        trackId,
        stemIds: stemIdsKey ? stemIdsKey.split(",") : [],
        stateKind,
        variant,
        licensePathAvailable: !!onGetLicense,
      }),
    });
  }, [
    token,
    stateKind,
    requestKey,
    trackId,
    stemIdsKey,
    variant,
    onGetLicense,
    hideWhenLicenseRequired,
  ]);

  if (state.kind === "hidden") {
    return null;
  }
  if (state.kind === "license_required" && hideWhenLicenseRequired) {
    // Another control on the page already sells this license; rendering a
    // second purchase entry would duplicate it.
    return null;
  }

  const handleRemix = async () => {
    if (!token || !eligibility?.allowed || creating) return;
    setCreating(true);
    try {
      const requestedStemIds = stemIdsKey ? stemIdsKey.split(",") : undefined;

      // Reuse the most recent matching draft instead of stacking duplicates.
      const existing = findReusableDraft(
        await listRemixProjects(token).catch(() => []),
        trackId,
        requestedStemIds,
      );
      if (existing) {
        router.push(`/remix/studio/${existing.id}`);
        return;
      }

      // Track-default eligibility can be a partial allowance: build the
      // project from licensed, remixable stems only.
      const projectStemIds =
        requestedStemIds ??
        eligibility.stems
          .filter((stem) => stem.licensed && stem.remixable !== false)
          .map((stem) => stem.stemId);
      const project = await createRemixProject(token, {
        sourceTrackId: trackId,
        stemIds: projectStemIds,
        title: trackTitle ? `${trackTitle} (Remix)` : "Untitled Remix",
      });
      router.push(`/remix/studio/${project.id}`);
    } catch {
      addToast({
        type: "error",
        title: "Could not open Remix Studio",
        message: "Creating the remix project failed. Please try again.",
      });
      setCreating(false);
    }
  };

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (
      state.kind === "remix" ||
      state.kind === "license_required" ||
      state.kind === "signed_out"
    ) {
      void recordProductAnalytics(token, "remix.cta_clicked", {
        source: "remix_cta",
        subjectType: "track",
        subjectId: trackId,
        payload: {
          ...buildRemixCtaAnalyticsPayload({
            trackId,
            stemIds: stemIdsKey ? stemIdsKey.split(",") : [],
            stateKind: state.kind,
            variant,
            licensePathAvailable: !!onGetLicense,
          }),
          outcome: remixCtaClickOutcome(state.kind, !!onGetLicense),
        },
      });
    }
    if (state.kind === "remix") {
      void handleRemix();
      return;
    }
    if (state.kind === "license_required") {
      if (onGetLicense) {
        onGetLicense();
        return;
      }
      router.push("/marketplace");
      return;
    }
    if (state.kind === "signed_out") {
      void login?.();
    }
  };

  // A required license that cannot be bought anywhere makes the CTA inert:
  // explaining beats navigating to a marketplace with nothing to offer.
  const licenseBlocked =
    state.kind === "license_required" && !onGetLicense && !!licenseUnavailableReason;
  const interactive =
    state.kind === "remix" ||
    state.kind === "signed_out" ||
    (state.kind === "license_required" && !licenseBlocked);
  // aria-disabled instead of disabled keeps blocked chips focusable so the
  // denial reason is reachable by keyboard and screen readers.
  const inert = !interactive || creating;
  const title =
    state.kind === "remix"
      ? "Create a private remix draft from this track's licensed stems."
      : licenseBlocked
        ? licenseUnavailableReason!
        : state.reason;
  const handleGuardedClick = (event: React.MouseEvent) => {
    if (inert) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handleClick(event);
  };

  if (variant === "button") {
    const buttonClass =
      state.kind === "remix" ? "ui-btn ui-btn-primary" : "ui-btn ui-btn-ghost";
    return (
      <button
        type="button"
        className={`${buttonClass} remix-cta remix-cta--${state.kind}`}
        onClick={handleGuardedClick}
        aria-disabled={inert || undefined}
        title={title}
      >
        {creating ? "Opening Remix Studio..." : state.label}
        {!interactive && <span className="sr-only"> — {title}</span>}
      </button>
    );
  }

  const chipStyle: React.CSSProperties =
    state.kind === "remix"
      ? {
          ...CHIP_BASE_STYLE,
          background: "#a855f720",
          color: "#c084fc",
          border: "1px solid rgba(168, 85, 247, 0.35)",
          cursor: "pointer",
        }
      : state.kind === "license_required"
        ? {
            ...CHIP_BASE_STYLE,
            background: "#eab30820",
            color: "#fbbf24",
            border: "1px solid rgba(234, 179, 8, 0.35)",
            cursor: "pointer",
          }
        : {
            ...CHIP_BASE_STYLE,
            background: "rgba(161, 161, 170, 0.12)",
            color: "#a1a1aa",
            border: "1px solid rgba(161, 161, 170, 0.25)",
            cursor: state.kind === "signed_out" ? "pointer" : "default",
          };

  return (
    <button
      type="button"
      className={`remix-cta remix-cta--${state.kind}`}
      style={chipStyle}
      onClick={handleGuardedClick}
      aria-disabled={inert || undefined}
      title={title}
    >
      {creating ? "Opening..." : state.label}
      {!interactive && (
        <span className="sr-only"> — {title}</span>
      )}
    </button>
  );
}
