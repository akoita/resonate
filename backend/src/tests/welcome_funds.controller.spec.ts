import { WelcomeFundsController } from "../modules/auth/welcome_funds.controller";

function makeController(claimResult: any) {
  const published: any[] = [];
  const status = { available: true, chainId: 84532, amountEth: null, amountUsdc: "20", eth: null, usdc: "sent", canClaim: false };
  const faucet = {
    claimWelcomeFunds: jest.fn().mockResolvedValue(claimResult),
    getWelcomeFundsStatus: jest.fn().mockResolvedValue(status),
  };
  const eventBus = { publish: (event: any) => published.push(event) };
  const controller = new WelcomeFundsController(faucet as any, eventBus as any);
  return { controller, faucet, published, status };
}

const req = { user: { userId: "0x00000000000000000000000000000000000000aa" } };

describe("WelcomeFundsController", () => {
  it("claims for the signed-in caller only and records the top-up", async () => {
    const { controller, faucet, published, status } = makeController({
      status: "sent",
      chainId: 84532,
      usdcTxHash: "0xusdc",
      amountUsdc: "20",
    });

    const body = await controller.claim(req);

    expect(faucet.claimWelcomeFunds).toHaveBeenCalledWith(req.user.userId);
    expect(body).toEqual({ result: { status: "sent", amountEth: null, amountUsdc: "20" }, welcome: status });
    expect(published).toEqual([
      expect.objectContaining({ eventName: "wallet.faucet_requested", userId: req.user.userId, amountUsdc: "20", status: "sent" }),
    ]);
  });

  it("never echoes a raw send error, which can name the RPC endpoint", async () => {
    const { controller, published } = makeController({
      status: "failed",
      reason: "HTTP request failed. URL: https://rpc.example/v2/secret-key",
    });

    const body = await controller.claim(req);

    expect(body.result).toEqual({ status: "failed", reason: "send_failed" });
    expect(JSON.stringify(body)).not.toContain("secret-key");
    expect(published).toHaveLength(0);
  });

  it("passes a skip reason through", async () => {
    const { controller } = makeController({ status: "skipped", reason: "daily_limit" });
    expect((await controller.claim(req)).result).toEqual({ status: "skipped", reason: "daily_limit" });
  });
});
