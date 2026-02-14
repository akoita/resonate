import { WalletService } from "../modules/identity/wallet.service";

jest.mock("../db/prisma", () => {
  const store = new Map<string, any>();
  return {
    prisma: {
      user: {
        upsert: async ({ where, create, update }: any) => {
          return { id: where.id, ...create };
        },
      },
      wallet: {
        findFirst: async ({ where }: any) => {
          return store.get(where.userId) ?? null;
        },
        create: async ({ data }: any) => {
          const record = { id: `wallet_${data.userId}`, ...data };
          store.set(data.userId, record);
          return record;
        },
        update: async ({ where, data }: any) => {
          const existing = [...store.values()].find((w) => w.id === where.id);
          if (!existing) {
            throw new Error("Wallet not found");
          }
          const updated = { ...existing, ...data };
          store.set(updated.userId, updated);
          return updated;
        },
        upsert: async ({ where, create, update }: any) => {
          const existing = [...store.values()].find((w) => w.userId === where.userId);
          if (existing) {
            const updated = { ...existing, ...update };
            store.set(updated.userId, updated);
            return updated;
          }
          const record = { id: `wallet_${where.userId}`, ...create };
          store.set(where.userId, record);
          return record;
        },
      },
    },
  };
});

describe("wallet", () => {
  it("enforces monthly budget cap", async () => {
    const wallet = new WalletService(
      { publish: () => { } } as any,
      {
        getProvider: () => ({
          getAccount: () => ({
            address: "wallet_user-1",
            chainId: 0,
            accountType: "local",
            provider: "local",
          }),
        }),
      } as any,
      {
        sendUserOperation: async () => "0xhash",
        waitForReceipt: async () => ({}),
      } as any,
      { configure: () => { } } as any,
      {
        sendTransaction: async () => "0xhash",
        getSmartAccountAddress: async () => "0xaddr",
      } as any,
    );
    await wallet.setBudget({ userId: "user-1", monthlyCapUsd: 10 });
    await wallet.fundWallet({ userId: "user-1", amountUsd: 10 });
    const first = await wallet.spend("user-1", 6);
    const second = await wallet.spend("user-1", 6);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });
});
