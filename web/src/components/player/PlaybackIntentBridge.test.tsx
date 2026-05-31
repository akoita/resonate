import { describe, expect, it } from "vitest";
import type { PlaybackIntentCommand, Track } from "../../lib/api";
import {
  mapCatalogTrackToLocalTrack,
  selectPendingPlaybackCommand,
} from "./PlaybackIntentBridge";

const baseCommand: PlaybackIntentCommand = {
  commandId: "cmd-1",
  ownerUserId: "user-1",
  action: "play",
  status: "pending_confirmation",
  outcome: "confirmation_required",
  trackIds: ["track-1"],
  capabilityId: "cap-1",
  requiresConfirmation: true,
  initiator: "external_agent",
  agentOriginated: true,
  createdAt: "2026-05-31T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z",
};

const catalogTrack: Track = {
  id: "track-1",
  releaseId: "release-1",
  title: "Signal Bloom",
  position: 1,
  explicit: false,
  artist: "Ada Mix",
  createdAt: "2026-05-31T00:00:00.000Z",
  stems: [
    {
      id: "stem-original",
      trackId: "track-1",
      type: "ORIGINAL",
      uri: "https://storage.example/original.wav",
      isEncrypted: false,
      encryptionMetadata: null,
    },
    {
      id: "stem-vocals",
      trackId: "track-1",
      type: "Vocals",
      uri: "gs://private/vocals.wav",
      isEncrypted: true,
      encryptionMetadata: "secret-envelope",
    },
  ],
  release: {
    id: "release-1",
    artistId: "artist-1",
    title: "Signals",
    status: "published",
    type: "SINGLE",
    primaryArtist: "Ada Mix",
    genre: "Electronic",
    explicit: false,
    createdAt: "2026-05-31T00:00:00.000Z",
    artworkMimeType: "image/jpeg",
    artist: {
      id: "artist-1",
      displayName: "Ada Mix",
      userId: "artist-user-1",
    },
  },
};

describe("PlaybackIntentBridge helpers", () => {
  it("selects unconfirmed playback commands that need listener confirmation", () => {
    const processed = new Set<string>();

    expect(
      selectPendingPlaybackCommand(
        {
          ownerUserId: "user-1",
          commands: [
            { ...baseCommand, commandId: "old", confirmedAt: "2026-05-31T00:01:00.000Z" },
            baseCommand,
          ],
        },
        processed,
      )?.commandId,
    ).toBe("cmd-1");
  });

  it("ignores commands that were already processed locally", () => {
    const processed = new Set<string>(["cmd-1"]);

    expect(
      selectPendingPlaybackCommand({ ownerUserId: "user-1", commands: [baseCommand] }, processed),
    ).toBeNull();
  });

  it("maps catalog tracks into browser-playable player tracks", () => {
    const track = mapCatalogTrackToLocalTrack(catalogTrack);

    expect(track).toMatchObject({
      id: "track-1",
      title: "Signal Bloom",
      artist: "Ada Mix",
      album: "Signals",
      source: "remote",
      catalogTrackId: "track-1",
      artistId: "artist-1",
      releaseId: "release-1",
      remoteUrl: "http://localhost:3000/catalog/releases/release-1/tracks/track-1/stream",
      remoteArtworkUrl: "http://localhost:3000/catalog/releases/release-1/artwork",
    });
    expect(track.stems?.find((stem) => stem.type === "Vocals")).toMatchObject({
      uri: "http://localhost:3000/catalog/stems/stem-vocals/preview",
      isEncrypted: false,
      encryptionMetadata: null,
    });
  });
});
