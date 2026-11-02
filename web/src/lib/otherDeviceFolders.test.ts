import { describe, expect, it, vi } from "vitest";

vi.mock("./librarySettings", () => ({ addLibrarySourceHandle: vi.fn(), getLibrarySourceHandles: vi.fn() }));
vi.mock("./libraryScanner", () => ({ scanAndIndex: vi.fn() }));
vi.mock("./localLibrary", () => ({
    isOnOtherDevice: (t: { source?: string; available?: boolean }) => t.source === "local" && t.available === false,
}));

import { describeLinkResult, summarizeOtherDeviceFolders } from "./otherDeviceFolders";

describe("local files across devices", () => {
    it("groups the files this device cannot reach by their library folder", () => {
        const folders = summarizeOtherDeviceFolders([
            { source: "local", available: false, sourceFolder: "Caravelle" },
            { source: "local", available: false, sourceFolder: "Caravelle" },
            { source: "local", available: false, sourceFolder: "Demos" },
            { source: "local", available: false },
            { source: "local", available: true, sourceFolder: "Caravelle" },
            { source: "remote", available: false, sourceFolder: "ignored" },
        ]);
        expect(folders).toEqual([
            { name: "Caravelle", count: 2 },
            { name: "Demos", count: 1 },
            { name: null, count: 1 },
        ]);
    });

    it("has nothing to offer when every file plays here", () => {
        expect(summarizeOtherDeviceFolders([{ source: "local", available: true, sourceFolder: "Caravelle" }])).toEqual([]);
    });

    it("says how many files now play here, and what to do when none matched", () => {
        expect(describeLinkResult({ status: "scanned", folderName: "Music", linked: 18, added: 0, alreadyAdded: false }))
            .toBe("18 files from your other devices now play here.");
        expect(describeLinkResult({ status: "scanned", folderName: "Music", linked: 1, added: 2, alreadyAdded: false }))
            .toBe("1 file from your other devices now plays here. 2 new files added.");
        expect(describeLinkResult({ status: "scanned", folderName: "Music", linked: 0, added: 0, alreadyAdded: true }))
            .toContain("Nothing in “Music” matched");
    });
});
