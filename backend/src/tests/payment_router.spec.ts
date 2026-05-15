import { PaymentRouterService } from "../modules/agents/payment_router.service";
import { PolicyGuardService } from "../modules/agents/policy_guard.service";

const purchaseInput = {
  sessionId: "session-1",
  userId: "user-1",
  listingId: 1n,
  tokenId: 10n,
  amount: 1n,
  totalPriceWei: "1000000000000000",
  priceUsd: 1,
  budgetRemainingUsd: 5,
};

describe("PaymentRouterService", () => {
  it("rejects by policy before calling the ERC-4337 rail", async () => {
    const erc4337Rail = { purchase: jest.fn() };
    const service = new PaymentRouterService(
      new PolicyGuardService(),
      erc4337Rail as any,
    );

    const result = await service.purchase({
      ...purchaseInput,
      priceUsd: 6,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        rail: "erc4337_marketplace",
        status: "rejected",
        reason: "budget_exceeded",
      }),
    );
    expect(erc4337Rail.purchase).not.toHaveBeenCalled();
  });

  it("routes allowed ERC-4337 purchases through the existing rail", async () => {
    const erc4337Rail = {
      purchase: jest.fn().mockResolvedValue({
        success: true,
        transactionId: "agent-tx-1",
        txHash: "0xtx",
        remaining: 4,
      }),
    };
    const service = new PaymentRouterService(
      new PolicyGuardService(),
      erc4337Rail as any,
    );

    const result = await service.purchase(purchaseInput);

    expect(erc4337Rail.purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        listingId: 1n,
        priceUsd: 1,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        rail: "erc4337_marketplace",
        status: "confirmed",
        transactionId: "agent-tx-1",
        txHash: "0xtx",
        remaining: 4,
      }),
    );
  });

  it("normalizes ERC-4337 rail failures", async () => {
    const erc4337Rail = {
      purchase: jest.fn().mockResolvedValue({
        success: false,
        reason: "session_key_invalid",
        message: "Re-enable the agent wallet.",
      }),
    };
    const service = new PaymentRouterService(
      new PolicyGuardService(),
      erc4337Rail as any,
    );

    const result = await service.purchase(purchaseInput);

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        rail: "erc4337_marketplace",
        status: "failed",
        reason: "session_key_invalid",
        message: "Re-enable the agent wallet.",
      }),
    );
  });

  it("rejects x402 when the rail is not configured", async () => {
    const erc4337Rail = { purchase: jest.fn() };
    const service = new PaymentRouterService(
      new PolicyGuardService(),
      erc4337Rail as any,
    );

    const result = await service.purchase({
      sessionId: "session-1",
      userId: "user-1",
      rail: "x402",
      stemId: "stem-1",
      licenseType: "personal",
      budgetRemainingUsd: 5,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        rail: "x402",
        status: "rejected",
        reason: "x402_not_configured",
      }),
    );
    expect(erc4337Rail.purchase).not.toHaveBeenCalled();
  });
});
