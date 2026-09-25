import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  // Nest runs global (APP_GUARD) guards before controller/route guards, so when
  // this guard is registered globally the route's AuthGuard("jwt") has not yet
  // populated request.user. Authenticate here instead of deferring, so a
  // @Roles route is never reachable without a verified role (fail closed).
  private readonly jwt = new (AuthGuard("jwt"))();

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    if (!request.user) {
      // Throws UnauthorizedException (401) when the JWT is missing or invalid.
      await this.jwt.canActivate(context);
    }
    const role = request.user?.role ?? "listener";
    return required.includes(role);
  }
}
