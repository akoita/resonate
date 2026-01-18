import { SessionsService } from "../modules/sessions/sessions.service";

const sessionStore: Record<string, any> = {
  "session-1": {
    id: "session-1",
    userId: "user-1",
    budgetCapUsd: 10,
    spentUsd: 0,
    endedAt: null,
  },
};

jest.mock("../db/prisma", () => {
  return {
    prisma: {
      session: {
        create: async ({ data }: any) => ({
          id: "session-1",
          endedAt: null,
          ...data,
        }),
        findUnique: async ({ where }: any) => sessionStore[where.id] ?? null,
        update: async ({ where, data }: any) => {
          const existing = sessionStore[where.id];
          const updated = { ...existing, ...data };
          sessionStore[where.id] = updated;
          return updated;
        },
      },
      license: {
        create: async () => ({ id: "license-1" }),
      },
      payment: {
        create: async () => ({ id: "payment-1" }),
      },
      track: {
        findMany: async () => [],
      },
    },
  };
});

describe("sessions", () => {
  it("creates license and payment on play", async () => {
    const walletService = {
      spend: async () => ({ allowed: true, remaining: 4 }),
      setBudget: async () => ({}),
    } as any;
    const service = new SessionsService(walletService);
    const result = await service.playTrack({
      sessionId: "session-1",
      trackId: "track-1",
      priceUsd: 6,
    });
    expect(result.allowed).toBe(true);
    expect(result.licenseId).toBe("license-1");
    expect(result.paymentId).toBe("payment-1");
  });
});
