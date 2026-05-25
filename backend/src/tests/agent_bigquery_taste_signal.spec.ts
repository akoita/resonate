import {
  AgentBigQueryTasteQueryClient,
  AgentBigQueryTasteSignalConfig,
  AgentBigQueryTasteSignalService,
  agentBigQueryTasteSignalConfigFromEnv,
} from "../modules/agents/agent_bigquery_taste_signal.service";

describe("AgentBigQueryTasteSignalService", () => {
  const enabledConfig: AgentBigQueryTasteSignalConfig = {
    source: "bigquery",
    projectId: "analytics-project",
    datasetId: "analytics_dev",
    scoresTable: "user_track_recommendation_scores",
    apiBaseUrl: "http://bigquery.test",
    maximumBytesBilled: "123456",
    queryTimeoutMs: 5000,
    rowLimit: 50,
  };

  it("defaults to disabled taste signals", () => {
    expect(agentBigQueryTasteSignalConfigFromEnv({}).source).toBe("disabled");
    expect(agentBigQueryTasteSignalConfigFromEnv({
      AGENT_TASTE_SIGNAL_SOURCE: "bigquery",
      GCP_PROJECT_ID: "resonate-dev",
      ANALYTICS_WAREHOUSE_DATASET_PREFIX: "analytics_dev",
    })).toEqual(expect.objectContaining({
      source: "bigquery",
      projectId: "resonate-dev",
      datasetId: "analytics_dev",
      scoresTable: "user_track_recommendation_scores",
    }));
  });

  it("does not query BigQuery when disabled", async () => {
    const client = fakeClient([]);
    const service = new AgentBigQueryTasteSignalService({
      ...enabledConfig,
      source: "disabled",
    }, client);

    await expect(service.scoreTracks({
      userId: "user-1",
      trackIds: ["track-1"],
    })).resolves.toEqual(new Map());
    expect(client.query).not.toHaveBeenCalled();
  });

  it("loads bounded user-track scores from BigQuery", async () => {
    const client = fakeClient([{
      rows: [
        {
          trackId: "track-1",
          score: "0.82",
          confidence: "0.91",
          rank: "2",
          explanation: "matches repeated playlist saves",
          modelVersion: "bqml-mf-v1",
          updatedAt: "2026-05-23T00:00:00.000Z",
        },
        {
          trackId: "track-2",
          score: "1.7",
          confidence: "0.4",
          rank: "3",
        },
      ],
    }]);
    const service = new AgentBigQueryTasteSignalService(enabledConfig, client);

    const result = await service.scoreTracks({
      userId: "user-1",
      trackIds: ["track-1", "track-2", "track-1"],
    });

    expect(client.query).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "analytics-project",
      apiBaseUrl: "http://bigquery.test",
      maximumBytesBilled: "123456",
      timeoutMs: 5000,
      parameters: {
        userId: "user-1",
        trackIds: ["track-1", "track-2"],
        limit: 2,
      },
    }));
    expect(client.query).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.stringContaining("`analytics-project.analytics_dev.user_track_recommendation_scores`"),
    }));
    expect(result.get("track-1")).toEqual({
      trackId: "track-1",
      score: 0.82,
      confidence: 0.91,
      rank: 2,
      explanation: "matches repeated playlist saves",
      modelVersion: "bqml-mf-v1",
      updatedAt: "2026-05-23T00:00:00.000Z",
    });
    expect(result.get("track-2")?.score).toBe(1);
  });

  it("falls back to empty scores when BigQuery fails", async () => {
    const client = {
      query: jest.fn().mockRejectedValue(new Error("quota exceeded")),
    } satisfies AgentBigQueryTasteQueryClient;
    const service = new AgentBigQueryTasteSignalService(enabledConfig, client);

    await expect(service.scoreTracks({
      userId: "user-1",
      trackIds: ["track-1"],
    })).resolves.toEqual(new Map());
  });
});

function fakeClient(responses: Array<Awaited<ReturnType<AgentBigQueryTasteQueryClient["query"]>>>) {
  return {
    query: jest.fn(async () => responses.shift() ?? { rows: [] }),
  } satisfies AgentBigQueryTasteQueryClient;
}
