"use client";

import { useCallback } from "react";
import { ActionShare } from "../share/ActionShare";
import {
  licenseShareAnalytics,
  licenseShareMessage,
  licenseShareUrl,
  type ShareChannel,
} from "../../lib/fanActionShare";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";

/** What a finished purchase lets the share say (#1915). Never a price or wallet. */
export type LicenseShareSubject = {
  tokenId: string;
  listingId?: string;
  /** The stem's creator made the sale: the only case the 85% claim is made. */
  artistSale: boolean;
};

/**
 * Tailored share offered on the purchase success view (#1915): "I licensed
 * the vocals stem of …", linking the public stem page with
 * utm_campaign=license_share.
 */
export function LicenseShare({
  subject,
  licenseType,
  stemType,
  trackTitle,
  artistName,
}: {
  subject: LicenseShareSubject;
  licenseType: string;
  stemType?: string | null;
  trackTitle?: string | null;
  artistName?: string | null;
}) {
  const { tokenId, listingId, artistSale } = subject;
  const shareUrl = useCallback(
    (origin: string, channel: ShareChannel) => licenseShareUrl(origin, tokenId, channel),
    [tokenId],
  );
  const message = useCallback(
    (channel: ShareChannel) =>
      licenseShareMessage({ stemType, trackTitle, artistName, licenseType, artistSale }, channel),
    [artistName, artistSale, licenseType, stemType, trackTitle],
  );
  const onShared = useCallback(
    (channel: ShareChannel) =>
      recordProductAnalyticsFromBrowser(
        "marketplace.license_shared",
        licenseShareAnalytics({ tokenId, listingId }, channel),
      ),
    [listingId, tokenId],
  );
  return (
    <ActionShare
      kind="license"
      label="Share what you licensed"
      shareUrl={shareUrl}
      message={message}
      onShared={onShared}
    />
  );
}

export default LicenseShare;
