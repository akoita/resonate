import { AgentWalletService, AgentWalletStatus } from "./agent_wallet.service";

// ─── mocks ──────────────────────────────────────────────
const mockWalletService = {
  refreshWallet: jest.fn(),
  getWallet: jest.fn(),
};

const mockSessionKeyService = {
  issue: jest.fn(),
  validate: jest.fn(),
  revoke: jest.fn(),
};

const mockZeroDevSessionKeyService = {
  registerSessionKey: jest.fn(),
  validateSessionKey: jest.fn(),
  markRevoked: jest.fn(),
  getActiveSessionKey: jest.fn(),
};

const mockEventBus = {
  publish: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === "AA_SKIP_BUNDLER") return "true"; // default to mock mode
    if (key === "BLOCK_EXPLORER_URL") return "https://sepolia.etherscan.io";
    return undefined;
  }),
};

// Mock prisma for getStatus budget queries
jest.mock("../../db/prisma", () => ({
  prisma: {
    agentConfig: { findUnique: jest.fn() },
    session: { findMany: jest.fn() },
  },
}));

import { prisma } from "../../db/prisma";

function createService(overrideConfig?: any): AgentWalletService {
  return new (AgentWalletService as any)(
    mockWalletService,
    mockSessionKeyService,
    mockZeroDevSessionKeyService,
    mockEventBus,
    overrideConfig ?? mockConfig,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AgentWalletService", () => {
  describe("enable (mock mode)", () => {
    it("should activate agent wallet and issue a session key", async () => {
      const userId = "user-1";
      mockWalletService.refreshWallet.mockResolvedValue({
        address: "0xABC",
        accountType: "erc4337",
        balanceUsd: 100,
      });
      mockSessionKeyService.issue.mockReturnValue({ token: "sk_agent_token" });
      mockSessionKeyService.validate.mockReturnValue({ valid: true });
      mockWalletService.getWallet.mockResolvedValue({
        address: "0xABC",
        accountType: "erc4337",
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 50,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { spentUsd: 10 },
      ]);

      const service = createService();
      const result = await service.enable(userId);

      expect(mockWalletService.refreshWallet).toHaveBeenCalledWith({
        userId,
        provider: "erc4337",
      });
      expect(mockSessionKeyService.issue).toHaveBeenCalledWith(
        expect.objectContaining({ userId, scope: "agent:purchase" }),
      );
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.wallet_enabled" }),
      );
      expect(result.enabled).toBe(true);
      expect(result.sessionKeyValid).toBe(true);
    });
  });

  describe("disable (mock mode)", () => {
    it("should deactivate agent wallet and revoke session key", async () => {
      const userId = "user-2";
      mockWalletService.refreshWallet.mockResolvedValue({
        address: "0xDEF",
        accountType: "erc4337",
        balanceUsd: 50,
      });
      mockSessionKeyService.issue.mockReturnValue({ token: "sk_token_2" });
      mockSessionKeyService.validate.mockReturnValue({ valid: true });
      mockWalletService.getWallet.mockResolvedValue({
        address: "0xDEF",
        accountType: "erc4337",
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 100,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([]);

      const service = createService();
      await service.enable(userId);
      jest.clearAllMocks();

      const result = await service.disable(userId);

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.wallet_disabled" }),
      );
      expect(result.status).toBe("disabled");
    });
  });

  describe("disable (self-custodial mode)", () => {
    it("should call zeroDevSessionKeyService.markRevoked with txHash", async () => {
      const selfCustodialConfig = {
        get: jest.fn((key: string) => {
          if (key === "AA_SKIP_BUNDLER") return "false";
          if (key === "BLOCK_EXPLORER_URL")
            return "https://sepolia.etherscan.io";
          return undefined;
        }),
      };

      const service = createService(selfCustodialConfig);
      const result = await service.disable("user-sc", "0xrevoke_hash");

      expect(
        mockZeroDevSessionKeyService.markRevoked,
      ).toHaveBeenCalledWith("user-sc", "0xrevoke_hash");
      expect(result.status).toBe("disabled");
    });
  });

  describe("registerSessionKey", () => {
    it("should delegate to zeroDevSessionKeyService", async () => {
      const permissions = {
        target: "0xMkt",
        function: "buy(uint256,uint256)",
        totalCapWei: "1000000",
        perTxCapWei: "100000",
        rateLimit: 5,
      };
      const validUntil = new Date("2030-01-01");

      mockZeroDevSessionKeyService.registerSessionKey.mockResolvedValue({
        id: "sk-reg",
        userId: "user-reg",
        permissions,
        validUntil,
        txHash: "0xgrant",
        createdAt: new Date(),
      });

      const service = createService();
      const result = await service.registerSessionKey(
        "user-reg",
        "serialized_data",
        permissions,
        validUntil,
        "0xgrant",
      );

      expect(
        mockZeroDevSessionKeyService.registerSessionKey,
      ).toHaveBeenCalledWith(
        "user-reg",
        "serialized_data",
        permissions,
        validUntil,
        "0xgrant",
      );
      expect(result.id).toBe("sk-reg");
    });
  });

  describe("validateSessionKey", () => {
    it("should return true when mock session key is active", async () => {
      const userId = "user-3";
      mockWalletService.refreshWallet.mockResolvedValue({
        address: "0x123",
        accountType: "erc4337",
        balanceUsd: 200,
      });
      mockSessionKeyService.issue.mockReturnValue({ token: "sk_valid" });
      mockSessionKeyService.validate.mockReturnValue({ valid: true });
      mockWalletService.getWallet.mockResolvedValue({
        address: "0x123",
        accountType: "erc4337",
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 100,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([]);

      const service = createService();
      await service.enable(userId);

      expect(service.validateSessionKey(userId)).toBe(true);
    });

    it("should return false when no session key exists", () => {
      const service = createService();
      expect(service.validateSessionKey("user-unknown")).toBe(false);
    });

    it("should delegate to zeroDevSessionKeyService in self-custodial mode", async () => {
      const selfCustodialConfig = {
        get: jest.fn((key: string) => {
          if (key === "AA_SKIP_BUNDLER") return "false";
          if (key === "BLOCK_EXPLORER_URL")
            return "https://sepolia.etherscan.io";
          return undefined;
        }),
      };

      mockZeroDevSessionKeyService.validateSessionKey.mockResolvedValue({
        valid: true,
      });

      const service = createService(selfCustodialConfig);
      const result = await service.validateSessionKey("user-sc");

      expect(result).toBe(true);
      expect(
        mockZeroDevSessionKeyService.validateSessionKey,
      ).toHaveBeenCalledWith("user-sc");
    });
  });

  describe("getStatus", () => {
    it("should return disabled status when wallet not found", async () => {
      const service = createService();
      mockWalletService.getWallet.mockResolvedValue(null);

      const status: AgentWalletStatus = await service.getStatus("user-none");
      expect(status.enabled).toBe(false);
      expect(status.sessionKeyValid).toBe(false);
      expect(status.budgetCapUsd).toBe(0);
      expect(status.sessionKeyTxHash).toBeNull();
      expect(status.sessionKeyExplorerUrl).toBeNull();
      expect(status.sessionKeyPermissions).toBeNull();
    });

    it("should return enabled status with budget from prisma", async () => {
      const userId = "user-status";
      mockWalletService.refreshWallet.mockResolvedValue({
        address: "0x456",
        accountType: "erc4337",
        balanceUsd: 80,
      });
      mockSessionKeyService.issue.mockReturnValue({ token: "sk_status" });
      mockSessionKeyService.validate.mockReturnValue({ valid: true });
      mockWalletService.getWallet.mockResolvedValue({
        address: "0x456",
        accountType: "erc4337",
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 100,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { spentUsd: 15 },
        { spentUsd: 5 },
      ]);

      const service = createService();
      await service.enable(userId);

      const status = await service.getStatus(userId);
      expect(status.enabled).toBe(true);
      expect(status.sessionKeyValid).toBe(true);
      expect(status.budgetCapUsd).toBe(100);
      expect(status.spentUsd).toBe(20);
      expect(status.remainingUsd).toBe(80);
    });

    it("should return on-chain session key info in self-custodial mode", async () => {
      const selfCustodialConfig = {
        get: jest.fn((key: string) => {
          if (key === "AA_SKIP_BUNDLER") return "false";
          if (key === "BLOCK_EXPLORER_URL")
            return "https://sepolia.etherscan.io";
          return undefined;
        }),
      };

      const permissions = {
        target: "0xMkt",
        function: "buy(uint256,uint256)",
        totalCapWei: "1000000",
        perTxCapWei: "100000",
        rateLimit: 5,
      };

      mockWalletService.getWallet.mockResolvedValue({
        address: "0x789",
        accountType: "erc4337",
      });
      mockZeroDevSessionKeyService.validateSessionKey.mockResolvedValue({
        valid: true,
        mock: false,
        id: "sk-chain",
        validUntil: new Date("2030-01-01"),
        txHash: "0xgrant_hash",
        permissions,
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 50,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([]);

      const service = createService(selfCustodialConfig);
      const status = await service.getStatus("user-chain");

      expect(status.sessionKeyValid).toBe(true);
      expect(status.sessionKeyTxHash).toBe("0xgrant_hash");
      expect(status.sessionKeyExplorerUrl).toBe(
        "https://sepolia.etherscan.io/tx/0xgrant_hash",
      );
      expect(status.sessionKeyPermissions).toEqual(permissions);
    });

    it("should compute alert level correctly", async () => {
      const userId = "user-alert";
      mockWalletService.refreshWallet.mockResolvedValue({
        address: "0x789",
        accountType: "erc4337",
      });
      mockSessionKeyService.issue.mockReturnValue({ token: "sk_alert" });
      mockSessionKeyService.validate.mockReturnValue({ valid: true });
      mockWalletService.getWallet.mockResolvedValue({
        address: "0x789",
        accountType: "erc4337",
      });
      (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
        monthlyCapUsd: 100,
      });
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { spentUsd: 96 },
      ]);

      const service = createService();
      await service.enable(userId);

      const status = await service.getStatus(userId);
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
