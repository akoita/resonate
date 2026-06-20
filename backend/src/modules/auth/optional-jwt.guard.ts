import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * JWT guard that allows anonymous access. When a valid token is present,
 * `req.user` is populated (so handlers can detect the owner / saved state);
 * when it is missing or invalid, the request proceeds with no user instead of
 * being rejected. Use for endpoints that are public but behave differently for
 * the authenticated owner — e.g. viewing a public playlist.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
    handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser | undefined {
        return user || undefined;
    }
}
