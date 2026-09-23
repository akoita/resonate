import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const tracks = new Map<string, unknown>();
    const omissions = new Map<string, unknown>();
    const deleteOne = vi.fn();
    const deleteMany = vi.fn();
    const listRemote = vi.fn();
    return { tracks, omissions, deleteOne, deleteMany, listRemote };
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
}));

import { ApiRequestError } from "./api";
import { deleteTrack, deleteTracks, listLocalTrackOmissions } from "./localLibrary";

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
