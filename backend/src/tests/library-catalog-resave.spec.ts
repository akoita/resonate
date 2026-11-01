import { catalogResaveUpdate, derivedCatalogStreamPath } from "../modules/library/library.service";

describe("catalogResaveUpdate", () => {
    it("never blanks a known stream URL, preview, artwork or duration", () => {
        const update = catalogResaveUpdate({
            title: "Butu na moyi",
            remoteUrl: null,
            previewUrl: undefined,
            remoteArtworkUrl: null,
            duration: null,
            album: null,
        });
        expect(update).toEqual({ title: "Butu na moyi", album: null });
    });

    it("still applies new values", () => {
        expect(catalogResaveUpdate({ remoteUrl: "/catalog/releases/r/tracks/t/stream", duration: 200 })).toEqual({
            remoteUrl: "/catalog/releases/r/tracks/t/stream",
            duration: 200,
        });
    });
});

describe("derivedCatalogStreamPath", () => {
    const row = { source: "remote", stemType: null, remoteUrl: null, previewUrl: null };

    it("derives the catalog stream for a whole remote track without a URL", () => {
        expect(derivedCatalogStreamPath(row, "trk_1", "rel 1")).toBe("/catalog/releases/rel%201/tracks/trk_1/stream");
    });

    it("leaves rows alone that already play or are not whole catalog tracks", () => {
        expect(derivedCatalogStreamPath({ ...row, remoteUrl: "/x" }, "trk_1", "rel_1")).toBeNull();
        expect(derivedCatalogStreamPath({ ...row, previewUrl: "/p" }, "trk_1", "rel_1")).toBeNull();
        expect(derivedCatalogStreamPath({ ...row, stemType: "vocals" }, "trk_1", "rel_1")).toBeNull();
        expect(derivedCatalogStreamPath({ ...row, source: "local" }, "trk_1", "rel_1")).toBeNull();
        expect(derivedCatalogStreamPath(row, "trk_1", undefined)).toBeNull();
    });
});
