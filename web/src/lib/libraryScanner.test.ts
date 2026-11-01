import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listTracks: vi.fn().mockResolvedValue([]),
    listLocalTrackOmissions: vi.fn().mockResolvedValue(["song.mp3:123"]),
    saveTrack: vi.fn(),
    attachFileHandle: vi.fn(),
    updateLocalTrack: vi.fn(),
    extractMetadata: vi.fn(),
}));

vi.mock("./localLibrary", () => mocks);
vi.mock("./metadataExtractor", () => ({ extractMetadata: mocks.extractMetadata }));

const NO_TAGS = {
    title: null, artist: null, albumArtist: null, album: null, year: null, genre: null,
    label: null, isrc: null, duration: 120, artworkBlob: null,
};

function file(name: string, size: number) {
    return { kind: "file", name, getFile: async () => ({ name, size }) };
}

function folder(name: string, entries: unknown[]) {
    return { kind: "directory", name, async *values() { yield* entries; } };
}

import { scanAndIndex } from "./libraryScanner";

describe("library folder scan", () => {
    it("does not reimport a file removed from the library", async () => {
        const directory = {
            async *values() {
                yield {
                    kind: "file",
                    name: "song.mp3",
                    getFile: async () => ({ name: "song.mp3", size: 123 }),
                };
            },
        } as unknown as FileSystemDirectoryHandle;

        await expect(scanAndIndex(directory)).resolves.toEqual({ added: 0, skipped: 1, total: 1 });
        expect(mocks.saveTrack).not.toHaveBeenCalled();
    });

    it("links an already-imported file on this device instead of importing it again", async () => {
        const existing = { id: "local-1", source: "local", title: "Song", sourcePath: "song.mp3", fileSize: 123, available: false };
        mocks.listTracks.mockResolvedValueOnce([existing]);
        mocks.listLocalTrackOmissions.mockResolvedValueOnce([]);
        const handle = { kind: "file", name: "song.mp3", getFile: async () => ({ name: "song.mp3", size: 123 }) };
        const directory = { async *values() { yield handle; } } as unknown as FileSystemDirectoryHandle;

        await expect(scanAndIndex(directory)).resolves.toEqual({ added: 0, skipped: 1, total: 1 });
        expect(mocks.attachFileHandle).toHaveBeenCalledWith(existing, handle);
        expect(mocks.saveTrack).not.toHaveBeenCalled();
    });

    it("does not skip a new file just because a catalog track shares its title", async () => {
        mocks.listTracks.mockResolvedValueOnce([{ id: "trk-1", source: "remote", title: "Intro" }]);
        mocks.listLocalTrackOmissions.mockResolvedValueOnce([]);
        mocks.saveTrack.mockResolvedValueOnce({ id: "local-2" });
        mocks.extractMetadata.mockResolvedValueOnce({ ...NO_TAGS, title: "Intro" });
        const handle = { kind: "file", name: "Intro.mp3", getFile: async () => ({ name: "Intro.mp3", size: 5 }) };
        const directory = { async *values() { yield handle; } } as unknown as FileSystemDirectoryHandle;

        const result = await scanAndIndex(directory);
        expect(result.added).toBe(1);
        expect(mocks.saveTrack.mock.calls.at(-1)?.[0]).toEqual({ handle });
    });

    it("names an untagged file from its file name and folders, and uses the folder cover", async () => {
        mocks.listTracks.mockResolvedValueOnce([]);
        mocks.listLocalTrackOmissions.mockResolvedValueOnce([]);
        mocks.extractMetadata.mockResolvedValueOnce({ ...NO_TAGS, title: "01-oceans" });
        mocks.saveTrack.mockResolvedValueOnce({ id: "local-3" });
        const cover = { size: 9 };
        const root = folder("Discs", [
            folder("Furax Barbarossa", [
                folder("Caravelle", [
                    file("01-oceans.mp3", 50),
                    { kind: "file", name: "Folder.jpg", getFile: async () => cover },
                    file("AlbumArtSmall.jpg", 2),
                ]),
            ]),
        ]) as unknown as FileSystemDirectoryHandle;

        await scanAndIndex(root);
        const [, metadata, artwork] = mocks.saveTrack.mock.calls.at(-1)!;
        expect(metadata).toMatchObject({
            title: "Oceans",
            album: "Caravelle",
            artist: "Furax Barbarossa",
            sourcePath: "Furax Barbarossa/Caravelle/01-oceans.mp3",
        });
        expect(artwork).toBe(cover);
    });

    it("keeps the tags a file has", async () => {
        mocks.listTracks.mockResolvedValueOnce([]);
        mocks.listLocalTrackOmissions.mockResolvedValueOnce([]);
        const embedded = { size: 3 };
        mocks.extractMetadata.mockResolvedValueOnce({
            ...NO_TAGS, title: "Gelati", artist: "Furax Barbarossa", album: "Caravelle", artworkBlob: embedded,
        });
        mocks.saveTrack.mockResolvedValueOnce({ id: "local-4" });
        const root = folder("Music", [file("03 Gelati.mp3", 70), file("cover.jpg", 4)]) as unknown as FileSystemDirectoryHandle;

        await scanAndIndex(root);
        const [, metadata, artwork] = mocks.saveTrack.mock.calls.at(-1)!;
        expect(metadata).toMatchObject({ title: "Gelati", artist: "Furax Barbarossa", album: "Caravelle" });
        expect(artwork).toBe(embedded);
    });

    it("does not import a file again when it is reached from another added folder", async () => {
        const existing = {
            id: "local-5", source: "local", title: "Gelati", artist: "Furax Barbarossa", album: "Caravelle",
            sourcePath: "Furax Barbarossa/Caravelle/03 Gelati.mp3", fileSize: 70, available: true, artworkKey: "art",
        };
        mocks.listTracks.mockResolvedValueOnce([existing]);
        mocks.listLocalTrackOmissions.mockResolvedValueOnce([]);
        mocks.saveTrack.mockClear();
        mocks.updateLocalTrack.mockClear();
        const root = folder("Caravelle", [file("03 Gelati.mp3", 70)]) as unknown as FileSystemDirectoryHandle;

        await expect(scanAndIndex(root)).resolves.toEqual({ added: 0, skipped: 1, total: 1 });
        expect(mocks.saveTrack).not.toHaveBeenCalled();
        expect(mocks.updateLocalTrack).not.toHaveBeenCalled();
    });

    it("imports a file found twice in one scan only once", async () => {
        mocks.listTracks.mockResolvedValueOnce([]);
        mocks.listLocalTrackOmissions.mockResolvedValueOnce([]);
        mocks.extractMetadata.mockResolvedValue(NO_TAGS);
        mocks.saveTrack.mockClear();
        mocks.saveTrack.mockResolvedValue({ id: "local-6" });
        const root = folder("Discs", [
            folder("Caravelle", [file("01.mp3", 10)]),
            folder("Copy", [file("01.mp3", 10)]),
        ]) as unknown as FileSystemDirectoryHandle;

        await expect(scanAndIndex(root)).resolves.toEqual({ added: 1, skipped: 1, total: 2 });
        expect(mocks.saveTrack).toHaveBeenCalledTimes(1);
    });

    it("repairs a file imported before folder fallbacks, without touching edited rows", async () => {
        const raw = {
            id: "local-7", source: "local", title: "02-the-lighthouse", artist: null, album: null,
            sourcePath: "Ocean/02-the-lighthouse.mp3", fileSize: 40, available: true, artworkKey: null,
        };
        const edited = {
            id: "local-8", source: "local", title: "My title", artist: null, album: null,
            sourcePath: "Ocean/03-x.mp3", fileSize: 41, available: true, artworkKey: "mine",
        };
        mocks.listTracks.mockResolvedValueOnce([raw, edited]);
        mocks.listLocalTrackOmissions.mockResolvedValueOnce([]);
        mocks.updateLocalTrack.mockClear();
        const cover = { size: 1 };
        const root = folder("Jennifer", [
            folder("Ocean", [
                file("02-the-lighthouse.mp3", 40),
                file("03-x.mp3", 41),
                { kind: "file", name: "cover.jpg", getFile: async () => cover },
            ]),
        ]) as unknown as FileSystemDirectoryHandle;

        await scanAndIndex(root);
        expect(mocks.updateLocalTrack).toHaveBeenCalledTimes(1);
        expect(mocks.updateLocalTrack).toHaveBeenCalledWith(
            raw,
            { title: "The lighthouse", album: "Ocean", artist: "Jennifer" },
            cover,
        );
    });
});
