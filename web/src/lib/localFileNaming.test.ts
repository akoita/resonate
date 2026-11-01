import { describe, expect, it } from "vitest";
import { folderMetadataFromPath, pickFolderArtwork, titleFromFileName } from "./localFileNaming";

describe("local file naming", () => {
    it("turns a numbered slug into a title", () => {
        expect(titleFromFileName("15-you-carried-me-home-(a-cappella-version).mp3"))
            .toBe("You carried me home (a cappella version)");
        expect(titleFromFileName("03 Gelati.flac")).toBe("Gelati");
        expect(titleFromFileName("07. Sous la grêle.mp3")).toBe("Sous la grêle");
        expect(titleFromFileName("Itinéraire bis.mp3")).toBe("Itinéraire bis");
        expect(titleFromFileName("1999.mp3")).toBe("1999");
    });

    it("reads album and artist from Artist/Album folders", () => {
        expect(folderMetadataFromPath("Furax Barbarossa/Caravelle/01.mp3", "Discs"))
            .toEqual({ album: "Caravelle", artist: "Furax Barbarossa" });
        expect(folderMetadataFromPath("01.mp3", "Caravelle")).toEqual({ album: "Caravelle", artist: null });
        expect(folderMetadataFromPath("Nina/Pastel/CD2/01.mp3", "Music"))
            .toEqual({ album: "Pastel", artist: "Nina" });
    });

    it("ignores folders that are not albums", () => {
        expect(folderMetadataFromPath("song.mp3", "Music")).toEqual({ album: null, artist: null });
        expect(folderMetadataFromPath("Downloads/song.mp3", "Me")).toEqual({ album: null, artist: null });
        expect(folderMetadataFromPath("Caravelle/01.mp3", "Music")).toEqual({ album: "Caravelle", artist: null });
    });

    it("finds the folder cover, best name first", () => {
        expect(pickFolderArtwork(["AlbumArtSmall.jpg", "Folder.jpg"])).toBe("Folder.jpg");
        expect(pickFolderArtwork(["AlbumArtSmall.jpg", "AlbumArt_{ABC}_Large.jpg"])).toBe("AlbumArt_{ABC}_Large.jpg");
        expect(pickFolderArtwork(["AlbumArtSmall.jpg"])).toBe("AlbumArtSmall.jpg");
        expect(pickFolderArtwork(["scan.png"])).toBe("scan.png");
        expect(pickFolderArtwork(["a.png", "b.png"])).toBeNull();
        expect(pickFolderArtwork([])).toBeNull();
    });
});
