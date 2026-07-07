/**
 * Credit-request → operator notification — Integration Test (Testcontainers) — #1334.
 *
 * A user out of generation credits publishes `generation.credits_requested`;
 * NotificationService fans it out to the configured operator/admin wallets as
 * in-app notifications, and coalesces repeat requests. Runs against real
 * Postgres with a real EventBus.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { NotificationService } from "../modules/notifications/notification.service";
import type { GenerationCreditsRequestedEvent } from "../events/event_types";

const PREFIX = `creditreq_${Date.now()}_`;
const OPERATOR = `${PREFIX}operator`.toLowerCase();
const REQUESTER = `${PREFIX}requester`.toLowerCase();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (predicate(value)) return value;
    if (Date.now() > deadline) return value;
    await sleep(50);
  }
}

function publishRequest(eventBus: EventBus, note?: string) {
  eventBus.publish({
    eventName: "generation.credits_requested",
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    userId: REQUESTER,
    ...(note ? { note } : {}),
  } as GenerationCreditsRequestedEvent);
}

describe("credit-request operator notification (integration)", () => {
  let eventBus: EventBus;
  let service: NotificationService;
  let prevOperatorAddresses: string | undefined;

  beforeAll(async () => {
    prevOperatorAddresses = process.env.OPERATOR_ADDRESSES;
    process.env.OPERATOR_ADDRESSES = OPERATOR;

    eventBus = new EventBus();
    service = new NotificationService(eventBus);
    service.onModuleInit(); // subscribes to the event bus
  });

  afterAll(async () => {
    service.onModuleDestroy();
    if (prevOperatorAddresses === undefined) {
      delete process.env.OPERATOR_ADDRESSES;
    } else {
      process.env.OPERATOR_ADDRESSES = prevOperatorAddresses;
    }
    await prisma.notification.deleteMany({ where: { walletAddress: OPERATOR } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("notifies the configured operator with a grant hint referencing the requester", async () => {
    publishRequest(eventBus, "trying the Afrobeat preset");

    const notifications = await waitFor(
      () => prisma.notification.findMany({ where: { walletAddress: OPERATOR, type: "credits_requested" } }),
      (list) => list.length >= 1,
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Credit request");
    // Message carries the requester (for dedupe + operator context) and the note.
    expect(notifications[0].message).toContain(REQUESTER);
    expect(notifications[0].message).toContain("trying the Afrobeat preset");
    expect(notifications[0].message).toContain(`make grant-credits USER=${REQUESTER}`);
  });

  it("coalesces a repeat request from the same user within the window (no operator spam)", async () => {
    // First request already recorded above; a second within 10 min must not
    // create another operator notification.
    publishRequest(eventBus);
    await sleep(300);

    const count = await prisma.notification.count({
      where: { walletAddress: OPERATOR, type: "credits_requested" },
    });
    expect(count).toBe(1);
  });
});
