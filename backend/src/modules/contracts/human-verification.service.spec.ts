import { HumanVerificationService } from "./human-verification.service";

describe("HumanVerificationService", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("verifies mock proofs with the configured token", async () => {
    process.env = {
      ...originalEnv,
      HUMAN_VERIFICATION_PROVIDER: "mock",
      HUMAN_VERIFICATION_MOCK_PROOF: "resonate-human",
    };

    const service = new HumanVerificationService();
    const result = await service.verify({
      walletAddress: "0xabc",
      proof: "resonate-human",
    });

    expect(result.verified).toBe(true);
    expect(result.provider).toBe("mock");
  });

  it("verifies passport scores against the configured threshold", async () => {
    process.env = {
      ...originalEnv,
      HUMAN_VERIFICATION_PROVIDER: "passport",
      GITCOIN_PASSPORT_API_KEY: "test-key",
      GITCOIN_PASSPORT_SCORER_ID: "test-scorer",
      GITCOIN_PASSPORT_THRESHOLD: "20",
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ score: 21.5 }),
    } as any);

    const service = new HumanVerificationService();
    const result = await service.verify({
      walletAddress: "0xabc",
    });

    expect(result.provider).toBe("passport");
    expect(result.verified).toBe(true);
    expect(result.score).toBe(21.5);
  });
});
