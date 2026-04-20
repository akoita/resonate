const mockGetClient = jest.fn();
const mockGetProjectId = jest.fn();

jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: mockGetClient,
    getProjectId: mockGetProjectId,
  })),
}));

import { resolvePubSubRuntimeConfig } from "../modules/ingestion/pubsub-runtime";

describe("resolvePubSubRuntimeConfig", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...envSnapshot };
    delete process.env.PUBSUB_EMULATOR_HOST;
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
  });

  afterAll(() => {
    process.env = envSnapshot;
  });

  it("uses the emulator when PUBSUB_EMULATOR_HOST is set", async () => {
    process.env.PUBSUB_EMULATOR_HOST = "localhost:8085";

    await expect(resolvePubSubRuntimeConfig()).resolves.toEqual({
      enabled: true,
      projectId: "resonate-local",
    });
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it("accepts ADC without GOOGLE_APPLICATION_CREDENTIALS when Cloud Run auth is available", async () => {
    mockGetClient.mockResolvedValue({});
    mockGetProjectId.mockResolvedValue("resonate-staging");

    await expect(resolvePubSubRuntimeConfig()).resolves.toEqual({
      enabled: true,
      projectId: "resonate-staging",
    });
  });

  it("prefers an explicit GCP project id when provided", async () => {
    process.env.GCP_PROJECT_ID = "resonate-explicit";
    mockGetClient.mockResolvedValue({});

    await expect(resolvePubSubRuntimeConfig()).resolves.toEqual({
      enabled: true,
      projectId: "resonate-explicit",
    });
    expect(mockGetProjectId).not.toHaveBeenCalled();
  });

  it("disables Pub/Sub cleanly when neither emulator nor ADC is available", async () => {
    mockGetClient.mockRejectedValue(new Error("Could not load the default credentials"));

    const result = await resolvePubSubRuntimeConfig();
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain("No Pub/Sub auth detected");
    expect(result.reason).toContain("Could not load the default credentials");
  });
});
