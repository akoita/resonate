const STEM_TYPES = new Set(["vocals", "drums", "bass", "piano", "guitar", "other"]);
const LICENSE_TYPES = new Set(["personal", "remix", "commercial", "sync", "sample", "broadcast"]);

export type StemDemandContext = { trackId: string; stemType?: string; licenseType?: string };

/** Advisory context only. Catalog ownership and listing permissions still apply. */
export function stemDemandContext(params: Pick<URLSearchParams, "getAll">): StemDemandContext | undefined {
  const tracks = params.getAll("demandTrack");
  const stems = params.getAll("demandStem");
  const licenses = params.getAll("demandLicense");
  if (tracks.length !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(tracks[0]) ||
    stems.length > 1 || licenses.length > 1 || (stems.length === 1) === (licenses.length === 1)) return;
  if (stems.length && !STEM_TYPES.has(stems[0])) return;
  if (licenses.length && !LICENSE_TYPES.has(licenses[0])) return;
  return { trackId: tracks[0], ...(stems.length ? { stemType: stems[0] } : { licenseType: licenses[0] }) };
}

export function ownedDemandTrack<T extends { id: string }>(
  context: StemDemandContext | undefined, tracks: T[] | undefined, isOwner: boolean,
): T | undefined {
  return isOwner && context ? tracks?.find((track) => track.id === context.trackId) : undefined;
}
