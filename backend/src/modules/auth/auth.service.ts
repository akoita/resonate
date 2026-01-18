import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService
  ) {}

  issueToken(userId: string, role = "listener") {
    const token = this.jwtService.sign({ sub: userId, role });
    this.auditService.log({
      action: "auth.login",
      actorId: userId,
      resource: "auth",
      metadata: { role },
    });
    return { accessToken: token };
  }
}
