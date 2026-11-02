import { BadRequestException } from "@nestjs/common";
import { cleanFolderName, validateLibraryTrackInput } from "../modules/library/library.service";

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
