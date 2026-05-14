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
  private readonly attempts = new Map<string, { id: string; status: string; txHash?: string | null }>();
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
      return { created: false, attempt: existing };
    }
    const attempt = { id: `attempt-${this.attempts.size + 1}`, status: "pending", txHash: null };
    this.attempts.set(key, attempt);
    return { created: true, attempt };
  }

  async markSent(id: string, txHash: `0x${string}`) {
    this.sent.push({ id, txHash });
  }

  async markFailed(id: string, reason: string) {
    this.failed.push({ id, reason });
  }
}

class MemorySender implements SignupFaucetSender {
  readonly calls: Array<{ to: string; amountWei: bigint; chainId: number }> = [];
  failWith?: Error;

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
});
