import { describe, expect, it } from "vitest";
import {
    catalogTrackIdOf,
    isCatalogTrack,
    isLocalFileTrack,
    isOwnFileTrack,
    matchesLibraryOriginFilter,
} from "./trackIdentity";

describe("track identity (#2508)", () => {
    it("never gives a device file a catalog identity, whatever fields it carries", () => {
        const forged = { id: "local_1", source: "local" as const, catalogTrackId: "trk_1", remoteUrl: "/catalog/releases/r/tracks/trk_1/stream" };
        expect(isLocalFileTrack(forged)).toBe(true);
        expect(catalogTrackIdOf(forged)).toBeNull();
        expect(isCatalogTrack(forged)).toBe(false);
    });

    it("uses the catalog track id of a saved catalog track", () => {
        expect(catalogTrackIdOf({ id: "row-uuid", source: "remote", catalogTrackId: "trk_1" })).toBe("trk_1");
    });

    it("falls back to the id of a streamed platform track", () => {
        expect(catalogTrackIdOf({ id: "trk_2", source: "remote" })).toBe("trk_2");
        expect(catalogTrackIdOf({ id: "trk_3", remoteUrl: "/catalog/releases/r/tracks/trk_3/stream" })).toBe("trk_3");
    });

    it("treats a legacy cached row with an in-browser copy as local", () => {
        expect(catalogTrackIdOf({ id: "local_old", blobKey: "blob_local_old", remoteUrl: "x" })).toBeNull();
    });
});

describe("library origin filter", () => {
    const local = { source: "local" as const };
    const legacyCopy = { blobKey: "blob_1" };
    const catalog = { source: "remote" as const };

    it("counts device files, including legacy in-browser copies, as the listener's own", () => {
        expect(isOwnFileTrack(local)).toBe(true);
        expect(isOwnFileTrack(legacyCopy)).toBe(true);
        expect(isOwnFileTrack(catalog)).toBe(false);
        expect(isOwnFileTrack({ source: "remote" as const, blobKey: "stale" })).toBe(false);
    });

    it("splits the library into platform tracks and own files", () => {
        const rows = [local, legacyCopy, catalog];
        expect(rows.filter((t) => matchesLibraryOriginFilter(t, "all"))).toHaveLength(3);
        expect(rows.filter((t) => matchesLibraryOriginFilter(t, "local"))).toEqual([local, legacyCopy]);
        expect(rows.filter((t) => matchesLibraryOriginFilter(t, "catalog"))).toEqual([catalog]);
    });
});
