import { AccountClosureStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import type { AnalyticsWarehouseGovernanceTarget } from "../modules/analytics/analytics_warehouse_governance";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";

const PREFIX = `erasure_retry_${Date.now().toString(16)}_`;
const USER_ID = `${PREFIX}user`;
const EVENT_ID = `${PREFIX}event`;

describe("retryable account erasure", () => {
  const closures = new AccountClosureService();
  const warehouse: AnalyticsWarehouseGovernanceTarget = {
    describe: () => ({ provider: "recording" }),
    applyErasure: async () => {
      throw new Error("rows are still in the streaming buffer");
    },
  };
  const service = new PersonalDataErasureService(
    new PersonalDataResolverService(),
    new AnalyticsGovernanceService(warehouse),
    closures,
  );

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@test.resonate` } });
    await prisma.analyticsEvent.create({
      data: {
        eventId: EVENT_ID,
        eventName: "generation.created",
        eventVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        producer: "test",
        environment: "test",
        privacyTier: "personal",
        actorId: pseudonymousAnalyticsActorId(USER_ID),
        payload: {},
        envelope: {},
      },
    });
    const request = await closures.request(USER_ID);
    await prisma.accountClosureRequest.update({
      where: { id: request.id },
      data: { dueAt: new Date("2026-01-01T00:00:00.000Z") },
    });
  });

  afterAll(async () => {
    await prisma.analyticsGovernanceLog.deleteMany({
      where: {
        OR: [
          { eventId: EVENT_ID },
          { actorId: pseudonymousAnalyticsActorId(USER_ID) },
        ],
      },
    });
    await prisma.analyticsEvent.deleteMany({ where: { eventId: EVENT_ID } });
    await prisma.accountClosureRequest.deleteMany({ where: { userId: USER_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.$disconnect();
  });

  it("fails the run while preserving the source event and pending closure for retry", async () => {
    const result = await service.runDueErasures({ now: new Date("2026-06-01T00:00:00.000Z") });

    expect(result).toEqual(expect.objectContaining({ due: 1, erased: 0, failed: 1, status: "failures" }));
    await expect(prisma.user.findUnique({ where: { id: USER_ID } })).resolves.toEqual(
      expect.objectContaining({ id: USER_ID, erasedAt: null }),
    );
    await expect(prisma.analyticsEvent.findUnique({ where: { eventId: EVENT_ID } })).resolves.toEqual(
      expect.objectContaining({ eventId: EVENT_ID }),
    );
    await expect(closures.findPending(USER_ID)).resolves.toEqual(
      expect.objectContaining({
        status: AccountClosureStatus.pending,
        failedAt: expect.any(Date),
        failureMessage: expect.stringContaining("warehouse erasure incomplete"),
      }),
    );
  });
});
