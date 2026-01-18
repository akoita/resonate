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
    const allowedRole = this.resolveRole(userId, role);
    const token = this.jwtService.sign({ sub: userId, role: allowedRole });
    this.auditService.log({
      action: "auth.login",
      actorId: userId,
      resource: "auth",
      metadata: { role: allowedRole },
    });
    return { accessToken: token };
  }

  issueTokenForAddress(address: string, role = "listener") {
    return this.issueToken(address.toLowerCase(), role);
  }

  private resolveRole(userId: string, role: string) {
    if (role !== "admin") {
      return role;
    }
    const allowList = (process.env.ADMIN_ADDRESSES ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (allowList.includes(userId.toLowerCase())) {
      return "admin";
    }
    return "listener";
  }
}
