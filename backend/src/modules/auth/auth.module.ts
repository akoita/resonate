import { Module } from "@nestjs/common";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuditModule } from "../audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthNonceService } from "./auth_nonce.service";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  imports: [
    PassportModule,
    AuditModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || "dev-secret",
      signOptions: { expiresIn: "15m" },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthNonceService,
    JwtStrategy,
    {
      provide: "PUBLIC_CLIENT",
      useFactory: () => {
        const rpcUrl = process.env.AA_BUNDLER || "http://localhost:4337";
        return createPublicClient({
          chain: sepolia, // Consistent with frontend
          transport: rpcUrl.startsWith("http") ? http(rpcUrl) : http(),
        });
      },
    },
  ],
  exports: [AuthService, "PUBLIC_CLIENT"],
})
export class AuthModule { }
