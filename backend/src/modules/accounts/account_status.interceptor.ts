import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { ALLOW_WHILE_SUSPENDED_KEY } from "./allow_while_suspended.decorator";
import { AccountStatusService } from "./account_status.service";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The single enforcement point for operator account suspension and closure
 * (#2147).
 *
 * An interceptor rather than a global guard on purpose: Nest runs global guards
 * before route guards, so at guard time `request.user` is not yet populated by
 * the route's `AuthGuard("jwt")` (see `RolesGuard`, which has to authenticate
 * itself for that reason). Interceptors run after every guard, so by the time
 * this runs the caller is authenticated by whatever the route declared
 * (`AuthGuard`, `OptionalJwtGuard`) and `request.user.userId` is trustworthy.
 *
 * - Unauthenticated requests pass through; the route's own guard decides.
 * - GET/HEAD/OPTIONS are never blocked: a restricted person can read their data.
 * - A mutating request from a suspended or closed account is refused with 403
 *   `{ code: "account_suspended" | "account_closed", until? }`, unless the
 *   handler or controller carries `@AllowWhileSuspended()` (sign-in, refund
 *   claims, data export and erasure, notices).
 *
 * Limit: this guards the HTTP API only. A transaction the person signs directly
 * with their own wallet never reaches the backend, so suspension is a
 * platform-level restriction, not an on-chain one.
 */
@Injectable()
export class AccountStatusInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly accounts: AccountStatusService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();

    const request = context.switchToHttp().getRequest();
    if (!MUTATING_METHODS.has(String(request?.method ?? "").toUpperCase())) return next.handle();

    const userId: unknown = request?.user?.userId;
    if (typeof userId !== "string" || !userId) return next.handle();

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_SUSPENDED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return next.handle();

    const state = await this.accounts.getEffective(userId);
    if (state.status === "active") return next.handle();

    const closed = state.status === "closed";
    throw new ForbiddenException({
      statusCode: 403,
      code: closed ? "account_closed" : "account_suspended",
      message: closed
        ? "This account has been closed, so it can no longer make changes. You can still sign in, claim refunds, read notices and export your data."
        : "This account is suspended, so it can't make changes right now. You can still sign in, claim refunds, read notices and export your data.",
      ...(state.until ? { until: state.until } : {}),
    });
  }
}
