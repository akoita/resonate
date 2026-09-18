import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Request,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { AccountClosureRequest } from "@prisma/client";
import { Response } from "express";
import {
  ACCOUNT_CLOSURE_WINDOW_DAYS,
  AccountClosureService,
} from "./account_closure.service";
import { AccountClosureStepUpService } from "./account_closure_step_up.service";
import { PersonalDataExportService } from "./personal_data_export.service";
import { hours } from "../shared/rate_limits";
import { writeStructuredLog } from "../shared/structured_logging";

type AuthenticatedRequest = { user?: { userId?: string; role?: string } };

/**
 * A closure request as the account holder sees it.
 *
 * Built by hand rather than returning the row: `failureMessage` is
 * operator-facing detail about a failed erasure run and must not be shown to
 * the person, and a row spread into a response is exactly how such a field
 * arrives in a UI later without anybody deciding it should.
 */
function closureView(request: AccountClosureRequest | null) {
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    requestedAt: request.requestedAt.toISOString(),
    dueAt: request.dueAt.toISOString(),
    reason: request.reason,
  };
}

/**
 * Per-person rate-limit tracking, shared by the closure routes.
 *
 * See `exportPersonalData` below for why `req.ip` is the wrong tracker on an
 * authenticated route in both directions.
 */
const trackByUser = (req: Record<string, any>) => req.user?.userId ?? req.ip;

@Controller("privacy")
export class PrivacyController {
  constructor(
    private readonly exportService: PersonalDataExportService,
    private readonly closureService: AccountClosureService,
    private readonly closureStepUp: AccountClosureStepUpService,
  ) {}

  /**
   * Download everything we hold about the signed-in person.
   *
   * **The user id comes from `req.user.userId` and nowhere else.** No id is
   * read from a path parameter, a query string or a body. This endpoint returns
   * a person's entire dossier — email, wallet addresses, purchase history,
   * private messages, analytics — so an id taken from the request would turn
   * one authenticated account into a reader of every account. That is a data
   * breach with a REST interface, and it is exactly the change a later "let
   * support export on a user's behalf" edit is most likely to make. Anything
   * operator-initiated belongs on a separate, role-guarded route.
   *
   * Throttled hard: this is simultaneously the most expensive query in the API
   * and the most valuable single response in it, so it is both an amplification
   * vector and the thing an attacker with a stolen token would ask for first.
   *
   * The window is written with `hours()` rather than a bare number because
   * `ttl` is milliseconds — see `shared/rate_limits.ts` for why every limit in
   * this repository was once a thousand times shorter than it read (#1790).
   */
  @Throttle({
    default: {
      limit: 3,
      ttl: hours(1),
      // Tracked per person, not per IP. `ThrottlerGuard.getTracker` returns
      // `req.ip` by default, which is wrong in both directions for an
      // authenticated route: a household or office behind one NAT shares a
      // budget meant for one account, and somebody holding a stolen token
      // rotates IPs to lift the limit entirely. The guard runs after
      // `AuthGuard`, so `req.user` is populated; the IP fallback only applies
      // on a path where the guard let an unauthenticated request through,
      // which `requireUserId` then rejects anyway.
      getTracker: (req: Record<string, any>) => req.user?.userId ?? req.ip,
    },
  })
  @UseGuards(AuthGuard("jwt"))
  @Get("export")
  async exportPersonalData(@Request() req: AuthenticatedRequest, @Res() res: Response) {
    const userId = requireUserId(req);

    // Resolve before any byte is written: once the document starts streaming
    // the 200 is committed, and an unknown user has to fail as a status code.
    const prepared = await this.exportService.prepare(userId);

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // Date only. The filename lands in a downloads folder, a shell history and
    // any sync client in between; it must not carry the user id or the email.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="resonate-data-export-${date}.json"`,
    );
    res.setHeader("Cache-Control", "no-store");

    await prepared.writeTo(res);
    res.end();

    // Record that the dossier left the building. Only failures were logged
    // before, which left the most sensitive response in the API as the one
    // with no trace: if a token is stolen and used here, nothing afterwards
    // could say whether the account's data had been taken. The log carries the
    // user id and nothing from the file itself.
    writeStructuredLog({
      level: "info",
      event: "privacy.personal_data_export.served",
      message: "Personal data export served to the account holder",
      userId,
    });
  }

  /**
   * Ask for the words to sign in order to close this account.
   *
   * Returns the address the signature must come from, the exact message to
   * sign, and the single-use nonce inside it. The client displays and signs the
   * message; it does not compose one. The copy returned here is for the human
   * and the wallet — the request route below rebuilds the same text from server
   * state and verifies against its own reconstruction.
   *
   * **The user id comes from `req.user.userId` and nowhere else**, as on every
   * route in this controller. A challenge issued for an id taken from the
   * request would be a challenge for somebody else's account.
   */
  @Throttle({ default: { limit: 10, ttl: hours(1), getTracker: trackByUser } })
  @UseGuards(AuthGuard("jwt"))
  @Post("account/closure/challenge")
  async requestAccountClosureChallenge(@Request() req: AuthenticatedRequest) {
    const userId = requireUserId(req);
    return this.closureStepUp.challenge(userId);
  }

  /**
   * Schedule this account's closure and erasure.
   *
   * **The user id comes from `req.user.userId` and nowhere else.** The body
   * carries an address and a signature and nothing else that matters; an id in
   * the body, the query or a path would turn one authenticated session into the
   * ability to delete other people's accounts, which is the most destructive
   * version of the mistake `exportPersonalData` describes.
   *
   * **The message verified is the one this server builds.** The body has no
   * `message` field on purpose: accepting one would let a caller obtain a
   * signature over some other text — a sign-in prompt, a transaction
   * confirmation — and submit it as consent to delete an account. Naming the
   * action in the message is only worth something if the client cannot choose
   * the words.
   *
   * Throttled per person for the same reason as the export: the limit protects
   * an account, and an attacker with a stolen token rotates IPs freely. A
   * handful an hour is far above what a real person needs — the route is
   * idempotent while a request is pending, so the only honest repeat is a retry
   * after a failed signature.
   */
  @Throttle({ default: { limit: 5, ttl: hours(1), getTracker: trackByUser } })
  @UseGuards(AuthGuard("jwt"))
  @Post("account/closure")
  async requestAccountClosure(
    @Request() req: AuthenticatedRequest,
    @Body() body: { address?: string; signature?: string; reason?: string },
  ) {
    const userId = requireUserId(req);

    const stepUpMode = await this.closureStepUp.verify({
      userId,
      address: body?.address ?? "",
      signature: (body?.signature ?? "") as `0x${string}`,
    });

    const request = await this.closureService.request(userId, body?.reason);

    writeStructuredLog({
      level: "info",
      event: "privacy.account_closure.requested",
      message: "Account closure scheduled at the account holder's request",
      userId,
      stepUpMode,
      dueAt: request.dueAt.toISOString(),
    });

    return { request: closureView(request), windowDays: ACCOUNT_CLOSURE_WINDOW_DAYS };
  }

  /**
   * Whether a closure is scheduled for this account, and when it runs.
   *
   * No step-up: reading your own state is not destructive, and a person who
   * cannot produce a signature still has to be able to find out that their
   * account is about to be deleted.
   */
  @UseGuards(AuthGuard("jwt"))
  @Get("account/closure")
  async getAccountClosure(@Request() req: AuthenticatedRequest) {
    const userId = requireUserId(req);
    const request = await this.closureService.findPending(userId);
    return { request: closureView(request), windowDays: ACCOUNT_CLOSURE_WINDOW_DAYS };
  }

  /**
   * Call off a scheduled closure.
   *
   * **No signature is required here, deliberately — this asymmetry is not an
   * oversight.** Requiring proof to *stop* an irreversible deletion would mean
   * a person who lost their signer, changed their passkey or broke their phone
   * could not save their own account; the demand for proof would fall hardest
   * on exactly the people most likely to have had a closure scheduled without
   * their knowledge. Cancelling is the safe direction: the worst outcome is an
   * account that survives when its owner wanted it gone, and they can ask
   * again. Deleting is the direction that cannot be walked back, and that is
   * the one the step-up guards.
   */
  @UseGuards(AuthGuard("jwt"))
  @Delete("account/closure")
  async cancelAccountClosure(@Request() req: AuthenticatedRequest) {
    const userId = requireUserId(req);
    const cancelled = await this.closureService.cancel(userId);

    if (cancelled) {
      writeStructuredLog({
        level: "info",
        event: "privacy.account_closure.cancelled",
        message: "Scheduled account closure cancelled by the account holder",
        userId,
      });
    }

    return {
      cancelled: Boolean(cancelled),
      request: null,
      windowDays: ACCOUNT_CLOSURE_WINDOW_DAYS,
    };
  }
}

function requireUserId(req: AuthenticatedRequest) {
  const userId = req.user?.userId?.trim();
  if (!userId) {
    throw new UnauthorizedException("Missing authenticated user for this privacy request");
  }
  return userId;
}
