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
    mockSessionKeyService,
    mockEventBus
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AgentWalletService", () => {
  describe("enable", () => {
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
        expect.objectContaining({ userId, scope: "agent:purchase" })
      );
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "agent.wallet_enabled" })
      );
      expect(result.enabled).toBe(true);
      expect(result.sessionKeyValid).toBe(true);
    });
  });

  describe("disable", () => {
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
        expect.objectContaining({ eventName: "agent.wallet_disabled" })
      );
      expect(result.status).toBe("disabled");
    });
  });

  describe("validateSessionKey", () => {
    it("should return true when session key is active", async () => {
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
  });

  describe("getStatus", () => {
    it("should return disabled status when wallet not found", async () => {
      const service = createService();
      mockWalletService.getWallet.mockResolvedValue(null);

      const status: AgentWalletStatus = await service.getStatus("user-none");
      expect(status.enabled).toBe(false);
      expect(status.sessionKeyValid).toBe(false);
      expect(status.budgetCapUsd).toBe(0);
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
});
