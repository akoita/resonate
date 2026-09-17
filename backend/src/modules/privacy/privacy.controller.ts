import { Controller, Get, Request, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
import { PersonalDataExportService } from "./personal_data_export.service";
import { writeStructuredLog } from "../shared/structured_logging";

type AuthenticatedRequest = { user?: { userId?: string; role?: string } };

@Controller("privacy")
export class PrivacyController {
  constructor(private readonly exportService: PersonalDataExportService) {}

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
   * `ttl` is **milliseconds** in @nestjs/throttler v5+ (v6.5.0 here:
   * `throttler.service.js` assigns `const ttlMilliseconds = ttl` and feeds it
   * straight to `setTimeout`). So three per hour is 3_600_000, not 3600.
   *
   * Every other `@Throttle` in this repository — and `ThrottlerModule.forRoot`
   * itself — passes second-shaped values, which means their windows are a
   * thousand times shorter than they read. That is tracked as a security
   * defect in #1790. This route does not inherit the mistake: a comment
   * promising "throttled hard" above a limit that is really three per 3.6
   * seconds would be a control that exists only on paper, and this is the one
   * endpoint that returns a person's entire dossier in a single response.
   */
  @Throttle({
    default: {
      limit: 3,
      ttl: 3_600_000,
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
}

function requireUserId(req: AuthenticatedRequest) {
  const userId = req.user?.userId?.trim();
  if (!userId) {
    throw new UnauthorizedException("Missing authenticated user for personal data export");
  }
  return userId;
}
