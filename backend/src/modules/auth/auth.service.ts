import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import { prisma } from "../../db/prisma";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService
  ) { }

  issueToken(userId: string, role = "listener") {
    const allowedRole = this.resolveRole(userId, role);
    console.log(`[Auth] Issuing token for ${userId} with role ${allowedRole}`);
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

  async upsertWalletIdentity(input: {
    userId: string;
    walletAddress: string;
    chainId?: number;
    ownerAddress?: string | null;
    pubKeyX?: string | null;
    pubKeyY?: string | null;
  }) {
    const walletUserId = input.userId.toLowerCase();
    const walletAddress = input.walletAddress.toLowerCase();
    const chainId = input.chainId ?? Number(process.env.AA_CHAIN_ID ?? 11155111);
    const publicKeyHash = this.getPasskeyPublicKeyHash(input.pubKeyX, input.pubKeyY);
    const existingPasskeyIdentity = publicKeyHash
      ? await prisma.passkeyIdentity.findUnique({ where: { publicKeyHash } })
      : null;
    const userId = existingPasskeyIdentity?.userId.toLowerCase() ?? walletUserId;
    const ownerAddress =
      input.ownerAddress === null
        ? null
        : (input.ownerAddress?.toLowerCase() ?? (userId === walletAddress ? null : userId));

    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: `${userId}@wallet.resonate`,
      },
    });

    if (publicKeyHash) {
      await prisma.passkeyIdentity.upsert({
        where: { publicKeyHash },
        update: {
          lastWalletAddress: walletAddress,
        },
        create: {
          publicKeyHash,
          userId,
          firstWalletAddress: walletAddress,
          lastWalletAddress: walletAddress,
        },
      });
    }

    return prisma.wallet.upsert({
      where: { userId },
      update: {
        address: walletAddress,
        chainId,
        accountType: "erc4337",
        provider: "erc4337",
        ownerAddress,
        entryPoint: process.env.AA_ENTRY_POINT,
        factory: process.env.AA_FACTORY,
        paymaster: process.env.AA_PAYMASTER,
        bundler: process.env.AA_BUNDLER,
        salt: process.env.AA_SALT,
      },
      create: {
        userId,
        address: walletAddress,
        chainId,
        accountType: "erc4337",
        provider: "erc4337",
        ownerAddress,
        entryPoint: process.env.AA_ENTRY_POINT,
        factory: process.env.AA_FACTORY,
        paymaster: process.env.AA_PAYMASTER,
        bundler: process.env.AA_BUNDLER,
        salt: process.env.AA_SALT,
      },
    });
  }

  private getPasskeyPublicKeyHash(pubKeyX?: string | null, pubKeyY?: string | null) {
    const x = pubKeyX?.trim().toLowerCase();
    const y = pubKeyY?.trim().toLowerCase();
    const hexCoordinate = /^[0-9a-f]{64}$/;

    if (!x || !y || !hexCoordinate.test(x) || !hexCoordinate.test(y)) {
      return null;
    }

    return createHash("sha256").update(`${x}:${y}`).digest("hex");
  }

  private addressAllowList(envName: string) {
    return (process.env[envName] ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }

  private resolveRole(userId: string, role: string) {
    const normalizedUserId = userId.toLowerCase();

    // Always check admin allow list — auto-promote if address matches
    const adminAllowList = this.addressAllowList("ADMIN_ADDRESSES");
    if (adminAllowList.includes(normalizedUserId)) {
      return "admin";
    }

    if (role === "agent") {
      const agentAllowList = this.addressAllowList("AGENT_ADDRESSES");
      return agentAllowList.includes(normalizedUserId) ? "agent" : "listener";
    }

    return role;
  }
}
