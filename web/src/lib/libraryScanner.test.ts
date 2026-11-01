import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listTracks: vi.fn().mockResolvedValue([]),
    listLocalTrackOmissions: vi.fn().mockResolvedValue(["song.mp3:123"]),
    saveTrack: vi.fn(),
    attachFileHandle: vi.fn(),
}));

vi.mock("./localLibrary", () => mocks);

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
        const handle = { kind: "file", name: "Intro.mp3", getFile: async () => ({ name: "Intro.mp3", size: 5 }) };
        const directory = { async *values() { yield handle; } } as unknown as FileSystemDirectoryHandle;

        const result = await scanAndIndex(directory);
        expect(result.added).toBe(1);
        expect(mocks.saveTrack.mock.calls.at(-1)?.[0]).toEqual({ handle });
    });
});
