import {
  DEFAULT_TRACK_EMBEDDING_MODEL,
  HASH_EMBEDDING_MODEL_ID,
  TRACK_EMBEDDING_DIMENSION,
  resolveEmbeddingProviderConfig,
} from "../modules/embeddings/embedding.config";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { HashEmbedder } from "../modules/embeddings/hash_embedder";
import {
  trackEmbeddingContentHash,
  trackEmbeddingText,
} from "../modules/embeddings/track_embedding_text";

function dot(a: number[], b: number[]) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

describe("HashEmbedder", () => {
  const embedder = new HashEmbedder();

  it("produces deterministic, normalized 768-dim vectors", () => {
    const a = embedder.embed("lofi chill");
    expect(a).toHaveLength(TRACK_EMBEDDING_DIMENSION);
    expect(TRACK_EMBEDDING_DIMENSION).toBe(768);
    expect(embedder.embed("lofi chill")).toEqual(a);
    expect(dot(a, a)).toBeCloseTo(1);
  });

  it("scores lexically related text above unrelated text", () => {
    const query = embedder.embed("lofi chill beats");
    expect(dot(query, embedder.embed("chill beats"))).toBeGreaterThan(
      dot(query, embedder.embed("death metal")),
    );
  });

  it("never returns a zero vector, including for non-latin or empty text", () => {
    for (const text of ["", "!!!", "夜のドライブ"]) {
      const vector = embedder.embed(text);
      expect(vector).toHaveLength(TRACK_EMBEDDING_DIMENSION);
      expect(dot(vector, vector)).toBeCloseTo(1);
    }
    expect(embedder.embed("夜のドライブ")).not.toEqual(embedder.embed("朝の散歩"));
  });
});

describe("resolveEmbeddingProviderConfig", () => {
  it("defaults to disabled, even with a GCP project, until vertex is opted in", () => {
    expect(resolveEmbeddingProviderConfig({})).toEqual({
      mode: "disabled",
      model: null,
    });
    expect(
      resolveEmbeddingProviderConfig({ GCP_PROJECT_ID: "proj-a" }),
    ).toEqual({ mode: "disabled", model: null });
    expect(
      resolveEmbeddingProviderConfig({
        GCP_PROJECT_ID: "proj-a",
        TRACK_EMBEDDING_PROVIDER: "vertex",
      }),
    ).toEqual({
      mode: "vertex",
      model: DEFAULT_TRACK_EMBEDDING_MODEL,
      projectId: "proj-a",
      location: "us-central1",
    });
  });

  it("reuses the canonical project variable chain", () => {
    expect(
      resolveEmbeddingProviderConfig({
        GOOGLE_CLOUD_PROJECT: "proj-b",
        TRACK_EMBEDDING_PROVIDER: "vertex",
      }),
    ).toMatchObject({ mode: "vertex", projectId: "proj-b" });
    expect(
      resolveEmbeddingProviderConfig({
        GCLOUD_PROJECT: "proj-c",
        TRACK_EMBEDDING_PROVIDER: "vertex",
      }),
    ).toMatchObject({ mode: "vertex", projectId: "proj-c" });
  });

  it("honours model and location overrides", () => {
    expect(
      resolveEmbeddingProviderConfig({
        TRACK_EMBEDDING_PROVIDER: "vertex",
        GCP_PROJECT_ID: "proj-a",
        TRACK_EMBEDDING_MODEL: "custom-embedding-model",
        TRACK_EMBEDDING_LOCATION: "europe-west4",
      }),
    ).toEqual({
      mode: "vertex",
      model: "custom-embedding-model",
      projectId: "proj-a",
      location: "europe-west4",
    });
  });

  it("hash is the explicit offline fallback and needs no project", () => {
    expect(
      resolveEmbeddingProviderConfig({ TRACK_EMBEDDING_PROVIDER: "hash" }),
    ).toEqual({ mode: "hash", model: HASH_EMBEDDING_MODEL_ID });
  });

  it("explicit disabled wins over a configured project", () => {
    expect(
      resolveEmbeddingProviderConfig({
        TRACK_EMBEDDING_PROVIDER: "disabled",
        GCP_PROJECT_ID: "proj-a",
      }),
    ).toEqual({ mode: "disabled", model: null });
  });

  it("fails closed for vertex without a project and for unknown values", () => {
    expect(
      resolveEmbeddingProviderConfig({ TRACK_EMBEDDING_PROVIDER: "vertex" }),
    ).toEqual({ mode: "disabled", model: null });
    expect(
      resolveEmbeddingProviderConfig({
        TRACK_EMBEDDING_PROVIDER: "openai",
        GCP_PROJECT_ID: "proj-a",
      }),
    ).toEqual({ mode: "disabled", model: null });
  });
});

describe("EmbeddingService", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when the provider is disabled", async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
    const service = new EmbeddingService();
    expect(service.modelId).toBeNull();
    expect(service.isEnabled()).toBe(false);
    await expect(service.embedDocuments(["a"])).resolves.toBeNull();
    await expect(service.embedQuery("a")).resolves.toBeNull();
  });

  it("serves deterministic hash vectors under the hash-v1 model id", async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    const service = new EmbeddingService();
    expect(service.modelId).toBe("hash-v1");
    const vectors = await service.embedDocuments(["lofi chill", "chill beats"]);
    expect(vectors).toHaveLength(2);
    expect(vectors?.[0]).toHaveLength(TRACK_EMBEDDING_DIMENSION);
    await expect(service.embedQuery("lofi chill")).resolves.toEqual(vectors?.[0]);
  });

  it("has no vector for an empty query", async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    await expect(new EmbeddingService().embedQuery("   ")).resolves.toBeNull();
  });
});

describe("trackEmbeddingText", () => {
  const base = {
    title: "Midnight  Drive",
    artist: null,
    release: {
      title: "Night Tapes",
      genre: " Synthwave ",
      moods: ["Dark", "chill", "dark"],
      primaryArtist: "Neon Ghost",
      featuredArtists: "Kira",
      artist: { displayName: "uploader-account" },
      artistCredits: [],
    },
  };

  it("builds a stable, normalized description of the track", () => {
    expect(trackEmbeddingText(base)).toBe(
      [
        "Title: Midnight Drive",
        "Artist: Neon Ghost",
        "Featured artists: Kira",
        "Release: Night Tapes",
        "Genre: Synthwave",
        "Moods: chill, dark",
      ].join("\n"),
    );
  });

  it("is insensitive to mood order and duplicate moods", () => {
    const reordered = {
      ...base,
      release: { ...base.release, moods: ["chill", "DARK"] },
    };
    expect(trackEmbeddingText(reordered)).toBe(trackEmbeddingText(base));
  });

  it("prefers the credited artist and skips redundant or missing fields", () => {
    expect(
      trackEmbeddingText({
        title: "Solo",
        artist: "Track Artist",
        release: { title: "solo", genre: null, moods: [] },
      }),
    ).toBe("Title: Solo\nArtist: Track Artist");
  });

  it("falls back to the account display name and tolerates a missing release", () => {
    expect(
      trackEmbeddingText({
        title: "T",
        release: { artist: { displayName: "Account" } },
      }),
    ).toBe("Title: T\nArtist: Account");
    expect(trackEmbeddingText({ title: "T" })).toBe("Title: T");
  });
});

describe("trackEmbeddingContentHash", () => {
  it("is stable and changes with the text or the model", () => {
    const hash = trackEmbeddingContentHash("Title: A", "model-1");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(trackEmbeddingContentHash("Title: A", "model-1")).toBe(hash);
    expect(trackEmbeddingContentHash("Title: B", "model-1")).not.toBe(hash);
    expect(trackEmbeddingContentHash("Title: A", "model-2")).not.toBe(hash);
  });
});
