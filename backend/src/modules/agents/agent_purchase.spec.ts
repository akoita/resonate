import { AgentPurchaseService } from "./agent_purchase.service";

// ─── mocks ──────────────────────────────────────────────
const mockWalletService = {
  spend: jest.fn(),
  getWallet: jest.fn(),
};

const mockAgentWalletService = {
  validateSessionKey: jest.fn(),
};

const mockErc4337Client = {
  sendUserOp: jest.fn(),
};

const mockEventBus = {
  publish: jest.fn(),
};

// Mock prisma
jest.mock("../../db/prisma", () => ({
  prisma: {
    agentTransaction: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "../../db/prisma";

function createService(): AgentPurchaseService {
  return new (AgentPurchaseService as any)(
    mockWalletService,
    mockAgentWalletService,
    mockErc4337Client,
    mockEventBus
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AA_SKIP_BUNDLER = "true"; // default to mock mode for tests
});

afterAll(() => {
  delete process.env.AA_SKIP_BUNDLER;
});

describe("AgentPurchaseService", () => {
  describe("purchase – session key validation", () => {
    it("should reject when session key is invalid", async () => {
      mockAgentWalletService.validateSessionKey.mockReturnValue(false);

      const service = createService();
      const result = await service.purchase({
        sessionId: "s1",
        userId: "u1",
        listingId: BigInt(1),
        tokenId: BigInt(100),
        amount: BigInt(1),
        totalPriceWei: "1000000",
        priceUsd: 0.5,
      });

      expect(result.success).toBe(false);
      expect((result as any).reason).toContain("session_key");
    });
  });

  describe("purchase – budget exceeded", () => {
    it("should reject when budget is exceeded", async () => {
      mockAgentWalletService.validateSessionKey.mockReturnValue(true);
      mockWalletService.spend.mockResolvedValue({ allowed: false, remaining: 0 });

      const service = createService();
      const result = await service.purchase({
        sessionId: "s2",
        userId: "u2",
        listingId: BigInt(2),
        tokenId: BigInt(200),
        amount: BigInt(1),
        totalPriceWei: "2000000",
        priceUsd: 100,
      });

      expect(result.success).toBe(false);
      expect((result as any).reason).toContain("budget");
    });
  });

  describe("purchase – mock mode success", () => {
    it("should succeed in mock mode (AA_SKIP_BUNDLER=true)", async () => {
      mockAgentWalletService.validateSessionKey.mockReturnValue(true);
      mockWalletService.spend.mockResolvedValue({ allowed: true, remaining: 45 });
      (prisma.agentTransaction.create as jest.Mock).mockResolvedValue({
        id: "tx-1",
        status: "pending",
      });
      (prisma.agentTransaction.update as jest.Mock).mockResolvedValue({
        id: "tx-1",
        status: "confirmed",
        txHash: "mock_tx_hash",
      });

      const service = createService();
      const result = await service.purchase({
        sessionId: "s3",
        userId: "u3",
        listingId: BigInt(3),
        tokenId: BigInt(300),
        amount: BigInt(1),
        totalPriceWei: "3000000",
        priceUsd: 5,
      });

      expect(result.success).toBe(true);
      expect((result as any).mode).toBe("mock");
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.purchase_completed" })
      );
    });
  });

  describe("getTransactions", () => {
    it("should return transactions with stringified BigInt fields", async () => {
      const fakeRows = [
        { id: "tx-1", userId: "u1", status: "confirmed", listingId: BigInt(1), tokenId: BigInt(100), amount: BigInt(1) },
        { id: "tx-2", userId: "u1", status: "pending", listingId: BigInt(2), tokenId: BigInt(200), amount: BigInt(1) },
      ];
      (prisma.agentTransaction.findMany as jest.Mock).mockResolvedValue(fakeRows);

      const service = createService();
      const result = await service.getTransactions("u1");

      expect(result).toEqual([
        { id: "tx-1", userId: "u1", status: "confirmed", listingId: "1", tokenId: "100", amount: "1" },
        { id: "tx-2", userId: "u1", status: "pending", listingId: "2", tokenId: "200", amount: "1" },
      ]);
      expect(prisma.agentTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "u1" } })
      );
    });
  });
});
