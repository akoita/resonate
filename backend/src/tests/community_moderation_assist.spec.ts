const mockGenerateContent = jest.fn();

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
  SchemaType: {
    OBJECT: "object",
    ARRAY: "array",
    STRING: "string",
    NUMBER: "number",
    INTEGER: "integer",
  },
}));

import { CommunityModerationAssistService } from "../modules/community/community_moderation_assist.service";

describe("CommunityModerationAssistService", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    mockGenerateContent.mockReset();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("defaults to deterministic assist without a model call", async () => {
    delete process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY;
    delete process.env.GOOGLE_AI_API_KEY;

    const assist = await new CommunityModerationAssistService().buildAssist(sampleInput());

    expect(assist).toMatchObject({
      strategy: "deterministic",
      severity: "high",
      likelihood: "medium",
      reasonCodes: expect.arrayContaining(["safety_language_signal", "privacy_language_signal"]),
      advisory: {
        noAutoEnforcement: true,
      },
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("uses model-backed summaries only when explicitly configured", async () => {
    process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "model-assisted";
    process.env.GOOGLE_AI_API_KEY = "test-key";
    process.env.COMMUNITY_MODERATION_ASSIST_MODEL = "test-moderation-model";
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: "Model summary: privacy concern plus repeated report context.",
          severity: "high",
          likelihood: "high",
          reasonCodes: ["privacy_language_signal", "invented_code"],
          reviewFocus: [
            "Confirm whether the preview exposes private data.",
            "Keep any enforcement decision human-confirmed.",
          ],
        }),
      },
    });

    const assist = await new CommunityModerationAssistService().buildAssist(sampleInput());

    expect(assist).toMatchObject({
      strategy: "model-assisted",
      model: "test-moderation-model",
      summary: "Model summary: privacy concern plus repeated report context.",
      severity: "high",
      likelihood: "high",
      reasonCodes: expect.arrayContaining(["privacy_language_signal", "safety_language_signal"]),
      advisory: { noAutoEnforcement: true },
    });
    expect(assist.reasonCodes).not.toContain("invented_code");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("redacts sensitive values and omits unbounded/private fields from the model prompt", async () => {
    process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "model-assisted";
    process.env.GOOGLE_AI_API_KEY = "test-key";
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: "Safe bounded summary.",
          severity: "medium",
          likelihood: "medium",
          reasonCodes: ["privacy_language_signal"],
          reviewFocus: ["Review the bounded preview."],
        }),
      },
    });
    const input = sampleInput();
    input.reason = "User shared ada@example.com and 0x1111111111111111111111111111111111111111.";
    input.message!.bodyPreview = "Preview mentions bob@example.com and 0x2222222222222222222222222222222222222222.";
    (input.message as any).body = "FULL_UNBOUNDED_THREAD_BODY_SHOULD_NOT_LEAVE_SERVICE";
    (input.room as any).accessPolicyJson = { secret: "ACCESS_POLICY_SECRET_SHOULD_NOT_LEAVE_SERVICE" };

    await new CommunityModerationAssistService().buildAssist(input);

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain("[email redacted]");
    expect(prompt).toContain("[wallet redacted]");
    expect(prompt).not.toContain("ada@example.com");
    expect(prompt).not.toContain("bob@example.com");
    expect(prompt).not.toContain("0x1111111111111111111111111111111111111111");
    expect(prompt).not.toContain("0x2222222222222222222222222222222222222222");
    expect(prompt).not.toContain("FULL_UNBOUNDED_THREAD_BODY_SHOULD_NOT_LEAVE_SERVICE");
    expect(prompt).not.toContain("ACCESS_POLICY_SECRET_SHOULD_NOT_LEAVE_SERVICE");
    expect(prompt).not.toContain(input.reporterUserId ?? "reporter-user");
    expect(prompt).not.toContain(input.message!.authorUserId);
  });

  it("falls back to deterministic assist when model output is malformed", async () => {
    process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "model-assisted";
    process.env.GOOGLE_AI_API_KEY = "test-key";
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => "{not-json",
      },
    });

    const assist = await new CommunityModerationAssistService().buildAssist(sampleInput());

    expect(assist).toMatchObject({
      strategy: "deterministic",
      fallbackReason: "model_assist_failure",
      summary: "Report mentions possible privacy exposure. Review the preview before choosing any action.",
    });
  });

  it("falls back to deterministic assist when the model times out", async () => {
    jest.useFakeTimers();
    process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "model-assisted";
    process.env.GOOGLE_AI_API_KEY = "test-key";
    process.env.COMMUNITY_MODERATION_ASSIST_TIMEOUT_MS = "1000";
    mockGenerateContent.mockReturnValue(new Promise(() => undefined));

    const assistPromise = new CommunityModerationAssistService().buildAssist(sampleInput());
    await Promise.resolve();
    jest.advanceTimersByTime(1000);

    await expect(assistPromise).resolves.toMatchObject({
      strategy: "deterministic",
      fallbackReason: "model_assist_failure",
    });
  });

  it("can skip model calls for reports beyond the queue cap", async () => {
    process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "model-assisted";
    process.env.GOOGLE_AI_API_KEY = "test-key";

    const assist = await new CommunityModerationAssistService().buildAssist(sampleInput(), { allowModel: false });

    expect(assist).toMatchObject({
      strategy: "deterministic",
      fallbackReason: "model_assist_queue_cap",
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("clamps the per-queue model assist cap", () => {
    const service = new CommunityModerationAssistService();

    delete process.env.COMMUNITY_MODERATION_ASSIST_MAX_MODEL_REPORTS;
    expect(service.maxModelAssistsPerQueue()).toBe(10);

    process.env.COMMUNITY_MODERATION_ASSIST_MAX_MODEL_REPORTS = "0";
    expect(service.maxModelAssistsPerQueue()).toBe(0);

    process.env.COMMUNITY_MODERATION_ASSIST_MAX_MODEL_REPORTS = "999";
    expect(service.maxModelAssistsPerQueue()).toBe(25);
  });

  it("limits concurrent model calls", async () => {
    process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "model-assisted";
    process.env.GOOGLE_AI_API_KEY = "test-key";
    process.env.COMMUNITY_MODERATION_ASSIST_CONCURRENCY = "2";

    let activeCalls = 0;
    let maxActiveCalls = 0;
    mockGenerateContent.mockImplementation(async () => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 15));
      activeCalls -= 1;
      return {
        response: {
          text: () => JSON.stringify({
            summary: "Safe bounded summary.",
            severity: "medium",
            likelihood: "medium",
            reasonCodes: ["privacy_language_signal"],
            reviewFocus: ["Review the bounded preview."],
          }),
        },
      };
    });

    const service = new CommunityModerationAssistService();
    await Promise.all(Array.from({ length: 6 }, () => service.buildAssist(sampleInput())));

    expect(mockGenerateContent).toHaveBeenCalledTimes(6);
    expect(maxActiveCalls).toBeLessThanOrEqual(2);
  });
});

function sampleInput() {
  return {
    reason: "harassment and doxxing review",
    reporterUserId: "reporter-user",
    room: {
      id: "room-1",
      roomType: "artist_public",
      ownerType: "artist",
      ownerId: "artist-1",
      artistId: "artist-1",
      title: "Governance Review Room",
      status: "active",
      createdAt: "2026-06-04T08:00:00.000Z",
      updatedAt: "2026-06-04T08:00:00.000Z",
    },
    message: {
      id: "message-1",
      roomId: "room-1",
      authorUserId: "message-author-user",
      bodyPreview: "This reported message should appear as a preview only.",
      messageType: "message",
      status: "visible",
      createdAt: "2026-06-04T08:00:00.000Z",
      updatedAt: "2026-06-04T08:00:00.000Z",
      deletedAt: null,
    },
    context: {
      roomOpenReports: 1,
      messageReportCount: 1,
      roomMembershipsByStatus: { active: 2 },
    },
  };
}
