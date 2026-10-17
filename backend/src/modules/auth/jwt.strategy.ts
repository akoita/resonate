import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { normalizeUserId } from "../identity/user_id";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private readonly config: ConfigService) {
    const secret = config.get<string>("JWT_SECRET") || "dev-secret";
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: any) {
    if (!payload || !payload.sub) {
      return null;
    }
    // #2180: wallet-account ids are lowercase addresses; normalise here so
    // every handler that reads req.user.userId sees the canonical id.
    const user = { userId: normalizeUserId(payload.sub), role: payload.role ?? "listener" };
    return user;
  }
}
