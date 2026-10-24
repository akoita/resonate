import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { auditAdminBranch } from "../admin_audit/admin_branch_audit";
import { EventBus } from "../shared/event_bus";
import { Erc4337Client } from "./erc4337/erc4337_client";
import { KernelAccountService } from "./kernel_account.service";
import { PaymasterService } from "./paymaster.service";
import { normalizeUserId } from "./user_id";
import { WalletProviderRegistry } from "./wallet_provider_registry";

type WalletProviderName = "local" | "erc4337";
const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/**
 * Largest single top-up or monthly cap a wallet call may set (USD) (#2361).
 * Conservative on purpose: `fund` credits a spendable balance, so an absurd
 * value is almost certainly a typo or an abuse attempt. Raise it deliberately
 * once real payment rails settle larger amounts.
 */
export const MAX_WALLET_AMOUNT_USD = 10_000;

function assertFiniteAmount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(`${field} must be a finite number`);
  }
  return value;
}

/** Fund: a strictly positive, finite amount up to the per-call maximum. */
export function assertValidFundAmount(value: unknown): void {
  const amount = assertFiniteAmount(value, "amountUsd");
  if (amount <= 0) {
    throw new BadRequestException("amountUsd must be greater than 0");
  }
  if (amount > MAX_WALLET_AMOUNT_USD) {
    throw new BadRequestException(
      `amountUsd must be at most ${MAX_WALLET_AMOUNT_USD}`,
    );
  }
}

/**
 * Budget: `0` is allowed. A cap of 0 is the wallet's default and means nothing
 * may be spent (spend() denies once spent + amount exceeds the cap); it is how
 * a user pauses spending. It is not "no cap". Negative values are rejected.
 */
export function assertValidMonthlyCap(value: unknown): void {
  const cap = assertFiniteAmount(value, "monthlyCapUsd");
  if (cap < 0) {
    throw new BadRequestException("monthlyCapUsd must not be negative");
  }
  if (cap > MAX_WALLET_AMOUNT_USD) {
    throw new BadRequestException(
      `monthlyCapUsd must be at most ${MAX_WALLET_AMOUNT_USD}`,
    );
  }
}

export type WalletCaller = { userId: string; role?: string };

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly providerRegistry: WalletProviderRegistry,
    private readonly erc4337Client: Erc4337Client,
    private readonly paymasterService: PaymasterService,
    private readonly kernelAccountService: KernelAccountService,
  ) { }

  async fundWallet(rawInput: { userId: string; amountUsd: number }) {
    // Value rules run before any read or write so a rejected call changes nothing.
    assertValidFundAmount(rawInput.amountUsd);
    const input = { ...rawInput, userId: normalizeUserId(rawInput.userId) };
    const wallet = await this.getOrCreate(input.userId);
    const updated = await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceUsd: wallet.balanceUsd + input.amountUsd },
    });
    this.eventBus.publish({
      eventName: "wallet.funded",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId: input.userId,
      amountUsd: input.amountUsd,
      balanceUsd: updated.balanceUsd,
    });
    return updated;
  }

  async setBudget(rawInput: {
    userId: string;
    monthlyCapUsd: number;
    resetSpent?: boolean;
  }) {
    assertValidMonthlyCap(rawInput.monthlyCapUsd);
    const input = { ...rawInput, userId: normalizeUserId(rawInput.userId) };
    const wallet = await this.getOrCreate(input.userId);
    const updated = await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        monthlyCapUsd: input.monthlyCapUsd,
        ...(input.resetSpent ? { spentUsd: 0 } : {}),
      },
    });
    this.eventBus.publish({
      eventName: "wallet.budget_set",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId: input.userId,
      monthlyCapUsd: updated.monthlyCapUsd,
    });
    return updated;
  }

  async getWallet(userId: string) {
    return this.getOrCreate(normalizeUserId(userId));
  }

  /**
   * Wallet read for an HTTP caller. A caller reads its own wallet, addressed by
   * its user id or by the wallet / owner address on its own wallet record; an
   * admin may read any existing wallet. Only the caller's own record is ever
   * created here: a read of any other id never creates a user or a wallet.
   */
  async getWalletForCaller(caller: WalletCaller, requestedId: string) {
    const callerId = normalizeUserId(caller.userId);
    const requested = normalizeUserId(requestedId);

    if (requested === callerId) {
      return this.getOrCreate(callerId);
    }

    if (caller.role === "admin") {
      const found = await prisma.wallet.findFirst({ where: { userId: requested } });
      if (!found) {
        throw new NotFoundException("Wallet not found");
      }
      // #2380: an admin reading someone else's wallet is recorded; the owner's own read is not.
      await auditAdminBranch(caller, "wallet.support_viewed", { targetUserId: found.userId });
      return found;
    }

    const own = await prisma.wallet.findFirst({ where: { userId: callerId } });
    if (own && this.walletAddressesOf(own).includes(requested)) {
      return own;
    }
    throw new ForbiddenException("You can only read your own wallet");
  }

  private walletAddressesOf(wallet: { address: string; ownerAddress: string | null }) {
    return [wallet.address, wallet.ownerAddress]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => normalizeUserId(value));
  }

  async refreshWallet(rawInput: { userId: string; provider?: WalletProviderName }) {
    const input = { ...rawInput, userId: normalizeUserId(rawInput.userId) };
    const wallet = await this.getOrCreate(input.userId, input.provider);
    const existingProvider = (wallet as any).provider as WalletProviderName | undefined;
    if (wallet.addressVerifiedAt) {
      // #2023: sign-in (/auth/verify) wrote this address, so it is the account
      // the user actually transacts from. A provider-derived address (for
      // erc4337 a hash of userId, factory, entry point and salt) must never
      // replace it; purchase flows trust Wallet.address as the buyer.
      if (input.provider && input.provider !== existingProvider) {
        throw new ConflictException({
          code: "wallet_address_verified",
          message:
            "This wallet's address was verified at sign-in and cannot be replaced by a provider-derived address.",
        });
      }
      this.logger.debug(
        `refreshWallet kept the sign-in verified address for wallet ${wallet.id}`,
      );
      return wallet;
    }
    const provider = this.providerRegistry.getProvider(input.provider ?? existingProvider);
    const derivedAccount = provider.getAccount(input.userId);
    // Same rule as getOrCreate: a wallet/passkey account's userId IS its
    // smart-account address, so never trade it for the derived pseudo-address.
    const account =
      derivedAccount.provider === "erc4337" && ETH_ADDRESS_PATTERN.test(input.userId)
        ? { ...derivedAccount, address: input.userId.toLowerCase(), ownerAddress: null }
        : derivedAccount;
    return prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        address: account.address,
        chainId: account.chainId,
        accountType: account.accountType,
        provider: account.provider,
        ownerAddress: account.ownerAddress,
        entryPoint: account.entryPoint,
        factory: account.factory,
        paymaster: account.paymaster,
        bundler: account.bundler,
        salt: account.salt,
      } as any,
    });
  }

  async setProvider(input: { userId: string; provider: WalletProviderName }) {
    return this.refreshWallet(input);
  }

  configurePaymaster(input: { sponsorMaxUsd: number; paymasterAddress: string }) {
    this.paymasterService.configure(input);
  }

  getPaymasterStatus(userId?: string) {
    return this.paymasterService.getStatus(userId);
  }

  resetPaymaster(userId: string) {
    this.paymasterService.resetUser(userId);
  }


  async spend(rawUserId: string, amountUsd: number) {
    const userId = normalizeUserId(rawUserId);
    const wallet = await this.getOrCreate(userId);
    if (wallet.balanceUsd < amountUsd) {
      return { allowed: false, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
    }
    if (wallet.spentUsd + amountUsd > wallet.monthlyCapUsd) {
      return { allowed: false, remaining: wallet.monthlyCapUsd - wallet.spentUsd };
    }
    const updated = await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        spentUsd: wallet.spentUsd + amountUsd,
        balanceUsd: wallet.balanceUsd - amountUsd,
      },
    });
    this.eventBus.publish({
      eventName: "wallet.spent",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      amountUsd,
      spentUsd: updated.spentUsd,
      balanceUsd: updated.balanceUsd,
    });

    // Emit budget alerts at thresholds
    if (updated.monthlyCapUsd > 0) {
      const pct = (updated.spentUsd / updated.monthlyCapUsd) * 100;
      if (pct >= 80) {
        const level = pct >= 100 ? "exhausted" : pct >= 95 ? "critical" : "warning";
        this.eventBus.publish({
          eventName: "agent.budget_alert",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          userId,
          level,
          percentUsed: Math.round(pct),
          spentUsd: updated.spentUsd,
          monthlyCapUsd: updated.monthlyCapUsd,
          remainingUsd: Math.max(0, updated.monthlyCapUsd - updated.spentUsd),
        });
      }
    }

    return { allowed: true, remaining: updated.monthlyCapUsd - updated.spentUsd };
  }

  // A wallet created here is never address-verified: for a non-address userId
  // the derived address is a placeholder until sign-in writes the real one
  // (AuthService.upsertWalletIdentity sets addressVerifiedAt, #2023).
  private async getOrCreate(rawUserId: string, provider?: WalletProviderName) {
    // #2180: wallet-account user ids are lowercase addresses; never create a
    // second user for the same address under another casing.
    const userId = normalizeUserId(rawUserId);
    const existing = await prisma.wallet.findFirst({ where: { userId } });
    if (existing) {
      return existing;
    }
    const selected =
      provider ??
      ((process.env.WALLET_PROVIDER ?? "erc4337") as WalletProviderName);
    const derivedAccount = this.providerRegistry.getProvider(selected).getAccount(userId);
    const account =
      selected === "erc4337" && ETH_ADDRESS_PATTERN.test(userId)
        ? {
            ...derivedAccount,
            address: userId.toLowerCase(),
            ownerAddress: null,
          }
        : derivedAccount;

    // Ensure User exists before creating Wallet to avoid FK violation
    // Since this is wallet-auth, we might not have an email, so we generate a placeholder.
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@wallet.placeholder`,
      },
      update: {},
    });

    const wallet = await prisma.wallet.create({
      data: {
        userId,
        address: account.address,
        chainId: account.chainId,
        balanceUsd: 0,
        monthlyCapUsd: 0,
        spentUsd: 0,
        accountType: account.accountType,
        provider: account.provider,
        ownerAddress: account.ownerAddress,
        entryPoint: account.entryPoint,
        factory: account.factory,
        paymaster: account.paymaster,
        bundler: account.bundler,
        salt: account.salt,
      } as any,
    });


    return wallet;
  }
}
