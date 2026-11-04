import { BadRequestException } from "@nestjs/common";
import { cleanFolderName, isFolderRelativePath, validateLibraryTrackInput } from "../modules/library/library.service";

describe("library folder names (local files across devices)", () => {
    it("keeps a folder name and drops any path in front of it", () => {
        expect(cleanFolderName("Caravelle")).toBe("Caravelle");
        expect(cleanFolderName("C:\\Users\\me\\Music\\Caravelle")).toBe("Caravelle");
        expect(cleanFolderName("/home/me/Music/Caravelle/")).toBe("Caravelle");
    });

    it("treats a missing value as 'leave it alone' and an empty one as cleared", () => {
        expect(cleanFolderName(undefined)).toBeUndefined();
        expect(cleanFolderName(null)).toBeNull();
        expect(cleanFolderName("  ")).toBeNull();
    });

    it("never lets a catalog row carry a folder", () => {
        expect(() =>
            validateLibraryTrackInput({ source: "remote", title: "x", catalogTrackId: "t1", sourceFolder: "Music" }),
        ).toThrow(BadRequestException);
    });
});

describe("library tags for your own files", () => {
    it("never lets a catalog row carry a track number or credits", () => {
        for (const field of ["trackNumber", "discNumber", "label", "copyright", "isrc", "composer", "producer"]) {
            expect(() =>
                validateLibraryTrackInput({ source: "remote", title: "x", catalogTrackId: "t1", [field]: field.endsWith("Number") ? 2 : "v" }),
            ).toThrow(BadRequestException);
        }
    });

    it("accepts them on a local file", () => {
        expect(validateLibraryTrackInput({
            source: "local", id: "local_1", title: "Uragano", trackNumber: 2, discNumber: 1, label: "L", isrc: "FR1",
        })).toEqual({ source: "local", clientKey: "local_1" });
    });
});

describe("local file paths never include the folders above the added folder (#2507)", () => {
    it("accepts a path from the added folder down", () => {
        expect(isFolderRelativePath("Caravelle/01 Intro.wav")).toBe(true);
        expect(isFolderRelativePath("01 Intro.wav")).toBe(true);
        expect(isFolderRelativePath("Disc 1\\02 Song.flac")).toBe(true);
        expect(isFolderRelativePath("..hidden/a.mp3")).toBe(true);
    });

    it("rejects full paths, home paths, URLs and parent segments", () => {
        for (const path of [
            "/home/me/Music/a.mp3",
            "C:\\Users\\me\\Music\\a.mp3",
            "c:/Users/me/a.mp3",
            "\\\\server\\share\\a.mp3",
            "~/Music/a.mp3",
            "file:///Users/me/a.mp3",
            "Music/../../etc/a.mp3",
            "",
        ]) {
            expect(isFolderRelativePath(path)).toBe(false);
        }
    });

    it("refuses to save a local row with a full path", () => {
        expect(() =>
            validateLibraryTrackInput({ source: "local", id: "local_1", title: "x", sourcePath: "C:\\Users\\me\\a.mp3", fileSize: 1 }),
        ).toThrow(BadRequestException);
        expect(validateLibraryTrackInput({ source: "local", id: "local_1", title: "x", sourcePath: "Album/a.mp3", fileSize: 1 }))
            .toEqual({ source: "local", clientKey: "local_1" });
    });
});
