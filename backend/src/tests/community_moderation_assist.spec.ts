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
import { FakeDecisionClient, type FakeDecisionScript } from "../modules/shared/decision/fake_decision_client";
import { DisabledDecisionClient } from "../modules/shared/decision/decision_client";

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

  describe("decision strategy (#2584)", () => {
    const confidentUnfounded: FakeDecisionScript = {
      predicate: { answer: false, confidence: 0.95 },
      choice: { selected: ["other"], confidence: 0.9 },
      score: { scores: [{ id: "report", score: 0.1 }] },
    };

    function triage(script: FakeDecisionScript, input = quietInput()) {
      process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "decision";
      const client = new FakeDecisionClient(script);
      return { client, assist: new CommunityModerationAssistService(client).buildAssist(input) };
    }

    it("triages with three bounded calls and keeps the deterministic text", async () => {
      const { client, assist } = triage({
        predicate: { answer: true, confidence: 0.9 },
        choice: { selected: ["spam"], confidence: 0.9 },
        score: { scores: [{ id: "report", score: 0.8 }] },
      });
      const result = await assist;
      const deterministic = new CommunityModerationAssistService().deterministicAssist(quietInput());

      expect(result).toMatchObject({
        strategy: "decision",
        needsReview: true,
        severity: "high",
        likelihood: deterministic.likelihood,
        summary: deterministic.summary,
        reviewFocus: deterministic.reviewFocus,
        advisory: { noAutoEnforcement: true },
      });
      expect(result.reasonCodes).toEqual([...deterministic.reasonCodes, "spam_language_signal"]);
      expect(result.fallbackReason).toBeUndefined();
      expect(client.calls.map((call) => call.kind).sort()).toEqual(["choice", "predicate", "score"]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it("sends only the redacted, bounded context", async () => {
      const input = sampleInput();
      input.reason = "Contact reporter@example.com about 0x1111111111111111111111111111111111111111";
      const { client, assist } = triage(confidentUnfounded, input);
      await assist;

      const sent = JSON.stringify(client.calls.map((call) => call.request));
      expect(sent).toContain("[email redacted]");
      expect(sent).toContain("[wallet redacted]");
      expect(sent).not.toContain("reporter@example.com");
      expect(sent).not.toContain("reporter-user");
      expect(sent).not.toContain("message-author-user");
    });

    it("clears the review hint only on a confident no, and still changes nothing else", async () => {
      const result = await triage(confidentUnfounded).assist;
      expect(result).toMatchObject({
        strategy: "decision",
        needsReview: false,
        severity: "low",
        advisory: { noAutoEnforcement: true },
      });
    });

    it("never lowers the severity the deterministic signals gave", async () => {
      const result = await triage(confidentUnfounded, sampleInput()).assist;
      expect(result.severity).toBe("high");
      expect(result.reasonCodes).toEqual(
        expect.arrayContaining(["safety_language_signal", "privacy_language_signal"]),
      );
    });

    it("needs review when the no is not confident", async () => {
      const result = await triage({ ...confidentUnfounded, predicate: { answer: false, confidence: 0.79 } }).assist;
      expect(result).toMatchObject({ strategy: "decision", needsReview: true });
    });

    it("ignores a low-confidence category", async () => {
      const result = await triage({ ...confidentUnfounded, choice: { selected: ["privacy"], confidence: 0.4 } }).assist;
      expect(result.reasonCodes).not.toContain("privacy_language_signal");
    });

    it.each([
      ["a provider error", { fail: "provider_error" }, "decision_provider_error"],
      ["a timeout", { fail: "timeout" }, "decision_timeout"],
      ["no capacity", { fail: "over_capacity" }, "decision_over_capacity"],
      ["a malformed predicate", { ...confidentUnfounded, predicate: "not json" }, "decision_invalid_output"],
      ["an out-of-range confidence", { ...confidentUnfounded, predicate: { answer: false, confidence: 1.4 } }, "decision_invalid_output"],
      ["a category that was not offered", { ...confidentUnfounded, choice: { selected: ["harmless"], confidence: 0.99 } }, "decision_invalid_output"],
      ["an out-of-range severity", { ...confidentUnfounded, score: { scores: [{ id: "report", score: 7 }] } }, "decision_invalid_output"],
      ["a severity for another candidate", { ...confidentUnfounded, score: { scores: [{ id: "other", score: 0.1 }] } }, "decision_invalid_output"],
    ] as Array<[string, FakeDecisionScript, string]>)("fails closed on %s", async (_name, script, fallbackReason) => {
      const result = await triage(script).assist;
      expect(result).toMatchObject({ strategy: "deterministic", needsReview: true, fallbackReason });
    });

    it("fails closed when the client throws", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const { assist } = triage({
        ...confidentUnfounded,
        predicate: () => {
          throw new Error("boom");
        },
      });
      expect(await assist).toMatchObject({ strategy: "deterministic", needsReview: true, fallbackReason: "decision_error" });
    });

    it("fails closed when decisions are switched off or not wired", async () => {
      process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "decision";
      const disabled = await new CommunityModerationAssistService(new DisabledDecisionClient()).buildAssist(quietInput());
      expect(disabled).toMatchObject({ strategy: "deterministic", needsReview: true, fallbackReason: "decision_disabled" });
      const unwired = await new CommunityModerationAssistService().buildAssist(quietInput());
      expect(unwired).toMatchObject({ strategy: "deterministic", needsReview: true, fallbackReason: "decision_unavailable" });
    });

    it("keeps the queue cap: capped reports get no call and need review", async () => {
      process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY = "decision";
      const client = new FakeDecisionClient(confidentUnfounded);
      const result = await new CommunityModerationAssistService(client).buildAssist(quietInput(), { allowModel: false });
      expect(result).toMatchObject({ strategy: "deterministic", needsReview: true, fallbackReason: "model_assist_queue_cap" });
      expect(client.calls).toHaveLength(0);
    });

    it("adds no review hint outside the decision strategy", async () => {
      delete process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY;
      const result = await new CommunityModerationAssistService(new FakeDecisionClient(confidentUnfounded)).buildAssist(quietInput());
      expect(result.strategy).toBe("deterministic");
      expect(result).not.toHaveProperty("needsReview");
    });
  });
});

function quietInput() {
  const input = sampleInput();
  input.reason = "not sure about this one";
  return input;
}

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
