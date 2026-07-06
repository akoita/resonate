import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";
import { prisma } from "../../db/prisma";
import { AuditService } from "../audit/audit.service";
import { parseEnvList } from "../../config/env";

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

  /**
   * Privileged roles a caller may only receive if their wallet is present in
   * the mapped deployment-managed address allowlist. Any request for one of
   * these roles from an unlisted wallet fails closed to {@link SAFE_ROLE}.
   */
  private static readonly ALLOWLISTED_ROLES: Record<string, string> = {
    admin: "ADMIN_ADDRESSES",
    agent: "AGENT_ADDRESSES",
    operator: "OPERATOR_ADDRESSES",
  };

  /** Role granted when a requested role is not authorized. */
  private static readonly SAFE_ROLE = "listener";

  /**
   * Roles a caller is trusted to request for themselves without an allowlist.
   * Everything else — including privileged roles like `artist` and `curator`
   * that lack an allowlist source — fails closed to {@link SAFE_ROLE} so a
   * self-declared `role` in an auth request can never be an escalation.
   */
  private static readonly SELF_ASSIGNABLE_ROLES = new Set([AuthService.SAFE_ROLE]);

  private addressAllowList(envName: string) {
    return parseEnvList(process.env[envName], { lowercase: true });
  }

  private resolveRole(userId: string, role: string) {
    const normalizedUserId = userId.toLowerCase();

    // Admin allow list auto-promotes matching wallets regardless of the
    // requested role, and always wins.
    if (this.addressAllowList("ADMIN_ADDRESSES").includes(normalizedUserId)) {
      return "admin";
    }

    // Allowlist-gated roles: grant only when the wallet is listed, else fail closed.
    const allowlistEnv = AuthService.ALLOWLISTED_ROLES[role];
    if (allowlistEnv) {
      return this.addressAllowList(allowlistEnv).includes(normalizedUserId)
        ? role
        : AuthService.SAFE_ROLE;
    }

    // Any other requested role must be explicitly self-assignable; otherwise
    // fail closed so callers cannot mint themselves artist/curator/operator/etc.
    return AuthService.SELF_ASSIGNABLE_ROLES.has(role) ? role : AuthService.SAFE_ROLE;
  }
}
