import { Injectable } from "@nestjs/common";
import { AccountClosureRequest, AccountClosureStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

/**
 * How long a closure request waits before the erasure engine may run it.
 *
 * Closure is scheduled, never immediate. There is no email channel in this
 * backend yet (#1777), so nothing can tell a person "someone asked to delete
 * your account" — and erasure is irreversible in a way nothing else in the
 * product is. This window is therefore the only protection a real owner has
 * against a stolen token closing their account: signing in cancels a pending
 * request, so an attacker has to keep the owner locked out for a month rather
 * than for a minute.
 *
 * Thirty days also matches the quarantine window already stated in the privacy
 * policy's retention table, so a person reading both sees one number.
 */
export const ACCOUNT_CLOSURE_WINDOW_DAYS = 30;

/** The window in milliseconds, so callers do not re-derive it. */
export const ACCOUNT_CLOSURE_WINDOW_MS = ACCOUNT_CLOSURE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Postgres unique-violation code, raised by the one-pending-per-user index. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Raised when a request is asked to move from a state it is not in — for
 * example completing a request the person already cancelled. A plain error
 * rather than an HTTP exception, because the erasure engine runs this from a
 * scheduled worker where a status code means nothing.
 */
export class AccountClosureTransitionError extends Error {
  constructor(
    readonly requestId: string,
    readonly attempted: AccountClosureStatus,
  ) {
    super(
      `Account closure request ${requestId} cannot move to "${attempted}": it is no longer pending.`,
    );
    this.name = "AccountClosureTransitionError";
  }
}

/**
 * The account-closure state machine (#1771 slice 3).
 *
 * Transitions only. This service creates, cancels and settles requests; it does
 * not erase anything, does not touch `User`, and does not know what the erasure
 * engine does with the manifest. Keeping the two apart is what lets the window
 * above be tested without a Prisma-wide erasure running in a test database.
 *
 * The state graph is deliberately tiny and one-way out of `pending`:
 *
 *     pending ──cancel──▶ cancelled
 *        │
 *        ├──markCompleted──▶ completed
 *        └──markFailed─────▶ failed
 *
 * A cancelled, completed or failed request is history and never moves again. A
 * new request after a cancellation is a new row, which is why the uniqueness
 * constraint in the migration is partial (`WHERE status = 'pending'`).
 */
@Injectable()
export class AccountClosureService {
  /**
   * Ask to close an account.
   *
   * Idempotent by design: a second request while one is pending returns the
   * existing row untouched rather than stacking a second one or pushing the due
   * date out. Two guards enforce that — a read-then-create here, and the
   * partial unique index underneath for the race the read cannot see. If the
   * index fires, the row the other caller just wrote is the answer.
   */
  async request(userId: string, reason?: string | null): Promise<AccountClosureRequest> {
    const existing = await this.findPending(userId);
    if (existing) return existing;

    const requestedAt = new Date();
    try {
      return await prisma.accountClosureRequest.create({
        data: {
          userId,
          status: AccountClosureStatus.pending,
          requestedAt,
          dueAt: new Date(requestedAt.getTime() + ACCOUNT_CLOSURE_WINDOW_MS),
          reason: reason?.trim() || null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === UNIQUE_VIOLATION
      ) {
        const raced = await this.findPending(userId);
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Cancel whatever is pending for this person, and return it.
   *
   * Returns `null` when there is nothing pending, because the caller with the
   * strongest claim to call this is an ordinary sign-in: every successful
   * authentication cancels a scheduled closure, and almost every sign-in has
   * nothing to cancel. That path must never throw.
   */
  async cancel(userId: string): Promise<AccountClosureRequest | null> {
    const pending = await this.findPending(userId);
    if (!pending) return null;

    const cancelledAt = new Date();
    const moved = await prisma.accountClosureRequest.updateMany({
      where: { id: pending.id, status: AccountClosureStatus.pending },
      data: { status: AccountClosureStatus.cancelled, cancelledAt },
    });
    if (moved.count === 0) {
      // Something else settled it between the read and the write. Whatever it
      // became, it is no longer pending, which is what the caller wanted.
      return prisma.accountClosureRequest.findUnique({ where: { id: pending.id } });
    }
    return prisma.accountClosureRequest.findUnique({ where: { id: pending.id } });
  }

  /** The pending request for this person, or `null`. At most one can exist. */
  async findPending(userId: string): Promise<AccountClosureRequest | null> {
    return prisma.accountClosureRequest.findFirst({
      where: { userId, status: AccountClosureStatus.pending },
      orderBy: { requestedAt: "asc" },
    });
  }

  /**
   * Requests whose window has elapsed, oldest first — the erasure engine's
   * queue.
   *
   * `now` is a parameter rather than read from the clock so a test can reach a
   * due date thirty days out without waiting or faking timers.
   */
  async listDue(now: Date, limit?: number): Promise<AccountClosureRequest[]> {
    return prisma.accountClosureRequest.findMany({
      where: { status: AccountClosureStatus.pending, dueAt: { lte: now } },
      orderBy: { dueAt: "asc" },
      ...(limit === undefined ? {} : { take: limit }),
    });
  }

  /**
   * The erasure finished. Called by the engine, once, after the last write.
   *
   * Only a pending request may complete: a request the person cancelled while
   * the engine was mid-run must not be recorded as done, and the conditional
   * update is what makes that a failed transition rather than a silent
   * overwrite.
   */
  async markCompleted(requestId: string): Promise<AccountClosureRequest> {
    return this.settle(requestId, AccountClosureStatus.completed, {
      completedAt: new Date(),
      failedAt: null,
      failureMessage: null,
    });
  }

  /**
   * Record a retryable attempt without consuming the person's pending request.
   *
   * A temporary warehouse refusal (notably BigQuery's streaming buffer) must
   * make the current job fail, while leaving the request cancellable on sign-in
   * and eligible for the next scheduled attempt.
   */
  async recordAttemptFailure(requestId: string, message: string): Promise<AccountClosureRequest> {
    const moved = await prisma.accountClosureRequest.updateMany({
      where: { id: requestId, status: AccountClosureStatus.pending },
      data: { failedAt: new Date(), failureMessage: message },
    });
    if (moved.count === 0) throw new AccountClosureTransitionError(requestId, AccountClosureStatus.failed);
    const request = await prisma.accountClosureRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AccountClosureTransitionError(requestId, AccountClosureStatus.failed);
    return request;
  }

  /**
   * The erasure did not finish. `message` is operator-facing detail and is
   * never shown to the person; the manifest scrubs it if the account is later
   * erased successfully.
   */
  async markFailed(requestId: string, message: string): Promise<AccountClosureRequest> {
    return this.settle(requestId, AccountClosureStatus.failed, {
      failedAt: new Date(),
      failureMessage: message,
    });
  }

  private async settle(
    requestId: string,
    status: AccountClosureStatus,
    extra: Prisma.AccountClosureRequestUpdateManyMutationInput,
  ): Promise<AccountClosureRequest> {
    const moved = await prisma.accountClosureRequest.updateMany({
      where: { id: requestId, status: AccountClosureStatus.pending },
      data: { status, ...extra },
    });
    if (moved.count === 0) throw new AccountClosureTransitionError(requestId, status);

    const settled = await prisma.accountClosureRequest.findUnique({ where: { id: requestId } });
    if (!settled) throw new AccountClosureTransitionError(requestId, status);
    return settled;
  }
}
