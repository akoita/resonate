import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET") || "dev-secret",
        signOptions: { expiresIn: "15m" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthNonceService,
    JwtStrategy,
    {
      provide: "PUBLIC_CLIENT",
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Use RPC_URL for read operations (verifySignature), fallback to default Sepolia
        const rpcUrl = config.get<string>("RPC_URL");
        return createPublicClient({
          chain: sepolia,
          transport: rpcUrl ? http(rpcUrl) : http(),
        });
      },
    },
  ],
  exports: [AuthService, "PUBLIC_CLIENT"],
})
export class AuthModule { }
