"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wallet_service_1 = require("../modules/identity/wallet.service");
jest.mock("../db/prisma", () => {
    const store = new Map();
    return {
        prisma: {
            wallet: {
                findFirst: async ({ where }) => {
                    return store.get(where.userId) ?? null;
                },
                create: async ({ data }) => {
                    const record = { id: `wallet_${data.userId}`, ...data };
                    store.set(data.userId, record);
                    return record;
                },
                update: async ({ where, data }) => {
                    const existing = [...store.values()].find((w) => w.id === where.id);
                    if (!existing) {
                        throw new Error("Wallet not found");
                    }
                    const updated = { ...existing, ...data };
                    store.set(updated.userId, updated);
                    return updated;
                },
            },
        },
    };
});
describe("wallet", () => {
    it("enforces monthly budget cap", async () => {
        const wallet = new wallet_service_1.WalletService({ publish: () => { } }, {
            getProvider: () => ({
                getAccount: () => ({
                    address: "wallet_user-1",
                    chainId: 0,
                    accountType: "local",
                    provider: "local",
                }),
            }),
        }, {
            sendUserOperation: async () => "0xhash",
            waitForReceipt: async () => ({}),
        }, { configure: () => { } });
        await wallet.setBudget({ userId: "user-1", monthlyCapUsd: 10 });
        await wallet.fundWallet({ userId: "user-1", amountUsd: 10 });
        const first = await wallet.spend("user-1", 6);
        const second = await wallet.spend("user-1", 6);
        expect(first.allowed).toBe(true);
        expect(second.allowed).toBe(false);
    });
});
