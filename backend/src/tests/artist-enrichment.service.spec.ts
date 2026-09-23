const mockGenerateContent = jest.fn();

jest.mock("@google/generative-ai", () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
    })),
    SchemaType: { OBJECT: "object", STRING: "string" },
}));

import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { ArtistEnrichmentService } from "../modules/artist/artist-enrichment.service";

const MBID = "12345678-1234-4234-8234-123456789abc";

describe("ArtistEnrichmentService", () => {
    const originalApiKey = process.env.GOOGLE_AI_API_KEY;
    let fetchMock: jest.SpyInstance;
    let service: ArtistEnrichmentService;

    beforeEach(() => {
        service = new ArtistEnrichmentService();
        fetchMock = jest.spyOn(globalThis, "fetch");
        delete process.env.GOOGLE_AI_API_KEY;
        mockGenerateContent.mockReset();
    });

    afterEach(() => {
        if (originalApiKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
        else process.env.GOOGLE_AI_API_KEY = originalApiKey;
        jest.restoreAllMocks();
    });

    it("returns distinct bounded MusicBrainz candidates and uses a quoted name query", async () => {
        const artists = [
            { id: MBID, name: "Ada & The Echoes", score: 135, area: { name: "France" } },
            { id: "32345678-1234-4234-8234-123456789abc", name: "Ada & The Echoes", score: 90 },
            { id: MBID.toUpperCase(), name: "Duplicate result", score: 90 },
            ...Array.from({ length: 8 }, (_, index) => ({
                id: `22345678-1234-4234-8234-${String(index + 1).padStart(12, "0")}`,
                name: `Artist ${index + 1}`,
                score: index,
            })),
            { id: "not-a-mbid", name: "Invalid identity" },
        ];
        fetchMock.mockResolvedValueOnce(jsonResponse({ artists }));

        const candidates = await service.findCandidates('Ada "Echoes"');

        expect(candidates).toHaveLength(8);
        expect(candidates[0]).toMatchObject({
            id: MBID,
            name: "Ada & The Echoes",
            area: "France",
            score: 100,
            sourceUrl: `https://musicbrainz.org/artist/${MBID}`,
        });
        expect(candidates.some((candidate) => candidate.name === "Duplicate result")).toBe(false);
        expect(candidates.filter((candidate) => candidate.name === "Ada & The Echoes")).toHaveLength(2);
        const [requestUrl, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(new URL(requestUrl).searchParams.get("query")).toBe('artist:"Ada \\"Echoes\\""');
        expect(options.redirect).toBe("error");
        expect(options.headers).toMatchObject({ "User-Agent": expect.stringContaining("Resonate/") });
    });

    it("returns relationship suggestions, a CC0 image, and a bio from bounded structured facts", async () => {
        process.env.GOOGLE_AI_API_KEY = "test-key";
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => JSON.stringify({ summary: "Ada Example is a French musician and pianist." }),
            },
        });
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = new URL(input.toString());
            if (url.origin === "https://musicbrainz.org") {
                return jsonResponse({
                    id: MBID,
                    name: "Ada Example",
                    type: "Person",
                    area: { name: "France" },
                    "begin-area": { name: "Paris" },
                    "life-span": { begin: "1982-04-03", ended: false },
                    annotation: "ANNOTATION_TEXT_MUST_NOT_REACH_THE_MODEL",
                    relations: [
                        { type: "official homepage", url: { resource: "http://legacy.ada.example/" } },
                        { type: "official homepage", url: { resource: "https://ada.example/" } },
                        { type: "official homepage", url: { resource: "javascript:alert(1)" } },
                        { type: "social network", url: { resource: "https://x.com/ada" } },
                        { type: "social network", url: { resource: "https://instagram.com.attacker.example/ada" } },
                        { type: "social network", url: { resource: "https://www.youtube.com/@ada" } },
                        { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42" } },
                        { type: "other", url: { resource: "https://untrusted.example/page" } },
                    ],
                });
            }
            if (url.origin === "https://www.wikidata.org" && url.searchParams.get("props") === "claims") {
                return jsonResponse({
                    entities: {
                        Q42: {
                            claims: {
                                P18: [{ mainsnak: { datavalue: { value: "Ada Portrait.jpg" } } }],
                                P106: [{ mainsnak: { datavalue: { value: { id: "Q33999" } } } }],
                                P19: [{ mainsnak: { datavalue: { value: { id: "Q90" } } } }],
                                P17: [{ mainsnak: { datavalue: { value: { id: "Q142" } } } }],
                                P569: [{ mainsnak: { datavalue: { value: { time: "+1982-04-03T00:00:00Z" } } } }],
                            },
                        },
                    },
                });
            }
            if (url.origin === "https://www.wikidata.org") {
                return jsonResponse({
                    entities: {
                        Q33999: { labels: { en: { value: "pianist" } } },
                        Q90: { labels: { en: { value: "Paris" } } },
                        Q142: { labels: { en: { value: "France" } } },
                    },
                });
            }
            if (url.origin === "https://commons.wikimedia.org") {
                return jsonResponse({
                    query: {
                        pages: [{
                            imageinfo: [{
                                url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ada_Portrait.jpg",
                                extmetadata: {
                                    LicenseShortName: { value: "CC0 1.0" },
                                    Artist: { value: "<a href=\"https://photo.example\">Photographer</a>" },
                                },
                            }],
                        }],
                    },
                });
            }
            throw new Error(`Unexpected provider origin: ${url.origin}`);
        });

        const result = await service.buildSuggestions(MBID);

        expect(result.candidate).toMatchObject({ id: MBID, name: "Ada Example" });
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        expect(result.warnings).toEqual([]);
        expect(result.suggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "website", value: "https://ada.example/", sourceLabel: "MusicBrainz", confidence: "medium" }),
            expect.objectContaining({ field: "x", value: "https://x.com/ada", sourceLabel: "MusicBrainz" }),
            expect.objectContaining({ field: "youtube", value: "https://www.youtube.com/@ada" }),
            expect.objectContaining({
                field: "imageUrl",
                value: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ada_Portrait.jpg",
                sourceLabel: "Wikimedia Commons",
                rights: {
                    license: "CC0 1.0",
                    attribution: "Photographer",
                    descriptionUrl: "https://commons.wikimedia.org/wiki/File:Ada%20Portrait.jpg",
                },
            }),
            expect.objectContaining({
                field: "summary",
                value: "Ada Example is a French musician and pianist.",
                sourceUrl: "https://www.wikidata.org/wiki/Q42",
            }),
        ]));
        expect(result.suggestions.some(({ field }) => field === "instagram")).toBe(false);
        expect(result.suggestions.some(({ field }) => field === "soundcloud")).toBe(false);
        expect(result.suggestions.every(({ value }) => !value.startsWith("javascript:"))).toBe(true);
        expect(result.warnings).toEqual([]);

        const modelPrompt = mockGenerateContent.mock.calls[0][0] as string;
        expect(modelPrompt).toContain('"occupations":["pianist"]');
        expect(modelPrompt).toContain('"birthPlace":"Paris"');
        expect(modelPrompt).not.toContain("ANNOTATION_TEXT_MUST_NOT_REACH_THE_MODEL");
        expect(modelPrompt).not.toContain("untrusted.example");
        expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).origin)).toEqual([
            "https://musicbrainz.org",
            "https://www.wikidata.org",
            "https://www.wikidata.org",
            "https://commons.wikimedia.org",
        ]);
        expect(fetchMock.mock.calls.every(([, options]) => (
            (options as RequestInit).headers as Record<string, string>
        )["User-Agent"] === "Resonate/0.1 (https://github.com/akoita/resonate)")).toBe(true);
    });

    it("preserves verified link suggestions when AI is unavailable", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            id: MBID,
            name: "Ada Example",
            type: "Person",
            relations: [{ type: "official homepage", url: { resource: "https://ada.example/" } }],
        }));

        const result = await service.buildSuggestions(MBID);

        expect(result.suggestions).toEqual([
            expect.objectContaining({ field: "website", value: "https://ada.example/" }),
        ]);
        expect(result.warnings).toContain("AI bio suggestions are unavailable because GOOGLE_AI_API_KEY is not configured.");
        expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("omits a malformed AI bio while keeping verified provider links", async () => {
        process.env.GOOGLE_AI_API_KEY = "test-key";
        mockGenerateContent.mockResolvedValue({ response: { text: () => "{not-json" } });
        fetchMock.mockResolvedValueOnce(jsonResponse({
            id: MBID,
            name: "Ada Example",
            type: "Person",
            relations: [{ type: "official homepage", url: { resource: "https://ada.example/" } }],
        }));

        const result = await service.buildSuggestions(MBID);

        expect(result.suggestions).toEqual([
            expect.objectContaining({ field: "website", value: "https://ada.example/" }),
        ]);
        expect(result.warnings).toContain("AI could not return a usable bio; verified link suggestions remain available.");
    });

    it("keeps MusicBrainz links when Wikidata is temporarily unavailable", async () => {
        process.env.GOOGLE_AI_API_KEY = "test-key";
        mockGenerateContent.mockResolvedValue({
            response: { text: () => JSON.stringify({ summary: "Ada Example is a person." }) },
        });
        fetchMock
            .mockResolvedValueOnce(jsonResponse({
                id: MBID,
                name: "Ada Example",
                type: "Person",
                relations: [
                    { type: "official homepage", url: { resource: "https://ada.example/" } },
                    { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42" } },
                ],
            }))
            .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }));

        const result = await service.buildSuggestions(MBID);

        expect(result.suggestions).toEqual([
            expect.objectContaining({ field: "website", value: "https://ada.example/" }),
            expect.objectContaining({
                field: "summary",
                sourceUrl: `https://musicbrainz.org/artist/${MBID}`,
                sourceLabel: "MusicBrainz",
            }),
        ]);
        expect(result.warnings).toContain("Wikidata rate limit reached; try again later. No image suggestion was added.");
    });

    it("marks a legacy HTTP homepage as low confidence when no HTTPS relation exists", async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            id: MBID,
            name: "Ada Example",
            relations: [{ type: "official homepage", url: { resource: "http://legacy.ada.example/" } }],
        }));

        const result = await service.buildSuggestions(MBID);

        expect(result.suggestions).toEqual([
            expect.objectContaining({ field: "website", value: "http://legacy.ada.example/", confidence: "low" }),
        ]);
    });

    it("caps simultaneous model calls per process at two", async () => {
        process.env.GOOGLE_AI_API_KEY = "test-key";
        const pendingModelCalls: Array<(value: unknown) => void> = [];
        mockGenerateContent.mockImplementation(() => new Promise((resolve) => pendingModelCalls.push(resolve)));
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = new URL(input.toString());
            if (url.origin !== "https://musicbrainz.org") throw new Error(`Unexpected provider origin: ${url.origin}`);
            return jsonResponse({ id: MBID, name: "Ada Example", type: "Person" });
        });

        const requests = [
            new ArtistEnrichmentService().buildSuggestions(MBID),
            new ArtistEnrichmentService().buildSuggestions(MBID),
            new ArtistEnrichmentService().buildSuggestions(MBID),
        ];
        let thirdSettled = false;
        void requests[2].then(() => { thirdSettled = true; });
        const deadline = Date.now() + 6_000;
        while (!thirdSettled && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(thirdSettled).toBe(true);
        expect(pendingModelCalls).toHaveLength(2);

        for (const resolve of pendingModelCalls) {
            resolve({ response: { text: () => JSON.stringify({ summary: "Ada is an artist." }) } });
        }
        const results = await Promise.all(requests);
        expect(results[2].warnings).toContain("AI bio suggestions are temporarily unavailable or busy; verified link suggestions remain available.");
        expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    }, 8_000);

    it("omits Commons images unless the returned metadata names CC0 or Public Domain", async () => {
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = new URL(input.toString());
            if (url.origin === "https://musicbrainz.org") {
                return jsonResponse({
                    id: MBID,
                    name: "Ada Example",
                    relations: [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42" } }],
                });
            }
            if (url.origin === "https://www.wikidata.org") {
                return jsonResponse({ entities: { Q42: { claims: { P18: [{ mainsnak: { datavalue: { value: "Ada.jpg" } } }] } } } });
            }
            if (url.origin === "https://commons.wikimedia.org") {
                return jsonResponse({
                    query: { pages: [{ imageinfo: [{
                        url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ada.jpg",
                        extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } },
                    }] }] },
                });
            }
            throw new Error(`Unexpected provider origin: ${url.origin}`);
        });

        const result = await service.buildSuggestions(MBID);

        expect(result.suggestions.some(({ field }) => field === "imageUrl")).toBe(false);
        expect(result.warnings).toContain("No CC0 or Public Domain image license was verified; no image suggestion was added.");
    });

    it("accepts a Commons image when metadata explicitly marks it Public Domain", async () => {
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = new URL(input.toString());
            if (url.origin === "https://musicbrainz.org") {
                return jsonResponse({
                    id: MBID,
                    name: "Ada Example",
                    relations: [{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42" } }],
                });
            }
            if (url.origin === "https://www.wikidata.org") {
                return jsonResponse({ entities: { Q42: { claims: { P18: [{ mainsnak: { datavalue: { value: "Ada.jpg" } } }] } } } });
            }
            if (url.origin === "https://commons.wikimedia.org") {
                return jsonResponse({
                    query: { pages: [{ imageinfo: [{
                        url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Ada.jpg",
                        extmetadata: { LicenseShortName: { value: "Public domain" } },
                    }] }] },
                });
            }
            throw new Error(`Unexpected provider origin: ${url.origin}`);
        });

        const result = await service.buildSuggestions(MBID);

        expect(result.suggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                field: "imageUrl",
                rights: expect.objectContaining({ license: "Public domain" }),
            }),
        ]));
    });

    it("reports a Commons rate limit while retaining available MusicBrainz links", async () => {
        fetchMock.mockImplementation(async (input: string | URL | Request) => {
            const url = new URL(input.toString());
            if (url.origin === "https://musicbrainz.org") {
                return jsonResponse({
                    id: MBID,
                    name: "Ada Example",
                    relations: [
                        { type: "official homepage", url: { resource: "https://ada.example/" } },
                        { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q42" } },
                    ],
                });
            }
            if (url.origin === "https://www.wikidata.org") {
                return jsonResponse({ entities: { Q42: { claims: { P18: [{ mainsnak: { datavalue: { value: "Ada.jpg" } } }] } } } });
            }
            if (url.origin === "https://commons.wikimedia.org") {
                return new Response("", { status: 429, headers: { "retry-after": "1" } });
            }
            throw new Error(`Unexpected provider origin: ${url.origin}`);
        });

        const result = await service.buildSuggestions(MBID);

        expect(result.suggestions).toEqual([
            expect.objectContaining({ field: "website", value: "https://ada.example/" }),
        ]);
        expect(result.warnings).toContain("Wikimedia Commons rate limit reached; try again later. No image suggestion was added.");
    });

    it("rejects malformed MusicBrainz IDs before making a provider request", async () => {
        await expect(service.buildSuggestions("https://musicbrainz.org/artist/attacker"))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("turns temporary MusicBrainz provider failures into recoverable 503 responses", async () => {
        fetchMock
            .mockResolvedValueOnce(new Response("", { status: 503 }))
            .mockResolvedValueOnce(jsonResponse({ artists: [] }));

        await expect(service.findCandidates("Ada Example")).rejects.toBeInstanceOf(ServiceUnavailableException);
        await expect(service.findCandidates("Ada Example")).resolves.toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives MusicBrainz 429 responses a clear, retryable message", async () => {
        fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }));

        await expect(service.findCandidates("Ada Example"))
            .rejects.toThrow("MusicBrainz rate limit reached. Please try again later.");
    });
});

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}
