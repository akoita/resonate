import { ConfigService } from "@nestjs/config";
import {
  getSignupFaucetConfig,
  SignupFaucetService,
  type SignupFaucetSender,
  type SignupFaucetStore,
} from "../modules/auth/signup_faucet.service";

const WALLET = "0x00000000000000000000000000000000000000aa";
const FUNDER_KEY = "test-funder-key";

function config(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

class MemoryStore implements SignupFaucetStore {
  private readonly attempts = new Map<string, { id: string; status: string; txHash?: string | null; userId: string; chainId: number; purpose: string }>();
  verifiedWallet: { address: string; chainId: number } | null = null;
  fundedToday = 0;
  readonly sent: Array<{ id: string; txHash: string }> = [];
  readonly failed: Array<{ id: string; reason: string }> = [];

  async createPending(input: {
    userId: string;
    walletAddress: string;
    chainId: number;
    amountWei: string;
    purpose: string;
  }) {
    const key = `${input.userId}:${input.walletAddress}:${input.chainId}:${input.purpose}`;
    const existing = this.attempts.get(key);
    if (existing) {
      if (existing.status === "failed") {
        existing.status = "pending";
        existing.txHash = null;
        return { created: true, attempt: existing };
      }
      return { created: false, attempt: existing };
    }
    const attempt = {
      id: `attempt-${this.attempts.size + 1}`,
      status: "pending",
      txHash: null,
      userId: input.userId,
      chainId: input.chainId,
      purpose: input.purpose,
    };
    this.attempts.set(key, attempt);
    return { created: true, attempt };
  }

  async markSent(id: string, txHash: `0x${string}`) {
    this.sent.push({ id, txHash });
    this.findAttempt(id).status = "sent";
    this.findAttempt(id).txHash = txHash;
  }

  async markFailed(id: string, reason: string) {
    this.failed.push({ id, reason });
    this.findAttempt(id).status = "failed";
  }

  async countAccountsFundedSince() {
    const users = new Set(
      [...this.attempts.values()]
        .filter((attempt) => attempt.status === "pending" || attempt.status === "sent")
        .map((attempt) => attempt.userId),
    );
    return this.fundedToday + users.size;
  }

  async listForUser(userId: string, chainId: number) {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.userId === userId && attempt.chainId === chainId)
      .map(({ purpose, status }) => ({ purpose, status }));
  }

  async findVerifiedWallet() {
    return this.verifiedWallet;
  }

  private findAttempt(id: string) {
    for (const attempt of this.attempts.values()) {
      if (attempt.id === id) return attempt;
    }
    throw new Error(`Attempt ${id} not found`);
  }
}

class MemorySender implements SignupFaucetSender {
  readonly calls: Array<{ to: string; amountWei: bigint; chainId: number }> = [];
  readonly tokenCalls: Array<{ token: string; to: string; amount: bigint; chainId: number }> = [];
  failWith?: Error;
  failTokenWith?: Error;

  async sendErc20(input: {
    chainId: number;
    token: `0x${string}`;
    to: `0x${string}`;
    amount: bigint;
  }): Promise<`0x${string}`> {
    this.tokenCalls.push({ token: input.token, to: input.to, amount: input.amount, chainId: input.chainId });
    if (this.failTokenWith) throw this.failTokenWith;
    return "0xusdc";
  }

  async sendEth(input: {
    chainId: number;
    to: `0x${string}`;
    amountWei: bigint;
  }): Promise<`0x${string}`> {
    this.calls.push({ to: input.to, amountWei: input.amountWei, chainId: input.chainId });
    if (this.failWith) throw this.failWith;
    return "0xtx";
  }
}

function enabledConfig(overrides: Record<string, string | undefined> = {}) {
  return config({
    SIGNUP_FAUCET_ENABLED: "true",
    SIGNUP_FAUCET_FUNDER_PRIVATE_KEY: FUNDER_KEY,
    SIGNUP_FAUCET_RPC_URL: "https://sepolia.example",
    ...overrides,
  });
}

function makeService(values = enabledConfig()) {
  const store = new MemoryStore();
  const sender = new MemorySender();
  const service = new SignupFaucetService(values, store, sender);
  return { service, store, sender };
}

describe("SignupFaucetService", () => {
  it("parses disabled-by-default config with 0.1 ETH amount", () => {
    const parsed = getSignupFaucetConfig(config({}));
    expect(parsed.enabled).toBe(false);
    expect(parsed.chainId).toBe(11155111);
    expect(parsed.amountWei).toBe("100000000000000000");
  });

  it("defaults the faucet chain to the active verified chain", () => {
    const parsed = getSignupFaucetConfig(config({
      SIGNUP_FAUCET_ENABLED: "true",
      SIGNUP_SEPOLIA_FAUCET_CHAIN_ID: "11155111",
      X402_NETWORK: "eip155:11155111",
    }), 84532);

    expect(parsed.enabled).toBe(true);
    expect(parsed.chainId).toBe(84532);
    expect(parsed.rpcUrl).toBe("https://sepolia.base.org");
  });

  it("prefers the active chain-specific RPC over generic RPC_URL for Base Sepolia", () => {
    const parsed = getSignupFaucetConfig(config({
      RPC_URL: "https://sepolia.example",
      BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example",
    }), 84532);

    expect(parsed.chainId).toBe(84532);
    expect(parsed.rpcUrl).toBe("https://base-sepolia.example");
  });

  it("honors an explicit generic faucet chain override", () => {
    const parsed = getSignupFaucetConfig(config({
      SIGNUP_FAUCET_CHAIN_ID: "8453",
      BASE_RPC_URL: "https://base.example",
    }), 84532);

    expect(parsed.chainId).toBe(8453);
    expect(parsed.rpcUrl).toBe("https://base.example");
  });

  it("supports legacy Sepolia-prefixed faucet env vars", () => {
    const parsed = getSignupFaucetConfig(config({
      SIGNUP_SEPOLIA_FAUCET_ENABLED: "true",
      SIGNUP_SEPOLIA_FAUCET_AMOUNT_ETH: "0.02",
      SIGNUP_SEPOLIA_FAUCET_CHAIN_ID: "11155111",
      SIGNUP_SEPOLIA_FAUCET_RPC_URL: "https://legacy-sepolia.example",
      SIGNUP_SEPOLIA_FAUCET_FUNDER_PRIVATE_KEY: FUNDER_KEY,
    }));

    expect(parsed.enabled).toBe(true);
    expect(parsed.chainId).toBe(11155111);
    expect(parsed.amountWei).toBe("20000000000000000");
    expect(parsed.rpcUrl).toBe("https://legacy-sepolia.example");
    expect(parsed.funderPrivateKey).toBe(`0x${FUNDER_KEY}`);
  });

  it("skips when the auth flow is not signup registration", async () => {
    const { service, sender } = makeService();

    const result = await service.maybeFundOnSignup({
      authMode: "login",
      requestedChainId: 11155111,
      verifiedChainId: 11155111,
      userId: WALLET,
      walletAddress: WALLET,
    });

    expect(result).toEqual({ status: "skipped", reason: "not_signup" });
    expect(sender.calls).toHaveLength(0);
  });

  it("skips when the feature flag is disabled", async () => {
    const { service, sender } = makeService(config({ SIGNUP_FAUCET_ENABLED: "false" }));

    const result = await service.maybeFundOnSignup({
      authMode: "register",
      requestedChainId: 11155111,
      verifiedChainId: 11155111,
      userId: WALLET,
      walletAddress: WALLET,
    });

    expect(result).toEqual({ status: "skipped", reason: "disabled" });
    expect(sender.calls).toHaveLength(0);
  });

  it("skips when the connected chain is not Sepolia", async () => {
    const { service, sender } = makeService();

    const result = await service.maybeFundOnSignup({
      authMode: "register",
      requestedChainId: 84532,
      verifiedChainId: 11155111,
      userId: WALLET,
      walletAddress: WALLET,
    });

    expect(result).toEqual({ status: "skipped", reason: "request_chain_mismatch" });
    expect(sender.calls).toHaveLength(0);
  });

  it("funds on the active verified chain when no faucet chain override is configured", async () => {
    const { service, sender } = makeService(enabledConfig({
      SIGNUP_FAUCET_CHAIN_ID: undefined,
    }));

    const result = await service.maybeFundOnSignup({
      authMode: "register",
      requestedChainId: 84532,
      verifiedChainId: 84532,
      userId: WALLET,
      walletAddress: WALLET,
    });

    expect(result).toEqual({
      status: "sent",
      txHash: "0xtx",
      chainId: 84532,
      amountEth: "0.1",
    });
    expect(sender.calls).toEqual([
      { to: "0x00000000000000000000000000000000000000AA", amountWei: 100000000000000000n, chainId: 84532 },
    ]);
  });

  it("sends 0.1 Sepolia ETH once for a matching signup", async () => {
    const { service, store, sender } = makeService();

    const input = {
      authMode: "register" as const,
      requestedChainId: 11155111,
      verifiedChainId: 11155111,
      userId: WALLET,
      walletAddress: WALLET,
    };

    const first = await service.maybeFundOnSignup(input);
    const second = await service.maybeFundOnSignup(input);

    expect(first).toEqual({
      status: "sent",
      txHash: "0xtx",
      chainId: 11155111,
      amountEth: "0.1",
    });
    expect(second).toEqual({ status: "skipped", reason: "already_attempted" });
    expect(sender.calls).toEqual([
      { to: "0x00000000000000000000000000000000000000AA", amountWei: 100000000000000000n, chainId: 11155111 },
    ]);
    expect(store.sent).toEqual([{ id: "attempt-1", txHash: "0xtx" }]);
  });

  it("records a failed funding attempt without throwing", async () => {
    const { service, store, sender } = makeService();
    sender.failWith = new Error("insufficient funds");

    const result = await service.maybeFundOnSignup({
      authMode: "register",
      requestedChainId: 11155111,
      verifiedChainId: 11155111,
      userId: WALLET,
      walletAddress: WALLET,
    });

    expect(result).toEqual({ status: "failed", reason: "insufficient funds" });
    expect(store.failed).toEqual([{ id: "attempt-1", reason: "insufficient funds" }]);
  });

  it("retries a failed funding attempt after configuration or balance is fixed", async () => {
    const { service, store, sender } = makeService();
    sender.failWith = new Error("insufficient funds");
    const input = {
      authMode: "register" as const,
      requestedChainId: 11155111,
      verifiedChainId: 11155111,
      userId: WALLET,
      walletAddress: WALLET,
    };

    const first = await service.maybeFundOnSignup(input);
    sender.failWith = undefined;
    const second = await service.maybeFundOnSignup(input);

    expect(first).toEqual({ status: "failed", reason: "insufficient funds" });
    expect(second).toEqual({
      status: "sent",
      txHash: "0xtx",
      chainId: 11155111,
      amountEth: "0.1",
    });
    expect(sender.calls).toHaveLength(2);
    expect(store.failed).toEqual([{ id: "attempt-1", reason: "insufficient funds" }]);
    expect(store.sent).toEqual([{ id: "attempt-1", txHash: "0xtx" }]);
  });

  it("records a failed attempt when the funder key is missing", async () => {
    const { service, store, sender } = makeService(enabledConfig({
      SIGNUP_FAUCET_FUNDER_PRIVATE_KEY: undefined,
    }));

    const result = await service.maybeFundOnSignup({
      authMode: "register",
      requestedChainId: 11155111,
      verifiedChainId: 11155111,
      userId: WALLET,
      walletAddress: WALLET,
    });

    expect(result).toEqual({ status: "failed", reason: "missing_funder_private_key" });
    expect(sender.calls).toHaveLength(0);
    expect(store.failed).toEqual([{ id: "attempt-1", reason: "missing_funder_private_key" }]);
  });

  describe("welcome test USDC, daily limit and test-network guard", () => {
    const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const BASE_SEPOLIA = 84532;

    function welcomeConfig(overrides: Record<string, string | undefined> = {}) {
      return enabledConfig({
        SIGNUP_FAUCET_CHAIN_ID: String(BASE_SEPOLIA),
        SIGNUP_FAUCET_AMOUNT_ETH: "0.002",
        SIGNUP_FAUCET_USDC_AMOUNT: "20",
        SHOWS_DEFAULT_PAYMENT_TOKEN_ADDRESS: USDC,
        ...overrides,
      });
    }

    const signup = {
      authMode: "register" as const,
      requestedChainId: BASE_SEPOLIA,
      verifiedChainId: BASE_SEPOLIA,
      userId: WALLET,
      walletAddress: WALLET,
    };

    it("parses the USDC amount in 6-decimal units and falls back to the Shows payment token", () => {
      const parsed = getSignupFaucetConfig(welcomeConfig(), BASE_SEPOLIA);
      expect(parsed.amountUsdc).toBe("20");
      expect(parsed.amountUsdcUnits).toBe("20000000");
      expect(parsed.usdcTokenAddress).toBe(USDC);
      expect(parsed.dailyLimit).toBe(25);
    });

    it("ignores a malformed USDC amount", () => {
      const parsed = getSignupFaucetConfig(welcomeConfig({ SIGNUP_FAUCET_USDC_AMOUNT: "-5" }), BASE_SEPOLIA);
      expect(parsed.amountUsdcUnits).toBe("0");
    });

    it("sends both ETH and test USDC once at sign-up", async () => {
      const { service, sender } = makeService(welcomeConfig());

      const first = await service.maybeFundOnSignup(signup);
      const second = await service.maybeFundOnSignup(signup);

      expect(first).toEqual({
        status: "sent",
        chainId: BASE_SEPOLIA,
        txHash: "0xtx",
        amountEth: "0.002",
        usdcTxHash: "0xusdc",
        amountUsdc: "20",
      });
      expect(second).toEqual({ status: "skipped", reason: "already_attempted" });
      expect(sender.calls).toHaveLength(1);
      expect(sender.tokenCalls).toEqual([
        { token: USDC, to: "0x00000000000000000000000000000000000000AA", amount: 20000000n, chainId: BASE_SEPOLIA },
      ]);
    });

    it("sends only test USDC when the ETH amount is zero (gas is sponsored)", async () => {
      const { service, sender } = makeService(welcomeConfig({ SIGNUP_FAUCET_AMOUNT_ETH: "0" }));

      const result = await service.maybeFundOnSignup(signup);

      expect(result).toEqual({ status: "sent", chainId: BASE_SEPOLIA, usdcTxHash: "0xusdc", amountUsdc: "20" });
      expect(sender.calls).toHaveLength(0);
    });

    it("still reports the ETH leg when the USDC leg fails", async () => {
      const { service, sender } = makeService(welcomeConfig());
      sender.failTokenWith = new Error("transfer amount exceeds balance");

      const result = await service.maybeFundOnSignup(signup);

      expect(result).toEqual({ status: "sent", chainId: BASE_SEPOLIA, txHash: "0xtx", amountEth: "0.002" });
    });

    it("never pays on a network that is not a test network", async () => {
      const { service, sender } = makeService(welcomeConfig({ SIGNUP_FAUCET_CHAIN_ID: "8453" }));

      const result = await service.maybeFundOnSignup({ ...signup, requestedChainId: 8453, verifiedChainId: 8453 });

      expect(result).toEqual({ status: "skipped", reason: "not_a_test_network" });
      expect(sender.calls).toHaveLength(0);
      expect(sender.tokenCalls).toHaveLength(0);
    });

    it("stops new accounts once the daily limit is reached", async () => {
      const { service, store, sender } = makeService(welcomeConfig({ SIGNUP_FAUCET_DAILY_LIMIT: "3" }));
      store.fundedToday = 3;

      const result = await service.maybeFundOnSignup(signup);

      expect(result).toEqual({ status: "skipped", reason: "daily_limit" });
      expect(sender.calls).toHaveLength(0);
    });

    it("a daily limit of 0 pauses the faucet", async () => {
      const { service, sender } = makeService(welcomeConfig({ SIGNUP_FAUCET_DAILY_LIMIT: "0" }));

      expect(await service.maybeFundOnSignup(signup)).toEqual({ status: "skipped", reason: "daily_limit" });
      expect(sender.calls).toHaveLength(0);
    });

    it("lets an account that missed its welcome money claim it from the Wallet page", async () => {
      const { service, store, sender } = makeService(welcomeConfig());
      store.verifiedWallet = { address: WALLET, chainId: BASE_SEPOLIA };

      const before = await service.getWelcomeFundsStatus(WALLET);
      const claim = await service.claimWelcomeFunds(WALLET);
      const after = await service.getWelcomeFundsStatus(WALLET);
      const again = await service.claimWelcomeFunds(WALLET);

      expect(before).toEqual({
        available: true,
        chainId: BASE_SEPOLIA,
        amountEth: "0.002",
        amountUsdc: "20",
        eth: null,
        usdc: null,
        canClaim: true,
      });
      expect(claim).toMatchObject({ status: "sent", amountUsdc: "20", amountEth: "0.002" });
      expect(after).toMatchObject({ eth: "sent", usdc: "sent", canClaim: false });
      expect(again).toEqual({ status: "skipped", reason: "already_attempted" });
      expect(sender.tokenCalls).toHaveLength(1);
    });

    it("retries only the leg that failed", async () => {
      const { service, store, sender } = makeService(welcomeConfig());
      store.verifiedWallet = { address: WALLET, chainId: BASE_SEPOLIA };
      sender.failTokenWith = new Error("transfer amount exceeds balance");
      await service.maybeFundOnSignup(signup);
      expect(await service.getWelcomeFundsStatus(WALLET)).toMatchObject({ eth: "sent", usdc: "failed", canClaim: true });

      sender.failTokenWith = undefined;
      const claim = await service.claimWelcomeFunds(WALLET);

      expect(claim).toEqual({ status: "sent", chainId: BASE_SEPOLIA, usdcTxHash: "0xusdc", amountUsdc: "20" });
      expect(sender.calls).toHaveLength(1);
    });

    it("refuses a claim without a sign-in verified wallet", async () => {
      const { service, sender } = makeService(welcomeConfig());

      expect(await service.claimWelcomeFunds(WALLET)).toEqual({ status: "skipped", reason: "no_verified_wallet" });
      expect(await service.getWelcomeFundsStatus(WALLET)).toMatchObject({ available: true, canClaim: false });
      expect(sender.calls).toHaveLength(0);
    });

    it("reports nothing to claim when the faucet is off", async () => {
      const { service, store } = makeService(welcomeConfig({ SIGNUP_FAUCET_ENABLED: "false" }));
      store.verifiedWallet = { address: WALLET, chainId: BASE_SEPOLIA };

      expect(await service.getWelcomeFundsStatus(WALLET)).toMatchObject({ available: false, canClaim: false });
    });
  });
});
