import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
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
  }) {
    const userId = input.userId.toLowerCase();
    const walletAddress = input.walletAddress.toLowerCase();
    const chainId = input.chainId ?? Number(process.env.AA_CHAIN_ID ?? 11155111);
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

  private resolveRole(userId: string, role: string) {
    // Always check admin allow list — auto-promote if address matches
    const allowList = (process.env.ADMIN_ADDRESSES ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (allowList.includes(userId.toLowerCase())) {
      return "admin";
    }
    return role;
  }
}
