import { describe, expect, it } from "vitest";
import { describeFilled, fillEmptyFields } from "./albumLookup";

const details = { year: 2021, genre: "Hip Hop", label: "Sillon" };

describe("album lookup fill (#2538)", () => {
    it("fills only empty fields", () => {
        const result = fillEmptyFields({ album: "Caravelle", year: "", genre: "Rap", label: " " }, () => false, details);
        expect(result.values).toEqual({ album: "Caravelle", year: "2021", genre: "Rap", label: "Sillon" });
        expect(result.filled).toEqual(["year", "label"]);
    });

    it("never fills a field that differs between tracks", () => {
        const result = fillEmptyFields({ year: "", genre: "", label: "" }, (key) => key === "genre", details);
        expect(result.filled).toEqual(["year", "label"]);
        expect(result.values.genre).toBe("");
    });

    it("skips values the release does not have", () => {
        const result = fillEmptyFields({ year: "", genre: "", label: "" }, () => false, { year: null, genre: null, label: "Sillon" });
        expect(result.filled).toEqual(["label"]);
    });

    it("describes what it filled", () => {
        expect(describeFilled(["year"])).toBe("Filled year.");
        expect(describeFilled(["year", "genre"])).toBe("Filled year and genre.");
        expect(describeFilled(["year", "genre", "label"])).toBe("Filled year, genre and label.");
        expect(describeFilled([])).toBe("");
    });
});
