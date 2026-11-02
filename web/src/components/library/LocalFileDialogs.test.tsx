/**
 * Editing your own files: which values the form starts from, and which
 * changes it saves, for one track, several tracks, or a whole album.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/localLibrary", () => ({ getArtworkUrl: vi.fn(), updateLocalTracks: vi.fn() }));
vi.mock("../../lib/localFileLocation", () => ({ getLocalFileLocation: vi.fn(), revealInFilePicker: vi.fn() }));

import { editFromForm, initialFieldStates } from "./LocalFileDialogs";
import type { LocalTrack } from "../../lib/localLibrary";

const track = (id: string, extra: Partial<LocalTrack> = {}): LocalTrack => ({
    id, source: "local", title: id, artist: "Furax Barbarossa", albumArtist: null, album: "Caravelle",
    year: null, genre: null, duration: 1, createdAt: "2026-01-01", ...extra,
});

describe("EditLocalDetailsDialog form", () => {
    it("starts from shared values and marks the ones that differ as mixed", () => {
        const states = initialFieldStates([track("a", { trackNumber: 1, label: "L" }), track("b", { trackNumber: 2, label: "L" })], "tracks");
        expect(states.album).toEqual({ initial: "Caravelle", mixed: false });
        expect(states.label).toEqual({ initial: "L", mixed: false });
        expect(states.trackNumber).toEqual({ initial: "", mixed: true });
    });

    it("starts an album with no album artist from its tracks' artist", () => {
        expect(initialFieldStates([track("a"), track("b")], "album").albumArtist?.initial).toBe("Furax Barbarossa");
    });

    it("saves only changed fields, and keeps mixed fields left empty", () => {
        const states = initialFieldStates([track("a", { genre: "Rap" }), track("b", { genre: "Pop" })], "album");
        const values = { album: "Caravelle", albumArtist: "Furax Barbarossa", year: "2022", genre: "", label: "", copyright: "" };
        expect(editFromForm(values, states, "album")).toEqual({ edit: { year: 2022 } });
    });

    it("clears a field emptied on a single track and ignores fields outside the mode", () => {
        const states = initialFieldStates([track("a", { genre: "Rap", isrc: "X" })], "track");
        const values = { title: "a", artist: "Furax Barbarossa", album: "Caravelle", genre: "", isrc: "X" };
        expect(editFromForm(values, states, "track")).toEqual({ edit: { genre: null } });
        // ISRC is per track: an album edit never sends it.
        expect(editFromForm({ isrc: "Y" }, states, "album")).toEqual({ edit: {} });
    });

    it("rejects numbers out of range", () => {
        const states = initialFieldStates([track("a")], "track");
        expect(editFromForm({ year: "22" }, states, "track")).toEqual({ error: "Year must be a whole number from 1000 to 2999." });
        expect(editFromForm({ trackNumber: "1.5" }, states, "track")).toHaveProperty("error");
        expect(editFromForm({ trackNumber: "3" }, states, "track")).toEqual({ edit: { trackNumber: 3 } });
    });
});
