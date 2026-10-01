import { TRACK_EMBEDDING_DIMENSION } from "../modules/embeddings/embedding.config";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { VertexEmbeddingClient } from "../modules/embeddings/vertex_embedding.client";

const getAccessToken = jest.fn();
jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: async () => ({ getAccessToken }),
  })),
}));

const target = {
  projectId: "test-project",
  location: "us-central1",
  model: "text-multilingual-embedding-002",
};

const vector = () => new Array(TRACK_EMBEDDING_DIMENSION).fill(0.5);

function okResponse(count: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      predictions: Array.from({ length: count }, () => ({
        embeddings: { values: vector() },
      })),
    }),
  };
}

describe("VertexEmbeddingClient", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    getAccessToken.mockResolvedValue({ token: "test-token" });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("shapes the predict request for documents", async () => {
    fetchMock.mockResolvedValue(okResponse(2));
    const result = await new VertexEmbeddingClient().embed(
      target,
      ["Title: A", "Title: B"],
      "RETRIEVAL_DOCUMENT",
    );

    expect(result).toHaveLength(2);
    expect(result?.[0]).toHaveLength(TRACK_EMBEDDING_DIMENSION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/text-multilingual-embedding-002:predict",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body)).toEqual({
      instances: [
        { content: "Title: A", task_type: "RETRIEVAL_DOCUMENT" },
        { content: "Title: B", task_type: "RETRIEVAL_DOCUMENT" },
      ],
      parameters: { outputDimensionality: 768, autoTruncate: true },
    });
  });

  it("uses the query task type for queries", async () => {
    fetchMock.mockResolvedValue(okResponse(1));
    await new VertexEmbeddingClient().embed(target, ["calm"], "RETRIEVAL_QUERY");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).instances).toEqual([
      { content: "calm", task_type: "RETRIEVAL_QUERY" },
    ]);
  });

  it("batches at most 16 instances per request and preserves order", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) =>
      okResponse(JSON.parse(init.body).instances.length),
    );
    const texts = Array.from({ length: 37 }, (_, i) => `text ${i}`);
    const result = await new VertexEmbeddingClient().embed(
      target,
      texts,
      "RETRIEVAL_DOCUMENT",
    );

    expect(result).toHaveLength(37);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init.body).instances.length,
    );
    expect(sizes).toEqual([16, 16, 5]);
  });

  it("makes no request for an empty input", async () => {
    await expect(
      new VertexEmbeddingClient().embed(target, [], "RETRIEVAL_DOCUMENT"),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on an HTTP error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(
      new VertexEmbeddingClient().embed(target, ["a"], "RETRIEVAL_DOCUMENT"),
    ).resolves.toBeNull();
  });

  it("returns null when fetch rejects or times out", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );
    await expect(
      new VertexEmbeddingClient().embed(target, ["a"], "RETRIEVAL_DOCUMENT"),
    ).resolves.toBeNull();
  });

  it("aborts a hung request after the timeout", async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );
      const pending = new VertexEmbeddingClient().embed(
        target,
        ["a"],
        "RETRIEVAL_DOCUMENT",
      );
      await jest.advanceTimersByTimeAsync(15_001);
      await expect(pending).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns null when no access token is available", async () => {
    getAccessToken.mockResolvedValue({ token: null });
    await expect(
      new VertexEmbeddingClient().embed(target, ["a"], "RETRIEVAL_DOCUMENT"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for malformed responses (count or dimension mismatch)", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(2));
    await expect(
      new VertexEmbeddingClient().embed(target, ["a"], "RETRIEVAL_DOCUMENT"),
    ).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        predictions: [{ embeddings: { values: [0.1, 0.2] } }],
      }),
    });
    await expect(
      new VertexEmbeddingClient().embed(target, ["a"], "RETRIEVAL_DOCUMENT"),
    ).resolves.toBeNull();
  });

  it("fails the whole call when any batch fails", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(16))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      new VertexEmbeddingClient().embed(
        target,
        Array.from({ length: 20 }, (_, i) => `t${i}`),
        "RETRIEVAL_DOCUMENT",
      ),
    ).resolves.toBeNull();
  });
});

describe("EmbeddingService vertex mode", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    getAccessToken.mockResolvedValue({ token: "test-token" });
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.TRACK_EMBEDDING_PROVIDER = "vertex";
    process.env.GCP_PROJECT_ID = "test-project";
    process.env.TRACK_EMBEDDING_MODEL = "custom-model";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("sends documents to the configured model and never throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(1));
    const service = new EmbeddingService();
    expect(service.modelId).toBe("custom-model");
    await expect(service.embedDocuments(["x"])).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/models/custom-model:predict");

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(service.embedQuery("x")).resolves.toBeNull();
  });
});
