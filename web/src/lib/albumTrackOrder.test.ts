import { describe, expect, it } from "vitest";
import { sortByAlbumPosition } from "./albumTrackOrder";

const t = (id: string, trackNumber?: number | null, discNumber?: number | null) => ({ id, trackNumber, discNumber });

describe("sortByAlbumPosition", () => {
    it("orders by disc, then track number", () => {
        const sorted = sortByAlbumPosition([t("b", 2), t("d", 1, 2), t("a", 1), t("c", 3, 1)]);
        expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("leaves an album with no numbers as it was", () => {
        const tracks = [t("z"), t("a"), t("m")];
        expect(sortByAlbumPosition(tracks)).toBe(tracks);
    });

    it("keeps unnumbered tracks after the numbered ones, in their order", () => {
        const sorted = sortByAlbumPosition([t("x"), t("b", 2), t("y"), t("a", 1)]);
        expect(sorted.map((x) => x.id)).toEqual(["a", "b", "x", "y"]);
    });
});
