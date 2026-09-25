/**
 * Operator credit-request queue — Integration Test (Testcontainers) — #1885.
 *
 * Exercises GenerationCreditsService's persisted request queue against real
 * Postgres: one pending request per user (repeat requests refresh it), the
 * pending/resolved listings with the requester's balance, the atomic
 * claim-and-grant (ledger row, balance, resolution), double-grant and
 * dismiss-after-grant conflicts, and unknown ids. A real EventBus records the
 * events the service publishes.
 *
 * Run: npm run test:integration
 */

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import {
  DEFAULT_CREDIT_REQUEST_GRANT_REASON,
  GenerationCreditsService,
} from "../modules/credits/generation-credits.service";
import type { ResonateEvent } from "../events/event_types";

const TEST_PREFIX = `creditq_${Date.now()}_`;
const REQUESTER = `${TEST_PREFIX}requester`;
const FUNDED = `${TEST_PREFIX}funded`;
const RACER = `${TEST_PREFIX}racer`;
const DISMISSED = `${TEST_PREFIX}dismissed`;
const SELF_OPERATOR = `${TEST_PREFIX}self_operator`;
const USERS = [REQUESTER, FUNDED, RACER, DISMISSED, SELF_OPERATOR];
const OPERATOR = `${TEST_PREFIX}operator`;

const eventBus = new EventBus();
const published: ResonateEvent[] = [];
const service = new GenerationCreditsService(undefined, eventBus);

async function expectRejects(promise: Promise<unknown>, type: unknown, code: string) {
  const error = await promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type as never);
  expect((error as { getResponse(): { code: string } }).getResponse().code).toBe(code);
}

describe("GenerationCreditsService credit-request queue (integration)", () => {
  beforeAll(async () => {
    for (const eventName of ["generation.credits_requested", "generation.credits_granted"] as const) {
      eventBus.subscribe(eventName, (event) => {
        published.push(event);
      });
    }
    for (const id of USERS) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
  });

  afterAll(async () => {
    await prisma.generationCreditRequest.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {});
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {});
    await prisma.generationCreditAccount.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: USERS } } }).catch(() => {});
    eventBus.destroy();
    await prisma.$disconnect();
  });

  it("persists one pending request per user and refreshes it on a repeat", async () => {
    const first = await service.requestOperatorCredits(REQUESTER, "  trying the Afrobeat preset  ");
    expect(first).toMatchObject({ userId: REQUESTER, status: "pending", note: "trying the Afrobeat preset" });

    await new Promise((r) => setTimeout(r, 20));
    // A repeat without a note keeps the note but refreshes requestedAt.
    const repeat = await service.requestOperatorCredits(REQUESTER);
    expect(repeat.id).toBe(first.id);
    expect(repeat.note).toBe("trying the Afrobeat preset");
    expect(repeat.requestedAt.getTime()).toBeGreaterThan(first.requestedAt.getTime());

    // A repeat with a new note replaces it.
    const renoted = await service.requestOperatorCredits(REQUESTER, "need 5 more minutes");
    expect(renoted.id).toBe(first.id);
    expect(renoted.note).toBe("need 5 more minutes");

    const rows = await prisma.generationCreditRequest.findMany({ where: { userId: REQUESTER } });
    expect(rows).toHaveLength(1);

    const requestedEvents = published.filter(
      (e) => e.eventName === "generation.credits_requested" && (e as { userId: string }).userId === REQUESTER,
    );
    expect(requestedEvents).toHaveLength(3);
  });

  it("keeps one pending row under concurrent requests from the same user", async () => {
    await Promise.all([
      service.requestOperatorCredits(RACER, "a"),
      service.requestOperatorCredits(RACER, "b"),
      service.requestOperatorCredits(RACER),
    ]);
    const pending = await prisma.generationCreditRequest.count({
      where: { userId: RACER, status: "pending" },
    });
    expect(pending).toBe(1);
  });

  it("lists pending requests oldest first, each with the requester's balance", async () => {
    await service.grant(FUNDED, 250, "promo_grant");
    await service.requestOperatorCredits(FUNDED, "more please");

    const pending = (await service.listCreditRequests("pending")).filter((r) => USERS.includes(r.userId));
    const byUser = new Map(pending.map((r) => [r.userId, r]));
    expect(byUser.get(REQUESTER)).toMatchObject({ status: "pending", balanceCents: 0, resolvedBy: null });
    expect(byUser.get(FUNDED)).toMatchObject({ status: "pending", balanceCents: 250, note: "more please" });

    const times = pending.map((r) => r.requestedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const row of pending) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "balanceCents",
          "grantedCents",
          "id",
          "note",
          "requestedAt",
          "resolutionNote",
          "resolvedAt",
          "resolvedBy",
          "status",
          "userId",
        ].sort(),
      );
    }
  });

  it("grants atomically: ledger row, balance, and the request resolved by the operator", async () => {
    const request = await prisma.generationCreditRequest.findFirstOrThrow({
      where: { userId: FUNDED, status: "pending" },
    });
    published.length = 0;

    const granted = await service.grantCreditRequest(request.id, OPERATOR, 500);
    expect(granted).toMatchObject({
      id: request.id,
      userId: FUNDED,
      status: "granted",
      resolvedBy: OPERATOR,
      grantedCents: 500,
      resolutionNote: DEFAULT_CREDIT_REQUEST_GRANT_REASON,
      balanceCents: 750,
    });
    expect(granted.resolvedAt).toBeInstanceOf(Date);

    const ledger = await prisma.generationCreditTransaction.findMany({
      where: { userId: FUNDED, type: "grant" },
      orderBy: { createdAt: "asc" },
    });
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({
      amountCents: 500,
      reason: DEFAULT_CREDIT_REQUEST_GRANT_REASON,
      balanceAfterCents: 750,
    });
    const account = await prisma.generationCreditAccount.findUniqueOrThrow({ where: { userId: FUNDED } });
    expect(account.balanceCents).toBe(750);

    expect(published).toContainEqual(
      expect.objectContaining({
        eventName: "generation.credits_granted",
        userId: FUNDED,
        amountCents: 500,
        reason: DEFAULT_CREDIT_REQUEST_GRANT_REASON,
      }),
    );

    // A fresh request after a resolved one opens a new pending row.
    const next = await service.requestOperatorCredits(FUNDED);
    expect(next.id).not.toBe(request.id);
    expect(next.status).toBe("pending");
    await prisma.generationCreditRequest.delete({ where: { id: next.id } });
  });

  it("uses the operator's reason for the ledger and the resolution note when given", async () => {
    const request = await service.requestOperatorCredits(REQUESTER);
    const granted = await service.grantCreditRequest(request.id, OPERATOR, 100, "  welcome top-up ");
    expect(granted).toMatchObject({ resolutionNote: "welcome top-up", balanceCents: 100 });
    const ledger = await prisma.generationCreditTransaction.findFirstOrThrow({
      where: { userId: REQUESTER, type: "grant" },
    });
    expect(ledger.reason).toBe("welcome top-up");
  });

  it("rejects a second grant of the same request with 409 and writes exactly one ledger grant", async () => {
    const request = await service.requestOperatorCredits(RACER);

    const results = await Promise.allSettled([
      service.grantCreditRequest(request.id, OPERATOR, 300),
      service.grantCreditRequest(request.id, `${OPERATOR}_2`, 300),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect((rejected[0].reason as ConflictException).getResponse()).toMatchObject({
      code: "request_not_pending",
    });

    // And a later, sequential retry is refused too.
    await expectRejects(service.grantCreditRequest(request.id, OPERATOR, 300), ConflictException, "request_not_pending");

    const grants = await prisma.generationCreditTransaction.findMany({ where: { userId: RACER, type: "grant" } });
    expect(grants).toHaveLength(1);
    const account = await prisma.generationCreditAccount.findUniqueOrThrow({ where: { userId: RACER } });
    expect(account.balanceCents).toBe(300);
  });

  it("dismisses a pending request, and refuses to grant or dismiss it again", async () => {
    const request = await service.requestOperatorCredits(DISMISSED, "please");
    const dismissed = await service.dismissCreditRequest(request.id, OPERATOR, "  duplicate account ");
    expect(dismissed).toMatchObject({
      id: request.id,
      status: "dismissed",
      resolvedBy: OPERATOR,
      grantedCents: null,
      resolutionNote: "duplicate account",
      balanceCents: 0,
    });

    await expectRejects(service.dismissCreditRequest(request.id, OPERATOR), ConflictException, "request_not_pending");
    await expectRejects(service.grantCreditRequest(request.id, OPERATOR, 100), ConflictException, "request_not_pending");
    const grants = await prisma.generationCreditTransaction.count({ where: { userId: DISMISSED } });
    expect(grants).toBe(0);
  });

  it("refuses to dismiss a request that was already granted", async () => {
    const granted = await prisma.generationCreditRequest.findFirstOrThrow({
      where: { userId: FUNDED, status: "granted" },
    });
    await expectRejects(service.dismissCreditRequest(granted.id, OPERATOR), ConflictException, "request_not_pending");
    const row = await prisma.generationCreditRequest.findUniqueOrThrow({ where: { id: granted.id } });
    expect(row.status).toBe("granted");
  });

  it("forbids an operator from granting or dismissing their own request, before any write", async () => {
    const own = await service.requestOperatorCredits(SELF_OPERATOR, "operator testing");

    await expectRejects(
      service.grantCreditRequest(own.id, SELF_OPERATOR, 1000),
      ForbiddenException,
      "self_review_forbidden",
    );
    await expectRejects(
      service.dismissCreditRequest(own.id, SELF_OPERATOR),
      ForbiddenException,
      "self_review_forbidden",
    );
    // Matching is case-insensitive (user ids are lower-cased wallet addresses).
    await expectRejects(
      service.grantCreditRequest(own.id, SELF_OPERATOR.toUpperCase(), 1000),
      ForbiddenException,
      "self_review_forbidden",
    );

    const row = await prisma.generationCreditRequest.findUniqueOrThrow({ where: { id: own.id } });
    expect(row).toMatchObject({ status: "pending", resolvedBy: null, resolvedAt: null, grantedCents: null });
    expect(await prisma.generationCreditTransaction.count({ where: { userId: SELF_OPERATOR } })).toBe(0);
    expect(await prisma.generationCreditAccount.count({ where: { userId: SELF_OPERATOR } })).toBe(0);

    // A different operator can still resolve it.
    const granted = await service.grantCreditRequest(own.id, OPERATOR, 100);
    expect(granted).toMatchObject({ status: "granted", resolvedBy: OPERATOR, balanceCents: 100 });
  });

  it("returns 404 for an unknown request id", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expectRejects(service.grantCreditRequest(missing, OPERATOR, 100), NotFoundException, "request_not_found");
    await expectRejects(service.dismissCreditRequest(missing, OPERATOR), NotFoundException, "request_not_found");
  });

  it("lists resolved requests most recently resolved first, and all requests", async () => {
    const resolved = (await service.listCreditRequests("resolved")).filter((r) => USERS.includes(r.userId));
    expect(resolved.map((r) => r.status).every((s) => s === "granted" || s === "dismissed")).toBe(true);
    expect(resolved.length).toBeGreaterThanOrEqual(4);
    const resolvedTimes = resolved.map((r) => r.resolvedAt!.getTime());
    expect(resolvedTimes).toEqual([...resolvedTimes].sort((a, b) => b - a));
    const funded = resolved.find((r) => r.userId === FUNDED);
    expect(funded).toMatchObject({ balanceCents: 750, grantedCents: 500 });

    const open = await service.requestOperatorCredits(REQUESTER, "again");
    const all = (await service.listCreditRequests("all")).filter((r) => USERS.includes(r.userId));
    expect(all[0].id).toBe(open.id); // most recently requested first
    expect(all.some((r) => r.status === "pending")).toBe(true);
    expect(all.some((r) => r.status !== "pending")).toBe(true);
  });

  it("leaves the public grant() behavior unchanged", async () => {
    const balance = await service.grant(DISMISSED, 40, "promo_grant");
    expect(balance).toBe(40);
    await expect(service.grant(DISMISSED, 0, "promo_grant")).rejects.toThrow("amountCents must be a positive integer");
  });
});
