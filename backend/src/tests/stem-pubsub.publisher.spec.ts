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
});
