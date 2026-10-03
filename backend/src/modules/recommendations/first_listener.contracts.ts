import type { Prisma } from "@prisma/client";

export const FIRST_LISTENER_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
export const FIRST_LISTENER_MAX_RELEASE_PLACEMENTS = 1_000;
export const FIRST_LISTENER_CANDIDATE_LIMIT = 100;

export const FIRST_LISTENER_PUBLIC_RIGHTS_ROUTES = [
  "LIMITED_MONITORING",
  "STANDARD_ESCROW",
  "TRUSTED_FAST_PATH",
] as const;

export const FIRST_LISTENER_PLAYABLE_TRACK_WHERE = {
  processingStatus: "complete",
  contentStatus: "clean",
  aiDisclosureLevel: { not: "ALL" },
  OR: [
    { rightsRoute: null },
    { rightsRoute: { in: [...FIRST_LISTENER_PUBLIC_RIGHTS_ROUTES] } },
  ],
} satisfies Prisma.TrackWhereInput;

export const FIRST_LISTENER_CANDIDATE_TRACK_SELECT = {
  id: true,
  title: true,
  artist: true,
  releaseId: true,
  explicit: true,
  createdAt: true,
  aiDisclosureLevel: true,
} satisfies Prisma.TrackSelect;

type FirstListenerCandidateTrackScalars = Prisma.TrackGetPayload<{
  select: typeof FIRST_LISTENER_CANDIDATE_TRACK_SELECT;
}>;

export type FirstListenerCandidateTrack = FirstListenerCandidateTrackScalars & {
  release: {
    id: string;
    title: string;
    genre: string | null;
    moods: string[];
    artistId: string;
    primaryArtist: string | null;
    artist: { id: string; displayName: string };
  };
};

export interface FirstListenerExposureCandidate {
  trackId: string;
  releaseId: string;
}

export interface FirstListenerReceptionRelease {
  releaseId: string;
  title: string;
  createdAt: Date;
  /** Unique consent-qualified listeners who actually started or completed a play. */
  heard: number | null;
  /** Unique heard listeners whose completion ratio reached 0.9. */
  fullPlays: number | null;
  /** Unique heard listeners who saved a track from the release. */
  saves: number | null;
}

export interface FirstListenerArtistReception {
  minimumAudience: number;
  releases: FirstListenerReceptionRelease[];
  /** False when a bounded read failed or was exceeded. */
  available: boolean;
}
