import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private readonly config: ConfigService) {
    const secret = config.get<string>("JWT_SECRET") || "dev-secret";
    console.log(`[Auth] JwtStrategy initialized. Secret starts with: ${secret.substring(0, 3)}...`);
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: any) {
    console.log(`[Auth] JwtStrategy.validate called with payload:`, JSON.stringify(payload));
    if (!payload || !payload.sub) {
      console.error(`[Auth] Invalid payload in JwtStrategy:`, payload);
      return null;
    }
    const user = { userId: payload.sub, role: payload.role ?? "listener" };
    console.log(`[Auth] User validated:`, JSON.stringify(user));
    return user;
  }
}
