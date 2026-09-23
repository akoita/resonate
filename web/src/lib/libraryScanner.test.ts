import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listTracks: vi.fn().mockResolvedValue([]),
    listLocalTrackOmissions: vi.fn().mockResolvedValue(["song.mp3:123"]),
    saveTrack: vi.fn(),
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
});
