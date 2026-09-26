import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const tracks = new Map<string, unknown>();
    const omissions = new Map<string, unknown>();
    const deleteOne = vi.fn();
    const deleteMany = vi.fn();
    const listRemote = vi.fn();
    const getLibraryTrack = vi.fn();
    const getCatalogTrack = vi.fn();
    return { tracks, omissions, deleteOne, deleteMany, listRemote, getLibraryTrack, getCatalogTrack };
});

vi.mock("localforage", () => ({
    default: {
        createInstance: ({ storeName }: { storeName: string }) => ({
            getItem: async (key: string) => storeName === "tracks" ? mocks.tracks.get(key) ?? null : mocks.omissions.get(key) ?? null,
            setItem: async (key: string, value: unknown) => { if (storeName === "libraryOmissions") mocks.omissions.set(key, value); },
            keys: async () => storeName === "libraryOmissions" ? [...mocks.omissions.keys()] : [],
            removeItem: async (key: string) => { if (storeName === "tracks") mocks.tracks.delete(key); },
        }),
    },
}));

vi.mock("./api", () => ({
    ApiRequestError: class ApiRequestError extends Error {
        constructor(message: string, readonly status: number) { super(message); }
    },
    deleteLibraryTrackAPI: mocks.deleteOne,
    deleteLibraryTracksAPI: mocks.deleteMany,
    listLibraryTracksAPI: mocks.listRemote,
    getLibraryTrackAPI: mocks.getLibraryTrack,
    getTrack: mocks.getCatalogTrack,
    getReleaseTrackStreamUrl: (releaseId: string, trackId: string) => `/stream/${releaseId}/${trackId}`,
    getReleaseArtworkUrl: (releaseId: string) => `/artwork/${releaseId}`,
    getStemPreviewUrl: (stemId: string) => `/preview/${stemId}`,
}));

import { ApiRequestError } from "./api";
import { deleteTrack, deleteTracks, getTrack, listLocalTrackOmissions } from "./localLibrary";

describe("library removal", () => {
    beforeEach(() => {
        mocks.tracks.clear();
        mocks.omissions.clear();
        mocks.deleteOne.mockReset();
        mocks.deleteMany.mockReset();
        mocks.listRemote.mockReset();
        vi.stubGlobal("window", {});
        vi.stubGlobal("localStorage", { getItem: () => "session-token" });
    });

    it("keeps a track cached when its server delete fails", async () => {
        mocks.tracks.set("track-1", { id: "track-1" });
        mocks.deleteOne.mockRejectedValue(new Error("Server unavailable"));

        await expect(deleteTrack("track-1")).rejects.toThrow("Server unavailable");
        expect(mocks.tracks.has("track-1")).toBe(true);
    });

    it("removes a group only after its batch request succeeds", async () => {
        mocks.tracks.set("track-1", { id: "track-1" });
        mocks.tracks.set("track-2", { id: "track-2" });
        mocks.deleteMany.mockRejectedValueOnce(new Error("Server unavailable"));

        await expect(deleteTracks(["track-1", "track-2"])).rejects.toThrow("Server unavailable");
        expect([...mocks.tracks.keys()]).toEqual(["track-1", "track-2"]);

        mocks.deleteMany.mockResolvedValueOnce({ count: 2 });
        await deleteTracks(["track-1", "track-2", "track-1"]);
        expect(mocks.deleteMany).toHaveBeenLastCalledWith(["track-1", "track-2"], "session-token");
        expect(mocks.tracks.size).toBe(0);
    });

    it("records a removed scanned file so the next folder scan skips it", async () => {
        mocks.tracks.set("local-1", { id: "local-1", source: "local", sourcePath: "Music/song.mp3", fileSize: 123 });
        mocks.deleteOne.mockResolvedValue({ id: "local-1" });

        await deleteTrack("local-1");

        expect(await listLocalTrackOmissions()).toEqual(["Music/song.mp3:123"]);
        expect(mocks.tracks.has("local-1")).toBe(false);
    });

    it("removes a local file when the server never had its metadata", async () => {
        mocks.tracks.set("local-unsynced", { id: "local-unsynced", source: "local", sourcePath: "Music/offline.mp3", fileSize: 321 });
        mocks.deleteOne.mockRejectedValue(new ApiRequestError("Not found", 404, null));

        await deleteTrack("local-unsynced");

        expect(mocks.tracks.has("local-unsynced")).toBe(false);
        expect(await listLocalTrackOmissions()).toEqual(["Music/offline.mp3:321"]);
    });

    it("does not report a partial server batch as complete while a requested row remains", async () => {
        mocks.tracks.set("track-1", { id: "track-1" });
        mocks.tracks.set("track-2", { id: "track-2" });
        mocks.deleteMany.mockResolvedValue({ count: 1 });
        mocks.listRemote.mockResolvedValue([{ id: "track-2" }]);

        await expect(deleteTracks(["track-1", "track-2"])).rejects.toThrow("Some library tracks could not be removed");
        expect(mocks.tracks.has("track-2")).toBe(true);
    });
});

describe("getTrack catalog fallback", () => {
    const catalogTrack = {
        id: "trk-1",
        releaseId: "rel-1",
        title: "Signal One",
        position: 1,
        explicit: false,
        artist: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        aiDisclosure: null,
        stems: [
            { id: "stem-o", trackId: "trk-1", type: "ORIGINAL", uri: "gs://o", durationSeconds: 201, isEncrypted: true },
            { id: "stem-v", trackId: "trk-1", type: "vocals", uri: "gs://v", durationSeconds: 201, isEncrypted: true },
        ],
        release: {
            id: "rel-1",
            artistId: "artist-1",
            title: "Signals",
            status: "published",
            type: "single",
            primaryArtist: "Ada Mix",
            genre: "electronic",
            releaseDate: "2025-05-01T00:00:00.000Z",
            explicit: false,
            createdAt: "2025-05-01T00:00:00.000Z",
            artworkMimeType: "image/png",
        },
    };

    beforeEach(() => {
        mocks.tracks.clear();
        mocks.getLibraryTrack.mockReset();
        mocks.getCatalogTrack.mockReset();
        vi.stubGlobal("window", {});
    });

    it("resolves a playlist track outside the library into a playable remote track", async () => {
        vi.stubGlobal("localStorage", { getItem: () => "session-token" });
        mocks.getLibraryTrack.mockRejectedValue(new Error("Not found"));
        mocks.getCatalogTrack.mockResolvedValue(catalogTrack);

        const track = await getTrack("trk-1");

        expect(mocks.getCatalogTrack).toHaveBeenCalledWith("trk-1", "session-token");
        expect(track).toMatchObject({
            id: "trk-1",
            source: "remote",
            catalogTrackId: "trk-1",
            releaseId: "rel-1",
            artistId: "artist-1",
            artist: "Ada Mix",
            album: "Signals",
            genre: "electronic",
            year: 2025,
            duration: 201,
            remoteUrl: "/stream/rel-1/trk-1",
            remoteArtworkUrl: "/artwork/rel-1",
        });
        expect(track?.stems?.find((stem) => stem.id === "stem-v")).toMatchObject({
            uri: "/preview/stem-v",
            isEncrypted: false,
        });
    });

    it("tries the public catalog even when signed out", async () => {
        vi.stubGlobal("localStorage", { getItem: () => null });
        mocks.getCatalogTrack.mockResolvedValue(catalogTrack);

        const track = await getTrack("trk-1");

        expect(mocks.getLibraryTrack).not.toHaveBeenCalled();
        expect(mocks.getCatalogTrack).toHaveBeenCalledWith("trk-1", null);
        expect(track?.remoteUrl).toBe("/stream/rel-1/trk-1");
    });

    it("returns null when the track exists nowhere", async () => {
        vi.stubGlobal("localStorage", { getItem: () => null });
        mocks.getCatalogTrack.mockRejectedValue(new Error("Not found"));

        expect(await getTrack("missing")).toBeNull();
    });
});
