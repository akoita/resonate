export const STEM_MARKETPLACE_STATUS_EVENT = "resonate:stem-marketplace-status-updated";

export type StemMarketplaceStatus = "idle" | "minted" | "listed";

export interface StemMarketplaceStatusEventDetail {
  stemId: string;
  status: StemMarketplaceStatus;
  tokenId?: string | null;
  timestamp: number;
}

export function persistStemMarketplaceStatus(
  stemId: string,
  status: Exclude<StemMarketplaceStatus, "idle">,
  tokenId?: bigint | null,
) {
  if (typeof window === "undefined") return;

  const timestamp = Date.now();
  localStorage.setItem(
    `stem_status_${stemId}`,
    JSON.stringify({ status, timestamp }),
  );

  if (tokenId != null) {
    localStorage.setItem(`stem_token_id_${stemId}`, tokenId.toString());
  }

  window.dispatchEvent(
    new CustomEvent<StemMarketplaceStatusEventDetail>(STEM_MARKETPLACE_STATUS_EVENT, {
      detail: {
        stemId,
        status,
        tokenId: tokenId != null ? tokenId.toString() : null,
        timestamp,
      },
    }),
  );
}

export function clearStemMarketplaceStatus(stemId: string) {
  if (typeof window === "undefined") return;

  localStorage.removeItem(`stem_status_${stemId}`);
  localStorage.removeItem(`stem_token_id_${stemId}`);

  window.dispatchEvent(
    new CustomEvent<StemMarketplaceStatusEventDetail>(STEM_MARKETPLACE_STATUS_EVENT, {
      detail: {
        stemId,
        status: "idle",
        tokenId: null,
        timestamp: Date.now(),
      },
    }),
  );
}
