/**
 * Credit-request → operator notification — Integration Test (Testcontainers) — #1334, #1885.
 *
 * A user out of generation credits publishes `generation.credits_requested`;
 * NotificationService fans it out to the configured operator/admin wallets as
 * in-app notifications, and coalesces repeat requests. A `generation.credits_granted`
 * notifies the recipient when their user id is a wallet address. Runs against
 * real Postgres with a real EventBus.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { NotificationService } from "../modules/notifications/notification.service";
import { SIGNUP_STARTER_REASON } from "../modules/credits/generation-credits.service";
import type {
  GenerationCreditsGrantedEvent,
  GenerationCreditsRequestedEvent,
} from "../events/event_types";

const PREFIX = `creditreq_${Date.now()}_`;
const OPERATOR = `${PREFIX}operator`.toLowerCase();
const REQUESTER = `${PREFIX}requester`.toLowerCase();
// A wallet-address-shaped recipient (unique per run) for the credits_granted inbox.
const GRANTEE_ADDRESS = `0x${Date.now().toString(16).padStart(40, "a")}`.slice(0, 42);
const GRANTEE = GRANTEE_ADDRESS.toUpperCase().replace(/^0X/, "0x");

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
    await prisma.notification
      .deleteMany({ where: { walletAddress: { in: [OPERATOR, GRANTEE_ADDRESS] } } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it("notifies the configured operator with the requester and note (no CLI hint)", async () => {
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
    expect(notifications[0].message).not.toContain("make grant-credits");
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

  function publishGrant(userId: string, amountCents: number, reason = "Credit request top-up") {
    eventBus.publish({
      eventName: "generation.credits_granted",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      amountCents,
      reason,
    } as GenerationCreditsGrantedEvent);
  }

  it("does not notify for the automatic signup-starter grant", async () => {
    publishGrant(GRANTEE, 100, SIGNUP_STARTER_REASON);
    await sleep(300);
    const count = await prisma.notification.count({
      where: { walletAddress: GRANTEE_ADDRESS, type: "credits_granted" },
    });
    expect(count).toBe(0);
  });

  it("notifies a wallet-address recipient that credits were added, formatted in dollars", async () => {
    publishGrant(GRANTEE, 1250);

    const notifications = await waitFor(
      () => prisma.notification.findMany({ where: { walletAddress: GRANTEE_ADDRESS, type: "credits_granted" } }),
      (list) => list.length >= 1,
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Generation credits added");
    expect(notifications[0].message).toBe("You received $12.50 of generation credits.");
  });

  it("does not notify a recipient whose user id is not a wallet address", async () => {
    publishGrant(REQUESTER, 500);
    await sleep(300);
    const count = await prisma.notification.count({
      where: { walletAddress: REQUESTER, type: "credits_granted" },
    });
    expect(count).toBe(0);
  });
});
