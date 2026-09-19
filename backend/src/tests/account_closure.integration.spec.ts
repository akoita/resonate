/**
 * The account-closure state machine (#1771 slice 3), against a real Postgres.
 *
 * There is no erasure here: this suite covers the transitions, the 30-day
 * window, and the one thing that cannot be tested without a database — the
 * partial unique index that makes two simultaneous requests impossible. An
 * account that stacked two pending requests would have the erasure engine run
 * against it twice, and the second run would find a person who no longer
 * exists.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { AccountClosureStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  ACCOUNT_CLOSURE_WINDOW_DAYS,
  ACCOUNT_CLOSURE_WINDOW_MS,
  AccountClosureService,
  AccountClosureTransitionError,
} from "../modules/privacy/account_closure.service";

const TEST_PREFIX = `account_closure_${Date.now()}_`;

const USER_A = `${TEST_PREFIX}user_a`;
const USER_B = `${TEST_PREFIX}user_b`;
const USER_C = `${TEST_PREFIX}user_c`;
const USER_IDS = [USER_A, USER_B, USER_C];

const service = new AccountClosureService();

async function seedUser(id: string) {
  await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
}

async function clearRequests() {
  await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: USER_IDS } } });
}

const MIGRATION_SQL = resolve(
  __dirname,
  "../../prisma/migrations/20260917160000_account_closure_request/migration.sql",
);

/**
 * The partial unique index, taken verbatim out of the migration.
 *
 * Integration tests build their schema with `prisma db push` from
 * `schema.prisma` (see `globalSetup.js`), and Prisma cannot express a filtered
 * index, so the guard that production gets from `prisma migrate deploy` is
 * absent here. Rather than skip the test — leaving the most important
 * constraint in this slice unexercised — the suite applies the migration's own
 * statement and then exercises it. Reading it from the file rather than
 * retyping it means editing the migration changes what this test runs.
 */
function partialUniqueIndexStatement(): string {
  const sql = readFileSync(MIGRATION_SQL, "utf8");
  const match = sql.match(
    /CREATE UNIQUE INDEX "AccountClosureRequest_one_pending_per_user"[\s\S]*?;/,
  );
  if (!match) throw new Error(`Partial unique index not found in ${MIGRATION_SQL}`);
  return match[0];
}

beforeAll(async () => {
  for (const id of USER_IDS) await seedUser(id);

  const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'AccountClosureRequest_one_pending_per_user'
    ) AS "exists"`;
  if (!exists) await prisma.$executeRawUnsafe(partialUniqueIndexStatement());
});

afterEach(async () => {
  await clearRequests();
});

afterAll(async () => {
  await clearRequests();
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await prisma.$disconnect();
});

describe("AccountClosureService", () => {
  describe("request", () => {
    it("schedules the closure a window into the future rather than doing it now", async () => {
      const before = Date.now();
      const request = await service.request(USER_A, "  leaving  ");
      const after = Date.now();

      expect(request.status).toBe(AccountClosureStatus.pending);
      expect(request.userId).toBe(USER_A);
      // Trimmed, and kept: this is the person's own free text, which the
      // erasure manifest scrubs when the closure completes.
      expect(request.reason).toBe("leaving");
      expect(request.cancelledAt).toBeNull();
      expect(request.completedAt).toBeNull();
      expect(request.failedAt).toBeNull();

      const gap = request.dueAt.getTime() - request.requestedAt.getTime();
      expect(gap).toBe(ACCOUNT_CLOSURE_WINDOW_MS);
      expect(ACCOUNT_CLOSURE_WINDOW_DAYS).toBe(30);
      expect(request.dueAt.getTime()).toBeGreaterThanOrEqual(before + ACCOUNT_CLOSURE_WINDOW_MS - 5_000);
      expect(request.dueAt.getTime()).toBeLessThanOrEqual(after + ACCOUNT_CLOSURE_WINDOW_MS + 5_000);
    });

    it("stores no reason when none was given", async () => {
      const request = await service.request(USER_A);
      expect(request.reason).toBeNull();
      const blank = await service.request(USER_B, "   ");
      expect(blank.reason).toBeNull();
    });

    it("is idempotent: a second request returns the first, untouched", async () => {
      const first = await service.request(USER_A, "first reason");
      const second = await service.request(USER_A, "second reason");

      expect(second.id).toBe(first.id);
      // The due date is not pushed out and the reason is not overwritten, so a
      // double-tap on the button cannot extend or rewrite a live request.
      expect(second.dueAt.getTime()).toBe(first.dueAt.getTime());
      expect(second.reason).toBe("first reason");

      const rows = await prisma.accountClosureRequest.findMany({ where: { userId: USER_A } });
      expect(rows).toHaveLength(1);
    });

    it("cannot stack two pending requests, even when the calls race", async () => {
      const results = await Promise.allSettled([
        service.request(USER_A),
        service.request(USER_A),
        service.request(USER_A),
      ]);

      // Every caller gets an answer; the read-then-create loses the race
      // sometimes and the partial unique index catches it.
      for (const result of results) expect(result.status).toBe("fulfilled");

      const pending = await prisma.accountClosureRequest.findMany({
        where: { userId: USER_A, status: AccountClosureStatus.pending },
      });
      expect(pending).toHaveLength(1);
    });

    it("is rejected by the database, not just by the service, on a second pending row", async () => {
      const first = await service.request(USER_A);

      // Straight at Prisma, bypassing the service entirely: the constraint has
      // to live in the schema, because a future caller will not go through here.
      const second = prisma.accountClosureRequest.create({
        data: {
          userId: USER_A,
          status: AccountClosureStatus.pending,
          dueAt: new Date(Date.now() + ACCOUNT_CLOSURE_WINDOW_MS),
        },
      });
      await expect(second).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      await expect(second).rejects.toMatchObject({ code: "P2002" });

      expect((await service.findPending(USER_A))?.id).toBe(first.id);
    });

    it("keeps one person's request out of another's", async () => {
      const a = await service.request(USER_A);
      const b = await service.request(USER_B);
      expect(a.id).not.toBe(b.id);
      expect((await service.findPending(USER_A))?.id).toBe(a.id);
      expect((await service.findPending(USER_B))?.id).toBe(b.id);
      expect(await service.findPending(USER_C)).toBeNull();
    });
  });

  describe("cancel", () => {
    it("moves a pending request to cancelled and stamps it", async () => {
      const request = await service.request(USER_A);
      const cancelled = await service.cancel(USER_A);

      expect(cancelled?.id).toBe(request.id);
      expect(cancelled?.status).toBe(AccountClosureStatus.cancelled);
      expect(cancelled?.cancelledAt).toBeInstanceOf(Date);
      expect(await service.findPending(USER_A)).toBeNull();
    });

    it("returns null rather than throwing when there is nothing to cancel", async () => {
      // The caller with the strongest claim to this method is an ordinary
      // sign-in, and almost every sign-in has nothing to cancel.
      expect(await service.cancel(USER_A)).toBeNull();
    });

    it("is safe to call twice", async () => {
      await service.request(USER_A);
      await service.cancel(USER_A);
      expect(await service.cancel(USER_A)).toBeNull();

      const rows = await prisma.accountClosureRequest.findMany({ where: { userId: USER_A } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(AccountClosureStatus.cancelled);
    });

    it("lets the person ask again afterwards, so history accumulates", async () => {
      const first = await service.request(USER_A);
      await service.cancel(USER_A);
      const second = await service.request(USER_A);

      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe(AccountClosureStatus.pending);
      // The unique index is partial, so a cancelled row does not block a new one.
      const rows = await prisma.accountClosureRequest.findMany({ where: { userId: USER_A } });
      expect(rows).toHaveLength(2);
    });
  });

  describe("listDue", () => {
    it("returns nothing while the window is still open", async () => {
      await service.request(USER_A);
      const due = await service.listDue(new Date());
      expect(due.map((row) => row.userId)).not.toContain(USER_A);
    });

    it("returns a request once its date has passed", async () => {
      const request = await service.request(USER_A);
      const due = await service.listDue(new Date(request.dueAt.getTime() + 1));
      expect(due.map((row) => row.id)).toContain(request.id);
    });

    it("ignores cancelled, completed and failed requests", async () => {
      const cancelled = await service.request(USER_A);
      await service.cancel(USER_A);
      const completed = await service.request(USER_B);
      await service.markCompleted(completed.id);
      const failed = await service.request(USER_C);
      await service.markFailed(failed.id, "engine blew up");

      const wellPastDue = new Date(Date.now() + ACCOUNT_CLOSURE_WINDOW_MS * 2);
      const dueIds = (await service.listDue(wellPastDue)).map((row) => row.id);
      expect(dueIds).not.toContain(cancelled.id);
      expect(dueIds).not.toContain(completed.id);
      expect(dueIds).not.toContain(failed.id);
    });

    it("returns the oldest first and honours a limit", async () => {
      const now = Date.now();
      // Written straight through Prisma so the due dates can be ordered
      // deliberately rather than all landing in the same millisecond.
      for (const [index, userId] of USER_IDS.entries()) {
        await prisma.accountClosureRequest.create({
          data: {
            userId,
            status: AccountClosureStatus.pending,
            requestedAt: new Date(now - ACCOUNT_CLOSURE_WINDOW_MS - (3 - index) * 60_000),
            dueAt: new Date(now - (3 - index) * 60_000),
          },
        });
      }

      const due = await service.listDue(new Date(now));
      const ours = due.filter((row) => USER_IDS.includes(row.userId));
      expect(ours.map((row) => row.userId)).toEqual([USER_A, USER_B, USER_C]);

      const limited = await service.listDue(new Date(now), 1);
      expect(limited).toHaveLength(1);
    });
  });

  describe("settling a request", () => {
    it("completes a pending request once", async () => {
      const request = await service.request(USER_A);
      const completed = await service.markCompleted(request.id);

      expect(completed.status).toBe(AccountClosureStatus.completed);
      expect(completed.completedAt).toBeInstanceOf(Date);
      expect(completed.failedAt).toBeNull();
      expect(await service.findPending(USER_A)).toBeNull();

      await expect(service.markCompleted(request.id)).rejects.toBeInstanceOf(
        AccountClosureTransitionError,
      );
    });

    it("records a failure with its operator-facing message", async () => {
      const request = await service.request(USER_A);
      const failed = await service.markFailed(request.id, "warehouse erasure unavailable");

      expect(failed.status).toBe(AccountClosureStatus.failed);
      expect(failed.failedAt).toBeInstanceOf(Date);
      expect(failed.failureMessage).toBe("warehouse erasure unavailable");
      expect(failed.completedAt).toBeNull();
    });

    it("records a retryable failure without consuming the pending request", async () => {
      const request = await service.request(USER_A);
      const attempted = await service.recordAttemptFailure(request.id, "warehouse rows still buffered");

      expect(attempted.status).toBe(AccountClosureStatus.pending);
      expect(attempted.failedAt).toBeInstanceOf(Date);
      expect(attempted.failureMessage).toBe("warehouse rows still buffered");
      await expect(service.findPending(USER_A)).resolves.toEqual(
        expect.objectContaining({ id: request.id, status: AccountClosureStatus.pending }),
      );
    });

    it("refuses to complete a request the person cancelled mid-run", async () => {
      const request = await service.request(USER_A);
      await service.cancel(USER_A);

      // The engine finishing after a cancellation must not record the closure
      // as done; the conditional update turns that into a loud failure.
      await expect(service.markCompleted(request.id)).rejects.toBeInstanceOf(
        AccountClosureTransitionError,
      );
      await expect(service.markFailed(request.id, "late")).rejects.toBeInstanceOf(
        AccountClosureTransitionError,
      );

      const row = await prisma.accountClosureRequest.findUnique({ where: { id: request.id } });
      expect(row?.status).toBe(AccountClosureStatus.cancelled);
      expect(row?.completedAt).toBeNull();
    });

    it("refuses to settle a request that does not exist", async () => {
      await expect(service.markFailed(`${TEST_PREFIX}missing`, "nope")).rejects.toBeInstanceOf(
        AccountClosureTransitionError,
      );
    });

    it("does not touch the User row — closing is not erasing", async () => {
      const request = await service.request(USER_A);
      await service.markCompleted(request.id);

      const user = await prisma.user.findUnique({ where: { id: USER_A } });
      // This service owns transitions only. Marking `closedAt`/`erasedAt` and
      // rotating the id belong to the erasure engine.
      expect(user).not.toBeNull();
      expect(user?.closedAt).toBeNull();
      expect(user?.erasedAt).toBeNull();
      expect(user?.email).toBe(`${USER_A}@test.resonate`);
    });
  });
});
