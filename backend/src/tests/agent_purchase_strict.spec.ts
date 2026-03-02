import { AgentPurchaseService } from "../modules/agents/agent_purchase.service";

// Mock prisma
jest.mock("../db/prisma", () => {
  let idCounter = 0;
  return {
    prisma: {
      agentTransaction: {
        create: async ({ data }: any) => ({
          id: `agtx_${++idCounter}`,
          ...data,
        }),
        update: async ({ where, data }: any) => ({
          id: where.id,
          ...data,
        }),
      },
    },
  };
});

function makeMockServices() {
  return {
    walletService: {
      spend: async () => ({ allowed: true, remaining: 50 }),
      getWallet: async () => ({ id: "w1", userId: "user-1" }),
    },
    agentWalletService: {
      validateSessionKey: () => true,
      getSerializedSessionKey: async () => "serialized_session_key_data",
      checkAndEmitBudgetAlert: () => {},
    },
    kernelAccountService: {
      sendSessionKeyTransaction: async () => "0xreal_session_key_tx_hash",
    },
    eventBus: {
      publish: () => {},
    },
  };
}

function makeService() {
  const mocks = makeMockServices();
  const svc = new AgentPurchaseService(
    mocks.walletService as any,
    mocks.agentWalletService as any,
    mocks.kernelAccountService as any,
    mocks.eventBus as any,
  );

  return { svc, mocks };
}

const baseInput = {
  sessionId: "sess-1",
  userId: "user-1",
  listingId: BigInt(1),
  tokenId: BigInt(100),
  amount: BigInt(1),
  totalPriceWei: "1000000000000000",
  priceUsd: 5,
};

describe("AgentPurchaseService — session key parity", () => {
  it("always uses sendSessionKeyTransaction for purchases", async () => {
    const { svc, mocks } = makeService();

    const result = await svc.purchase(baseInput);
    expect(result.success).toBe(true);
    expect(result.mode).toBe("onchain");
    expect(result.txHash).toBe("0xreal_session_key_tx_hash");
  });

  it("rejects when session key is invalid", async () => {
    const { svc, mocks } = makeService();
    mocks.agentWalletService.validateSessionKey = () => false;

    const result = await svc.purchase(baseInput);
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe("session_key_invalid");
  });

  it("rejects when no serialized session key is found", async () => {
    const { svc, mocks } = makeService();
    mocks.agentWalletService.getSerializedSessionKey = async () => null as any;

    const result = await svc.purchase(baseInput);
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe("transaction_failed");
    expect((result as any).message).toContain("serialized session key");
  });

  it("handles sendSessionKeyTransaction failure gracefully", async () => {
    const { svc, mocks } = makeService();
    mocks.kernelAccountService.sendSessionKeyTransaction = async () => {
      throw new Error("Bundler rejected UserOp");
    };

    const result = await svc.purchase(baseInput);
    expect(result.success).toBe(false);
    expect((result as any).reason).toBe("transaction_failed");
    expect((result as any).message).toContain("Bundler rejected UserOp");
  });
});
