import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { REQUIRE_STEP_UP_KEY } from "./require_step_up.decorator";
import { AdminStepUpTokenService } from "./admin_step_up_token.service";

/** Request header that carries the proof from `POST /admin/step-up/verify`. */
export const ADMIN_STEP_UP_HEADER = "x-admin-step-up";

export type AdminStepUpErrorCode = "step_up_required" | "step_up_expired" | "step_up_invalid";

/**
 * Enforces `@RequireStepUp()` (#2173).
 *
 * Registered globally (`APP_GUARD`), after `RolesGuard`. Like `RolesGuard` it
 * authenticates the JWT itself when `request.user` is not set yet, because Nest
 * runs global guards before the route's `AuthGuard("jwt")`; a step-up route is
 * therefore never reachable on a proof alone, and the proof is only ever
 * compared with the verified session subject, never with anything the client
 * sends.
 *
 * The refusal is a 403, not a 401: the session is fine. The web client
 * (`apiRequest`) treats every 401 as a dead session and signs the person out.
 */
@Injectable()
export class AdminStepUpGuard implements CanActivate {
  private readonly jwt = new (AuthGuard("jwt"))();

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AdminStepUpTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    if (!request.user) {
      // Throws UnauthorizedException (401) when the JWT is missing or invalid.
      await this.jwt.canActivate(context);
    }
    const userId: unknown = request.user?.userId;
    if (typeof userId !== "string" || !userId) {
      throw this.refusal("step_up_invalid");
    }

    const header = request.headers?.[ADMIN_STEP_UP_HEADER];
    const proof = Array.isArray(header) ? header[0] : header;
    const result = this.tokens.checkProof(proof, userId);
    if (result.ok) return true;
    throw this.refusal(
      result.reason === "missing"
        ? "step_up_required"
        : result.reason === "expired"
          ? "step_up_expired"
          : "step_up_invalid",
    );
  }

  private refusal(code: AdminStepUpErrorCode) {
    return new ForbiddenException({
      statusCode: 403,
      code,
      message:
        code === "step_up_required"
          ? "This action needs a fresh confirmation from your passkey or wallet."
          : code === "step_up_expired"
            ? "Your confirmation has expired. Confirm again to continue."
            : "That confirmation is not valid for this account. Confirm again to continue.",
    });
  }
}
