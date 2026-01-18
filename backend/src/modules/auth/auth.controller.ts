import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60 } })
  login(@Body() body: { userId: string; role?: string }) {
    return this.authService.issueToken(body.userId, body.role ?? "listener");
  }
}
