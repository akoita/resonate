import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import {
    AlbumLookupService,
    parseReleases,
    rankMatches,
    releaseSearchQuery,
    topGenre,
} from "../modules/library/album_lookup.service";

const RELEASE_A = "11111111-1111-4111-8111-111111111111";
const RELEASE_B = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const SEARCH = {
    releases: [
        {
            id: RELEASE_A,
            title: "Caravelle",
            date: "2021-10-15",
            country: "FR",
            "track-count": 17,
            "artist-credit": [{ name: "Furax Barbarossa", joinphrase: "" }],
            "label-info": [{ label: { name: "[no label]" } }, { label: { name: "Sillon" } }],
        },
        {
            id: RELEASE_B,
            title: "Caravelle",
            date: "2022",
            country: "XE",
            "track-count": 15,
            "artist-credit": [{ name: "Furax Barbarossa", joinphrase: " & " }, { name: "Guest" }],
        },
        { id: "not-an-mbid", title: "Ignored" },
    ],
};

describe("album lookup (#2538)", () => {
    const fetchMock = jest.fn();
    const realFetch = global.fetch;

    beforeAll(() => {
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterAll(() => {
        global.fetch = realFetch;
    });
    beforeEach(() => fetchMock.mockReset());

    it("quotes the album and artist as phrases and escapes quotes", () => {
        expect(releaseSearchQuery("Furax Barbarossa", "Caravelle")).toBe('release:"Caravelle" AND artist:"Furax Barbarossa"');
        expect(releaseSearchQuery("", 'Say "hi" \\ bye')).toBe('release:"Say \\"hi\\" \\\\ bye"');
    });

    it("maps releases, skipping bad ids and the [no label] placeholder", () => {
        const matches = parseReleases(SEARCH);
        expect(matches).toHaveLength(2);
        expect(matches[0]).toMatchObject({ id: RELEASE_A, year: 2021, country: "FR", label: "Sillon", trackCount: 17, artist: "Furax Barbarossa" });
        expect(matches[1]).toMatchObject({ year: 2022, label: null, artist: "Furax Barbarossa & Guest" });
    });

    it("puts releases with the same track count first and keeps MusicBrainz order otherwise", () => {
        const ranked = rankMatches(parseReleases(SEARCH), 15);
        expect(ranked.map((m) => [m.id, m.trackCountMatches])).toEqual([[RELEASE_B, true], [RELEASE_A, false]]);
        expect(rankMatches(parseReleases(SEARCH), null).map((m) => m.id)).toEqual([RELEASE_A, RELEASE_B]);
    });

    it("picks the most-voted genre in title case", () => {
        expect(topGenre([{ name: "rap", count: 2 }, { name: "french hip hop", count: 5 }])).toBe("French Hip Hop");
        expect(topGenre([])).toBeNull();
        expect(topGenre(undefined)).toBeNull();
    });

    it("sends only the album, artist and track count, with a descriptive User-Agent", async () => {
        fetchMock.mockResolvedValueOnce(json(SEARCH));
        const result = await new AlbumLookupService().search({ artist: "Furax  Barbarossa", album: " Caravelle ", tracks: "15" });

        expect(result.matches[0]?.id).toBe(RELEASE_B);
        const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
        expect(url.origin).toBe("https://musicbrainz.org");
        expect(url.pathname).toBe("/ws/2/release");
        expect([...url.searchParams.keys()].sort()).toEqual(["fmt", "limit", "query"]);
        expect(url.searchParams.get("query")).toBe('release:"Caravelle" AND artist:"Furax Barbarossa"');
        expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^Resonate\/.+\(https:\/\//);
        expect(init.redirect).toBe("error");
    });

    it("rejects a missing album and a bad track count before calling MusicBrainz", async () => {
        const service = new AlbumLookupService();
        await expect(service.search({ artist: "x" })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.search({ album: "x", tracks: "1.5" })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.search({ album: "x".repeat(201) })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.details("../etc")).rejects.toBeInstanceOf(BadRequestException);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns the year, label and genre, falling back to the release group's genres", async () => {
        fetchMock
            .mockResolvedValueOnce(json({
                id: RELEASE_A,
                date: "2021-10-15",
                genres: [],
                "label-info": [{ label: { name: "Sillon" } }],
                "release-group": { id: GROUP },
            }))
            .mockResolvedValueOnce(json({ id: GROUP, genres: [{ name: "hip hop", count: 3 }] }));

        const details = await new AlbumLookupService().details(RELEASE_A.toUpperCase());

        expect(details).toEqual({
            id: RELEASE_A,
            year: 2021,
            genre: "Hip Hop",
            label: "Sillon",
            sourceUrl: `https://musicbrainz.org/release/${RELEASE_A}`,
        });
        const urls = fetchMock.mock.calls.map(([u]) => (u as URL).pathname);
        expect(urls).toEqual([`/ws/2/release/${RELEASE_A}`, `/ws/2/release-group/${GROUP}`]);
    });

    it("answers a friendly 503 when MusicBrainz fails or rate-limits", async () => {
        const service = new AlbumLookupService();
        fetchMock.mockResolvedValueOnce(json({ error: "slow down" }, 503));
        await expect(service.search({ album: "Busy" })).rejects.toThrow("MusicBrainz is busy right now");
        fetchMock.mockRejectedValueOnce(new Error("offline"));
        await expect(service.search({ album: "Offline" })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("caches a search so repeating it does not call MusicBrainz again", async () => {
        const service = new AlbumLookupService();
        fetchMock.mockResolvedValueOnce(json(SEARCH));
        await service.search({ album: "Caravelle" });
        await service.search({ album: "Caravelle" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
