import { withPublicStemUris } from "../modules/catalog/public_stem_uri";

describe("public stem URIs (#2661)", () => {
  it("replaces storage locations with playable routes at any depth", () => {
    const release = {
      id: "r1",
      createdAt: new Date(0),
      tracks: [
        {
          id: "t1",
          stems: [
            { id: "s1", type: "original", uri: "https://storage.googleapis.com/b/originals/s1.wav", source: null },
            { id: "s2", type: "drums", uri: "https://storage.googleapis.com/b/originals/s2.wav", source: "official" },
            { id: "s3", type: "vocals", uri: "ipfs://enc", source: "separated", isEncrypted: true },
          ],
        },
      ],
    };
    const out = withPublicStemUris(release);
    const stems = out.tracks[0].stems;
    expect(stems[0].uri).toBe("/catalog/stems/s1/blob");
    expect(stems[1].uri).toBe("/catalog/stems/s2/preview");
    expect(stems[2].uri).toBe("ipfs://enc");
    expect(out.createdAt).toBeInstanceOf(Date);
    // The input is not mutated (services cache their results).
    expect(release.tracks[0].stems[0].uri).toContain("storage.googleapis.com");
    expect(JSON.stringify(out)).not.toContain("originals/");
  });

  it("handles lists and empty values", () => {
    expect(withPublicStemUris([{ stems: [{ id: "a", uri: "gs://x" }] }])).toEqual([
      { stems: [{ id: "a", uri: "/catalog/stems/a/blob" }] },
    ]);
    expect(withPublicStemUris(null)).toBeNull();
  });
});
