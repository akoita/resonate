import { serializePublicShowCampaign } from "../modules/shows/shows.service";

const base = {
  id: "c1",
  slug: "c1",
  artistId: null,
  artistDisplayName: "Artist",
  title: "Artist in City",
  city: "City",
  country: "ZZ",
  status: "active",
  deadline: new Date("2030-01-01T00:00:00.000Z"),
  goalAmountUnits: "1000000",
  raisedAmountUnits: "0",
  chainId: 31337,
};

const sampleMetadata = {
  fixture: true,
  artistPresentation: {
    summary: "Sample bio",
    imageUrl: "/shows/campaigns/c1/visuals/portrait",
    socialLinks: { instagram: "https://instagram.example/a", bad: "javascript:alert(1)" },
  },
};

describe("sample campaign artist presentation", () => {
  it("uses the fixture presentation when no artist profile is linked", () => {
    const dto = serializePublicShowCampaign({ ...base, metadata: sampleMetadata });
    expect(dto.artist).toEqual({
      summary: "Sample bio",
      imageUrl: "/shows/campaigns/c1/visuals/portrait",
      socialLinks: { instagram: "https://instagram.example/a" },
    });
  });

  it("lets the linked profile's own fields win and fills only the gaps", () => {
    const dto = serializePublicShowCampaign({
      ...base,
      artistId: "real",
      artist: { imageUrl: null, summary: "Real bio", socialLinks: null },
      metadata: sampleMetadata,
    });
    expect(dto.artist).toMatchObject({ summary: "Real bio", imageUrl: "/shows/campaigns/c1/visuals/portrait" });
  });

  it("ignores presentation metadata on non-fixture campaigns", () => {
    const dto = serializePublicShowCampaign({ ...base, metadata: { artistPresentation: sampleMetadata.artistPresentation } });
    expect(dto.artist).toBeUndefined();
  });
});
