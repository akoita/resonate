import { WalletService } from "../modules/identity/wallet.service";

describe("wallet", () => {
  it("enforces monthly budget cap", () => {
    const wallet = new WalletService();
    wallet.setBudget({ userId: "user-1", monthlyCapUsd: 10 });
    wallet.fundWallet({ userId: "user-1", amountUsd: 10 });
    const first = wallet.spend("user-1", 6);
    const second = wallet.spend("user-1", 6);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });
});
