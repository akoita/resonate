import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { UserActivityService } from "./user_activity.service";

/**
 * Records "last active" for the signed-in caller (#2166).
 *
 * An interceptor for the same reason `AccountStatusInterceptor` is: it runs
 * after every guard, so `request.user.userId` is populated by whichever auth
 * guard the route declared. Unauthenticated requests record nothing. The write
 * is fire-and-forget and bounded by `UserActivityService`; it never delays or
 * fails the request.
 */
@Injectable()
export class UserActivityInterceptor implements NestInterceptor {
  constructor(private readonly activity: UserActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === "http") {
      const userId: unknown = context.switchToHttp().getRequest()?.user?.userId;
      if (typeof userId === "string" && userId) {
        try {
          // Never awaited and never allowed to reject into the request.
          void Promise.resolve(this.activity.touch(userId)).catch(() => undefined);
        } catch {
          // A synchronous failure in tracking must not fail the request either.
        }
      }
    }
    return next.handle();
  }
}
