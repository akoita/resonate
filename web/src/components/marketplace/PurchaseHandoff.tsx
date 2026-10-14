"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { launchRemixStudio } from "../remix/remixStudioLauncher";
import { isRemixReadyTier, PURCHASED_STEMS_HREF, type StemLicenseTier } from "../../lib/ownedStems";

/**
 * Which next steps a finished purchase offers (#2042). Pure so the rules are
 * testable without rendering:
 * - the library link shows when the purchase lands in Library › Stems (a
 *   wallet purchase always does; an x402 payment only when it settled through
 *   the marketplace);
 * - Remix Studio shows for a Remix or Commercial license on a known track.
 */
export function purchaseHandoffActions(input: {
  licenseType: StemLicenseTier | string | null | undefined;
  trackId?: string | null;
  inLibrary: boolean;
}): { library: boolean; remixStudio: boolean } {
  const tier = input.licenseType as StemLicenseTier | null | undefined;
  return {
    library: input.inLibrary,
    remixStudio: Boolean(input.trackId) && isRemixReadyTier(tier),
  };
}

/** Shown when Remix Studio refuses to open right after a purchase. */
export const PURCHASE_REMIX_SETTLING_NOTICE =
  "Your remix access is still being confirmed. Try again in a minute, or open it later from your library.";

/**
 * Next-step links under a successful purchase: "View in your library" and,
 * for remix-ready licenses, "Open in Remix Studio". Remix Studio opens only
 * after the eligibility check passes; a fresh purchase can take a moment to
 * register, so a refusal explains that instead of failing silently.
 */
export function PurchaseHandoff({
  licenseType,
  trackId,
  trackTitle,
  stemId,
  inLibrary,
}: {
  licenseType: StemLicenseTier | string | null | undefined;
  trackId?: string | null;
  trackTitle?: string | null;
  stemId?: string | null;
  inLibrary: boolean;
}) {
  const { token } = useAuth();
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const actions = purchaseHandoffActions({ licenseType, trackId, inLibrary });
  const canOpenStudio = actions.remixStudio && !!token;

  if (!actions.library && !canOpenStudio) return null;

  const openStudio = async () => {
    if (!token || !trackId || opening) return;
    setOpening(true);
    setNotice(null);
    try {
      const result = await launchRemixStudio({
        token,
        trackId,
        stemIds: stemId ? [stemId] : undefined,
        trackTitle: trackTitle ?? undefined,
      });
      if (result.kind === "opened") {
        router.push(result.path);
        return;
      }
      setNotice(PURCHASE_REMIX_SETTLING_NOTICE);
    } catch {
      setNotice("Could not open Remix Studio. Please try again.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="buy-modal__handoff">
      {actions.library && (
        <Link href={PURCHASED_STEMS_HREF}>View in your library →</Link>
      )}
      {canOpenStudio && (
        <button
          type="button"
          className="buy-modal__handoff-btn"
          onClick={() => void openStudio()}
          aria-disabled={opening || undefined}
        >
          {opening ? "Opening Remix Studio..." : "Open in Remix Studio →"}
        </button>
      )}
      {notice && (
        <div className="buy-modal__handoff-note" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
