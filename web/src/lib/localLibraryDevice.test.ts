import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #2503 — local files are linked by handle, never copied into the browser, and
 * play only on the device that links them.
 */
const mocks = vi.hoisted(() => {
    const stores = new Map<string, Map<string, unknown>>();
    const store = (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return stores.get(name)!;
    };
    return {
        stores,
        store,
        listRemote: vi.fn(),
        saveRemote: vi.fn(),
    };
});

vi.mock("localforage", () => ({
    default: {
        createInstance: ({ storeName }: { storeName: string }) => {
            const data = () => mocks.store(storeName);
            return {
                getItem: async (key: string) => data().get(key) ?? null,
                setItem: async (key: string, value: unknown) => { data().set(key, value); return value; },
                removeItem: async (key: string) => { data().delete(key); },
                keys: async () => [...data().keys()],
                clear: async () => { data().clear(); },
                iterate: async (fn: (value: unknown, key: string) => void) => {
                    for (const [key, value] of data()) fn(value, key);
                },
            };
        },
    },
}));

vi.mock("./api", () => ({
    ApiRequestError: class ApiRequestError extends Error {},
    listLibraryTracksAPI: mocks.listRemote,
    saveLibraryTrackAPI: mocks.saveRemote,
    getLibraryTrackAPI: vi.fn(),
    getTrack: vi.fn(),
    getReleaseTrackStreamUrl: (releaseId: string, trackId: string) => `/stream/${releaseId}/${trackId}`,
    getReleaseArtworkUrl: (releaseId: string) => `/artwork/${releaseId}`,
    getStemPreviewUrl: (stemId: string) => `/preview/${stemId}`,
}));

import {
    attachFileHandle,
    listTracks,
    resolveTrackPlayback,
    saveTrack,
    type LocalTrack,
} from "./localLibrary";

function fileHandle(options: { permission?: PermissionState; getFile?: () => Promise<File> } = {}) {
    return {
        kind: "file",
        name: "song.mp3",
        queryPermission: vi.fn(async () => options.permission ?? "granted"),
        requestPermission: vi.fn(async () => options.permission ?? "granted"),
        getFile: options.getFile ?? (async () => ({ size: 10, lastModified: 1 }) as unknown as File),
    } as unknown as FileSystemFileHandle;
}

const apiRow = (overrides: Record<string, unknown>) => ({
    userId: "user-1",
    title: "Song",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
});

let objectUrlCount = 0;

beforeEach(() => {
    mocks.stores.clear();
    mocks.listRemote.mockReset();
    mocks.saveRemote.mockReset();
    objectUrlCount = 0;
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", { getItem: () => "session-token" });
    vi.stubGlobal("URL", Object.assign(URL, {
        createObjectURL: vi.fn(() => `blob:local-${++objectUrlCount}`),
        revokeObjectURL: vi.fn(),
    }));
});

describe("signed-in library on a device (#2504)", () => {
    it("marks a local track available only on the device that links its file", async () => {
        mocks.store("fileHandles").set("local-here", fileHandle());
        mocks.listRemote.mockResolvedValue([
            apiRow({ id: "local-here", source: "local" }),
            apiRow({ id: "local-elsewhere", source: "local" }),
            apiRow({ id: "remote-1", source: "remote", catalogTrackId: "trk_1" }),
        ]);

        const tracks = await listTracks();
        const byId = new Map(tracks.map((track) => [track.id, track]));

        expect(byId.get("local-here")?.available).toBe(true);
        expect(byId.get("local-elsewhere")?.available).toBe(false);
        expect(byId.get("remote-1")?.available).toBe(true);
    });

    it("still finds a legacy in-browser copy without loading the audio", async () => {
        mocks.store("tracks").set("legacy-1", { id: "legacy-1", source: "local", blobKey: "blob_legacy-1" });
        mocks.store("audioBlobs").set("blob_legacy-1", new Blob(["x"]));
        mocks.listRemote.mockResolvedValue([apiRow({ id: "legacy-1", source: "local" })]);

        const [track] = await listTracks();
        expect(track?.available).toBe(true);
        expect(track?.blobKey).toBe("blob_legacy-1");
    });
});

describe("saving a scanned file", () => {
    it("keeps a handle to the file, never a copy of the audio", async () => {
        mocks.saveRemote.mockImplementation(async (_token: string, track: { id: string }) => apiRow({ ...track }));
        const handle = fileHandle();

        const track = await saveTrack({ handle }, {
            title: "Song", artist: null, albumArtist: null, album: null, year: null, genre: null, duration: 180,
            sourcePath: "Music/song.mp3", fileSize: 10,
        });

        expect(mocks.store("fileHandles").get(track.id)).toBe(handle);
        expect(mocks.store("audioBlobs").size).toBe(0);
        expect(mocks.saveRemote.mock.calls[0]?.[1]).toMatchObject({ source: "local", sourcePath: "Music/song.mp3" });
        expect(track.available).toBe(true);
    });
});

describe("resolving playback", () => {
    const local = (overrides: Partial<LocalTrack> = {}): LocalTrack => ({
        id: "local-1", title: "Song", artist: null, albumArtist: null, album: null, year: null, genre: null,
        duration: null, createdAt: "2026-11-01T00:00:00.000Z", source: "local", ...overrides,
    });

    it("reads a linked file from disk", async () => {
        mocks.store("fileHandles").set("local-1", fileHandle());
        await expect(resolveTrackPlayback(local())).resolves.toEqual({ url: "blob:local-1", problem: null });
    });

    it("says the file is on another device when nothing links it here", async () => {
        await expect(resolveTrackPlayback(local())).resolves.toEqual({ url: null, problem: "other_device" });
    });

    it("asks for permission when the browser has not been allowed to read it", async () => {
        mocks.store("fileHandles").set("local-1", fileHandle({ permission: "denied" }));
        await expect(resolveTrackPlayback(local())).resolves.toEqual({ url: null, problem: "needs_permission" });
    });

    it("reports a moved or deleted file", async () => {
        const gone = Object.assign(new Error("gone"), { name: "NotFoundError" });
        mocks.store("fileHandles").set("local-1", fileHandle({ getFile: async () => { throw gone; } }));
        await expect(resolveTrackPlayback(local())).resolves.toEqual({ url: null, problem: "missing" });
    });

    it("never streams a catalog URL for a local row", async () => {
        const forged = local({ remoteUrl: "/catalog/releases/rel-1/tracks/trk-1/stream" });
        await expect(resolveTrackPlayback(forged)).resolves.toEqual({ url: null, problem: "other_device" });
    });

    it("streams catalog tracks from the platform", async () => {
        const remote = local({ id: "trk-1", source: "remote", remoteUrl: "/catalog/releases/rel-1/tracks/trk-1/stream" });
        await expect(resolveTrackPlayback(remote)).resolves.toMatchObject({ problem: null });
    });
});

describe("linking an existing row", () => {
    it("drops the legacy copy once the file on disk is linked", async () => {
        mocks.store("tracks").set("legacy-1", { id: "legacy-1", source: "local", blobKey: "blob_legacy-1" });
        mocks.store("audioBlobs").set("blob_legacy-1", new Blob(["x"]));
        const handle = fileHandle();

        await attachFileHandle({ id: "legacy-1", source: "local" } as LocalTrack, handle);

        expect(mocks.store("fileHandles").get("legacy-1")).toBe(handle);
        expect(mocks.store("audioBlobs").has("blob_legacy-1")).toBe(false);
        expect((mocks.store("tracks").get("legacy-1") as LocalTrack).blobKey).toBeUndefined();
    });

    it("never links a catalog row to a file", async () => {
        await attachFileHandle({ id: "trk-1", source: "remote" } as LocalTrack, fileHandle());
        expect(mocks.store("fileHandles").size).toBe(0);
    });
});
