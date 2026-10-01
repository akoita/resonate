/**
 * Seam between the agent quality dashboard and the discovery journal (#1455).
 * The dashboard only needs aggregate counts, so it depends on this interface
 * rather than on the journal service (and its Prisma client) directly.
 */
export const RESONANT_DISCOVERY_SOURCE = "RESONANT_DISCOVERY_SOURCE";

export interface ResonantDiscoveryCounts {
  total: number;
  distinctNewArtists: number;
  activeListeners: number;
  truncated: boolean;
}

export interface ResonantDiscoverySource {
  getResonantDiscoveryAggregate(options: {
    windowDays: number;
    now?: Date;
  }): Promise<ResonantDiscoveryCounts>;
}
