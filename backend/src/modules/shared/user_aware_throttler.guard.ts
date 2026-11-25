import { ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt.guard";

/**
 * The global rate-limit guard, made able to count per person.
 *
 * Nest runs global (`APP_GUARD`) guards before a route's own guards, so when
 * the stock `ThrottlerGuard` picks a tracker the route's `AuthGuard("jwt")`
 * has not run yet and `req.user` is unset. Every `getTracker: trackByUser`
 * limit was therefore counted per address, not per person.
 *
 * This guard verifies a bearer token first, with the same passport strategy
 * the routes use, and sets `req.user` only when the token is valid. A missing,
 * expired or forged token leaves the request anonymous and it is counted by
 * address; the route's own guard still decides whether it may proceed, so this
 * never lets a request through that would otherwise be refused. Verification
 * is one HMAC check, and only for requests that carry a bearer token.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(UserAwareThrottlerGuard.name);
  private readonly optionalJwt = new OptionalJwtAuthGuard();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() === "http") {
      await this.resolveUser(context);
    }
    return super.canActivate(context);
  }

  private async resolveUser(context: ExecutionContext): Promise<void> {
    const req = context.switchToHttp().getRequest();
    if (!req || req.user) return;
    const header = req.headers?.authorization;
    if (typeof header !== "string" || !/^bearer\s+\S/i.test(header)) return;
    try {
      // Sets `req.user` for a valid token, leaves it unset otherwise.
      await this.optionalJwt.canActivate(context);
    } catch (error) {
      // An app without the JWT strategy (some controller test apps) or a
      // passport failure: count by address and let the route decide.
      this.logger.debug(
        `Rate-limit identity not resolved: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
