import { AgentWalletService, AgentWalletStatus } from "./agent_wallet.service";

// ─── mocks ──────────────────────────────────────────────
const mockWalletService = {
  refreshWallet: jest.fn(),
  getWallet: jest.fn(),
};

const mockZeroDevSessionKeyService = {
  createPendingSession: jest.fn(),
  activateSessionKey: jest.fn(),
  validateSessionKey: jest.fn(),
  markRevoked: jest.fn(),
  getActiveSessionKey: jest.fn(),
  getAgentKeyData: jest.fn(),
  rotateAgentKey: jest.fn(),
};

const mockEventBus = {
  publish: jest.fn(),
};

// Mock prisma for getStatus budget queries
jest.mock("../../db/prisma", () => ({
  prisma: {
    agentConfig: { findUnique: jest.fn() },
    session: { findMany: jest.fn() },
  },
}));

import { prisma } from "../../db/prisma";

function createService(): AgentWalletService {
  return new (AgentWalletService as any)(
    mockWalletService,
    mockZeroDevSessionKeyService,
    mockEventBus,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AgentWalletService", () => {
  describe("enable", () => {
    it("should generate agent key and return agent address + status", async () => {
      const userId = "user-1";
      mockWalletService.refreshWallet.mockResolvedValue({
        address: "0x123",
        accountType: "erc4337",
      });
      mockZeroDevSessionKeyService.createPendingSession.mockResolvedValue({
        id: "sk-new",
        agentAddress: "0xAgentAddr",
        agentPrivateKey: "0xprivate",
      });
      mockWalletService.getWallet.mockResolvedValue(null);

      const permissions = {
        target: "0xMkt",
        function: "buy(uint256,uint256)",
        totalCapWei: "1000000",
        perTxCapWei: "100000",
        rateLimit: 10,
      };

      const service = createService();
      const result = await service.enable(userId, permissions, 24);

      expect(result.agentAddress).toBe("0xAgentAddr");
      expect(mockZeroDevSessionKeyService.createPendingSession).toHaveBeenCalledWith(
        userId,
        permissions,
        expect.any(Date),
      );
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "agent.wallet_enabled",
          agentAddress: "0xAgentAddr",
        }),
      );
    });
  });

  describe("activateSessionKey", () => {
    it("should delegate to zeroDevSessionKeyService", async () => {
      mockZeroDevSessionKeyService.activateSessionKey.mockResolvedValue({
        id: "sk-active",
        userId: "user-activate",
        agentAddress: "0xAddr",
      });

      const service = createService();
      const result = await service.activateSessionKey(
        "user-activate",
        "approval_data",
        "0xtxhash",
      );

      expect(
        mockZeroDevSessionKeyService.activateSessionKey,
      ).toHaveBeenCalledWith("user-activate", "approval_data", "0xtxhash");
      expect(result.id).toBe("sk-active");
    });
  });

  describe("disable", () => {
    it("should call zeroDevSessionKeyService.markRevoked with txHash", async () => {
      const service = createService();
      const result = await service.disable("user-1", "0xrevoke_hash");

      expect(
        mockZeroDevSessionKeyService.markRevoked,
      ).toHaveBeenCalledWith("user-1", "0xrevoke_hash");
      expect(result.status).toBe("disabled");
    });

    it("should emit wallet_disabled event", async () => {
      const service = createService();
      await service.disable("user-1");

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.wallet_disabled" }),
      );
    });
  });

  describe("validateSessionKey", () => {
    it("should return true when session key is valid", async () => {
      mockZeroDevSessionKeyService.validateSessionKey.mockResolvedValue({
        valid: true,
        id: "sk-1",
      });

      const service = createService();
      const result = await service.validateSessionKey("user-1");

      expect(result).toBe(true);
    });

    it("should return false when no valid session key exists", async () => {
      mockZeroDevSessionKeyService.validateSessionKey.mockResolvedValue(null);

      const service = createService();
      const result = await service.validateSessionKey("user-unknown");

      expect(result).toBe(false);
    });
  });

  describe("getAgentKeyData", () => {
    it("should return agent key data from the session key service", async () => {
      const mockSensitiveBuffer = {
        toString: () => "0xkey",
        zero: jest.fn(),
        isZeroed: false,
      };
      mockZeroDevSessionKeyService.getAgentKeyData.mockResolvedValue({
        agentPrivateKey: mockSensitiveBuffer,
        agentAddress: "0xAddr",
        approvalData: "data",
      });

      const service = createService();
      const result = await service.getAgentKeyData("user-1");

      expect(result).not.toBeNull();
      expect(result!.agentPrivateKey.toString()).toBe("0xkey");
      expect(result!.agentAddress).toBe("0xAddr");
      expect(result!.approvalData).toBe("data");
    });

    it("should return null when no agent key data exists", async () => {
      mockZeroDevSessionKeyService.getAgentKeyData.mockResolvedValue(null);

      const service = createService();
      const result = await service.getAgentKeyData("user-1");

      expect(result).toBeNull();
    });
  });

  describe("getStatus", () => {
    it("should return disabled status when wallet not found", async () => {
      const service = createService();
      mockWalletService.getWallet.mockResolvedValue(null);

      const status = await service.getStatus("user-new");

      expect(status.enabled).toBe(false);
      expect(status.budgetCapUsd).toBe(0);
      expect(status.sessionKeyTxHash).toBeNull();
      expect(status.sessionKeyExplorerUrl).toBeNull();
      expect(status.sessionKeyPermissions).toBeNull();
    });

    it("should return enabled status with session key info", async () => {
      const permissions = {
        target: "0xMkt",
        function: "buy(uint256,uint256)",
        totalCapWei: "1000000",
        perTxCapWei: "100000",
        rateLimit: 10,
      };
      mockWalletService.getWallet.mockResolvedValue({
        address: "0x456",
        accountType: "erc4337",
      });
      mockZeroDevSessionKeyService.validateSessionKey.mockResolvedValue({
        valid: true,
        validUntil: new Date("2030-01-01"),
        txHash: "0xgrant_hash",
        permissions,
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 100,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { spentUsd: 10 },
        { spentUsd: 20 },
      ]);

      const service = createService();
      const status = await service.getStatus("user-status");

      expect(status.enabled).toBe(true);
      expect(status.sessionKeyTxHash).toBe("0xgrant_hash");
      expect(status.sessionKeyExplorerUrl).toBe(
        "https://sepolia.etherscan.io/tx/0xgrant_hash",
      );
      expect(status.sessionKeyPermissions).toEqual(permissions);
    });

    it("should compute alert level correctly", async () => {
      mockWalletService.getWallet.mockResolvedValue({
        address: "0x789",
        accountType: "erc4337",
      });
      mockZeroDevSessionKeyService.validateSessionKey.mockResolvedValue({
        valid: true,
        validUntil: new Date("2030-01-01"),
        txHash: null,
        permissions: null,
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 100,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { spentUsd: 96 },
      ]);

      const service = createService();
      const status = await service.getStatus("user-alert");
      expect(status.alertLevel).toBe("critical");
      expect(status.remainingUsd).toBe(4);
    });
  });

  describe("computeAlertLevel", () => {
    it("should return 'none' for low spend", () => {
      const service = createService();
      expect(service.computeAlertLevel(10, 100)).toBe("none");
    });

    it("should return 'warning' at 80%+", () => {
      const service = createService();
      expect(service.computeAlertLevel(85, 100)).toBe("warning");
    });

    it("should return 'critical' at 95%+", () => {
      const service = createService();
      expect(service.computeAlertLevel(96, 100)).toBe("critical");
    });

    it("should return 'exhausted' at 100%+", () => {
      const service = createService();
      expect(service.computeAlertLevel(100, 100)).toBe("exhausted");
    });
  });
});
