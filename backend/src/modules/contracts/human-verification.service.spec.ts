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

  it("falls back to mock when the configured provider is unavailable", () => {
    process.env = {
      ...originalEnv,
      HUMAN_VERIFICATION_PROVIDER: "passport",
    };

    const service = new HumanVerificationService();

    expect(service.getClientConfig()).toEqual({
      availableProviders: ["mock"],
      defaultProvider: "mock",
    });
  });

  it("exposes configured passport verification to the client", () => {
    process.env = {
      ...originalEnv,
      HUMAN_VERIFICATION_PROVIDER: "passport",
      GITCOIN_PASSPORT_API_KEY: "test-key",
      GITCOIN_PASSPORT_SCORER_ID: "test-scorer",
    };

    const service = new HumanVerificationService();

    expect(service.getClientConfig()).toEqual({
      availableProviders: ["passport", "mock"],
      defaultProvider: "passport",
    });
  });

  it("fails fast when the passport provider times out", async () => {
    process.env = {
      ...originalEnv,
      HUMAN_VERIFICATION_PROVIDER: "passport",
      GITCOIN_PASSPORT_API_KEY: "test-key",
      GITCOIN_PASSPORT_SCORER_ID: "test-scorer",
      HUMAN_VERIFICATION_TIMEOUT_MS: "50",
    };

    const timeoutError = new Error("timed out");
    timeoutError.name = "TimeoutError";
    global.fetch = jest.fn().mockRejectedValue(timeoutError) as any;

    const service = new HumanVerificationService();

    await expect(
      service.verify({
        walletAddress: "0xabc",
      }),
    ).rejects.toThrow("Gitcoin Passport timed out. Please try again.");
  });
});
