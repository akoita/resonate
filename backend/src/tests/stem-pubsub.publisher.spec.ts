const mockGetRequestHeaders = jest.fn();

jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: jest.fn().mockResolvedValue({
      getRequestHeaders: mockGetRequestHeaders,
    }),
  })),
}));

import { StemPubSubPublisher } from "../modules/ingestion/stem-pubsub.publisher";

describe("StemPubSubPublisher Cloud Run Job trigger", () => {
  const envSnapshot = { ...process.env };
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...envSnapshot };
    delete process.env.DEMUCS_CLOUD_RUN_JOB_PROJECT;
    delete process.env.DEMUCS_CLOUD_RUN_JOB_REGION;
    delete process.env.DEMUCS_CLOUD_RUN_JOB_NAME;
    delete process.env.GCP_PROJECT_ID;
    mockGetRequestHeaders.mockResolvedValue({ authorization: "Bearer token" });
    fetchMock.mockResolvedValue({ ok: true });
    (global as any).fetch = fetchMock;
  });

  afterAll(() => {
    process.env = envSnapshot;
  });

  function publisherWithTopic() {
    const publisher = new StemPubSubPublisher();
    (publisher as any).separateTopic = {
      publishMessage: jest.fn().mockResolvedValue("msg-1"),
    };
    return publisher;
  }

  const message = {
    jobId: "sep_rel_trk",
    releaseId: "rel",
    artistId: "artist",
    trackId: "trk",
    originalStemUri: "gs://bucket/original.mp3",
    mimeType: "audio/mpeg",
  };

  it("publishes without triggering a Cloud Run Job when job env is absent", async () => {
    const publisher = publisherWithTopic();

    await expect(publisher.publishSeparationJob(message)).resolves.toBe("msg-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs the configured Cloud Run Job after publishing the Pub/Sub message", async () => {
    process.env.GCP_PROJECT_ID = "resonate-staging";
    process.env.DEMUCS_CLOUD_RUN_JOB_REGION = "europe-west1";
    process.env.DEMUCS_CLOUD_RUN_JOB_NAME = "resonate-staging-demucs";
    const publisher = publisherWithTopic();

    await expect(publisher.publishSeparationJob(message)).resolves.toBe("msg-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://run.googleapis.com/v2/projects/resonate-staging/locations/europe-west1/jobs/resonate-staging-demucs:run",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          authorization: "Bearer token",
          "content-type": "application/json",
        }),
      }),
    );
  });

  describe("publishAnalysisJob (#2013)", () => {
    const analyzeMessage = {
      kind: "analyze" as const,
      jobId: "analyze_1_abcd1234",
      stems: [{ stemId: "stem_1", uri: "https://storage.googleapis.com/b/o.mp3", mimeType: "audio/mpeg" }],
    };

    it("reports availability from the initialized topic", () => {
      expect(new StemPubSubPublisher().isAvailable()).toBe(false);
      expect(publisherWithTopic().isAvailable()).toBe(true);
    });

    it("throws when the publisher is not initialized", async () => {
      await expect(new StemPubSubPublisher().publishAnalysisJob(analyzeMessage)).rejects.toThrow(
        /Pub\/Sub publisher is not initialized/,
      );
    });

    it("publishes with the kind attribute and runs the Cloud Run Job", async () => {
      process.env.GCP_PROJECT_ID = "resonate-staging";
      process.env.DEMUCS_CLOUD_RUN_JOB_REGION = "europe-west1";
      process.env.DEMUCS_CLOUD_RUN_JOB_NAME = "resonate-staging-demucs";
      const publisher = publisherWithTopic();

      await expect(publisher.publishAnalysisJob(analyzeMessage)).resolves.toBe("msg-1");

      const publishMessage = (publisher as any).separateTopic.publishMessage;
      expect(publishMessage).toHaveBeenCalledTimes(1);
      const arg = publishMessage.mock.calls[0][0];
      expect(arg.attributes).toEqual({ jobId: "analyze_1_abcd1234", kind: "analyze" });
      expect(JSON.parse(arg.data.toString())).toEqual(analyzeMessage);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://run.googleapis.com/v2/projects/resonate-staging/locations/europe-west1/jobs/resonate-staging-demucs:run",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
