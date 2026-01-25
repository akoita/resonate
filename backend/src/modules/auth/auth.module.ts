import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPublicClient, http, type Chain } from "viem";
import { sepolia, foundry } from "viem/chains";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuditModule } from "../audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthNonceService } from "./auth_nonce.service";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

/**
 * Get chain config based on RPC URL
 * - Local (localhost:8545): Use foundry chain (31337)
 * - Otherwise: Use Sepolia
 */
function getChainFromRpc(rpcUrl: string | undefined): { chain: Chain; transport: ReturnType<typeof http> } {
  if (rpcUrl?.includes("localhost:8545") || rpcUrl?.includes("127.0.0.1:8545")) {
    return {
      chain: foundry,
      transport: http(rpcUrl),
    };
  }
  return {
    chain: sepolia,
    transport: rpcUrl ? http(rpcUrl) : http(),
  };
}

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
        const rpcUrl = config.get<string>("RPC_URL");
        const { chain, transport } = getChainFromRpc(rpcUrl);
        console.log(`[Auth] PUBLIC_CLIENT chain: ${chain.name} (${chain.id}), RPC: ${rpcUrl || 'default'}`);
        return createPublicClient({
          chain,
          transport,
        });
      },
    },
  ],
  exports: [AuthService, "PUBLIC_CLIENT"],
})
export class AuthModule { }
