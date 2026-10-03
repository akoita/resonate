/** Public aggregate-only contract for Scene Scout unmet demand (#1969). */
export const UNMET_DEMAND_SOURCE = Symbol("UNMET_DEMAND_SOURCE");

export type UnmetDemandStatus = "ready" | "thin_data" | "unavailable";
export type UnmetDemandWindowDays = 7 | 28;
export type UnmetDemandTargetType = "artist" | "genre" | "track";
export type UnmetDemandKind =
  | "stem"
  | "license"
  | "bpm"
  | "key"
  | "energy"
  | "mood"
  | "genre"
  | "price"
  | "verifiedHuman";

/** No requester, request, or session identifiers cross this boundary. */
export interface UnmetDemandRow {
  targetType: UnmetDemandTargetType;
  /** Present only when `targetType === "track"`, from the current Track row. */
  trackId?: string;
  /** Present only with a canonical track target, from its current Track row. */
  releaseId?: string;
  /** Present only with a canonical track target, from its current Track row. */
  trackTitle?: string;
  kind: UnmetDemandKind;
  /** A bounded enum, canonical catalog term, or fixed numeric bin. */
  value: string;
  windowDays: UnmetDemandWindowDays;
  distinctRequesters: number;
  /** Number of deduplicated crate-request/session sources. */
  requestCount: number;
  computedAt: Date;
}

export interface UnmetDemandResult {
  status: UnmetDemandStatus;
  reason?: string;
  demand: UnmetDemandRow[];
}

export interface UnmetDemandSource {
  getArtistUnmetDemand(
    artistId: string,
    options?: { now?: Date },
  ): Promise<UnmetDemandResult>;
}
