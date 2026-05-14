import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { createPublicClient, http, type Chain } from "viem";
import { base, baseSepolia, foundry, sepolia } from "viem/chains";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuditModule } from "../audit/audit.module";
import { AuthController } from "./auth.controller";
import { AuthNonceService } from "./auth_nonce.service";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import {
  PrismaSignupFaucetStore,
  SIGNUP_FAUCET_SENDER,
  SIGNUP_FAUCET_STORE,
  SignupFaucetService,
  ViemSignupFaucetSender,
} from "./signup_faucet.service";

function parseChainId(value?: string | null) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCaip2ChainId(value?: string | null) {
  const match = /^eip155:(\d+)$/.exec(value?.trim() ?? "");
  return match ? parseChainId(match[1]) : undefined;
}

function firstConfiguredChainId(config: ConfigService, keys: string[]) {
  for (const key of keys) {
    const chainId = parseChainId(config.get<string>(key));
    if (chainId) return chainId;
  }
  return undefined;
}

function withRpcUrl(chain: Chain, rpcUrl?: string): Chain {
  return rpcUrl
    ? { ...chain, rpcUrls: { default: { http: [rpcUrl] } } }
    : chain;
}

function chainForId(chainId: number, rpcUrl?: string): Chain {
  if (chainId === foundry.id) return withRpcUrl(foundry, rpcUrl);
  if (chainId === sepolia.id) return withRpcUrl(sepolia, rpcUrl);
  if (chainId === baseSepolia.id) return withRpcUrl(baseSepolia, rpcUrl);
  if (chainId === base.id) return withRpcUrl(base, rpcUrl);
  return {
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
  };
}

function getChainFromConfig(config: ConfigService): { chain: Chain; transport: ReturnType<typeof http> } {
  const rpcUrl = config.get<string>("RPC_URL")?.trim();
  const configuredChainId =
    firstConfiguredChainId(config, [
      "AA_CHAIN_ID",
      "CHAIN_ID",
      "PAYMENT_CHAIN_ID",
      "NEXT_PUBLIC_CHAIN_ID",
      "INDEXER_CHAIN_ID",
    ]) ?? parseCaip2ChainId(config.get<string>("X402_NETWORK"));

  if (rpcUrl?.includes("localhost:8545") || rpcUrl?.includes("127.0.0.1:8545")) {
    return {
      chain: chainForId(configuredChainId ?? foundry.id, rpcUrl),
      transport: http(rpcUrl),
    };
  }

  const chain = chainForId(configuredChainId ?? sepolia.id, rpcUrl);
  return {
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  };
}

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_SECRET") || "dev-secret";
        if (!config.get<string>("JWT_SECRET") && process.env.NODE_ENV === 'production') {
          throw new Error('JWT_SECRET must be set in production');
        }
        return {
          secret,
          signOptions: { expiresIn: "7d" },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthNonceService,
    SignupFaucetService,
    { provide: SIGNUP_FAUCET_STORE, useClass: PrismaSignupFaucetStore },
    { provide: SIGNUP_FAUCET_SENDER, useClass: ViemSignupFaucetSender },
    JwtStrategy,
    {
      provide: "PUBLIC_CLIENT",
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { chain, transport } = getChainFromConfig(config);
        const rpcUrl = config.get<string>("RPC_URL");
        console.log(`[Auth] PUBLIC_CLIENT chain: ${chain.name} (${chain.id}), RPC: ${rpcUrl || "default"}`);
        return createPublicClient({
          chain,
          transport,
        });
      },
    },
  ],
  exports: [AuthService, "PUBLIC_CLIENT", PassportModule, JwtStrategy, SignupFaucetService],
})
export class AuthModule { }
