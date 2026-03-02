import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { WalletService } from "../identity/wallet.service";
import { KernelAccountService } from "../identity/kernel_account.service";
import { AgentWalletService } from "./agent_wallet.service";
import { encodeFunctionData, type Address, type Hex } from "viem";

// StemMarketplaceV2.buy(uint256 listingId, uint256 amount) ABI fragment
const BUY_ABI = [
  {
    name: "buy",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export interface AgentPurchaseInput {
  sessionId: string;
  userId: string;
  listingId: bigint;
  tokenId: bigint;
  amount: bigint;
  totalPriceWei: string;
  priceUsd: number;
}

@Injectable()
export class AgentPurchaseService {
  private readonly logger = new Logger(AgentPurchaseService.name);
  private readonly marketplaceAddress: string;

  constructor(
    private readonly walletService: WalletService,
    private readonly agentWalletService: AgentWalletService,
    private readonly kernelAccountService: KernelAccountService,
    private readonly eventBus: EventBus
  ) {
    this.marketplaceAddress =
      process.env.MARKETPLACE_ADDRESS ??
      "0x0000000000000000000000000000000000000000";
  }

  async purchase(input: AgentPurchaseInput) {
    // 1. Validate session key
    const keyValid = await this.agentWalletService.validateSessionKey(input.userId);
    if (!keyValid) {
      return {
        success: false,
        reason: "session_key_invalid",
        message:
          "Agent session key is invalid or expired. Re-enable the agent wallet.",
      };
    }

    // 2. Check budget
    const spendResult = await this.walletService.spend(
      input.userId,
      input.priceUsd
    );
    if (!spendResult.allowed) {
      return {
        success: false,
        reason: "budget_exceeded",
        remaining: spendResult.remaining,
      };
    }

    // 3. Create pending transaction record
    const agentTx = await prisma.agentTransaction.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId,
        listingId: input.listingId,
        tokenId: input.tokenId,
        amount: input.amount,
        totalPriceWei: input.totalPriceWei,
        priceUsd: input.priceUsd,
        status: "pending",
      },
    });

    // 4. Encode calldata
    const callData = this.encodeBuyCalldata(input.listingId, input.amount);

    // 5. Submit UserOp via session key
    try {
      this.logger.log(
        `Sending session key tx for listing ${input.listingId} (user: ${input.userId})`,
      );

      await prisma.agentTransaction.update({
        where: { id: agentTx.id },
        data: { status: "submitted" },
      });

      // Get the agent's key data (private key as SensitiveBuffer + approval)
      const agentKeyData = await this.agentWalletService.getAgentKeyData(input.userId);

      if (!agentKeyData) {
        throw new Error("No agent key data found — session key may have been revoked");
      }

      // Send via session-key-scoped Kernel client through the bundler
      // The private key is read once via toString() and zeroed in the finally block
      let txHash: string;
      try {
        txHash = await this.kernelAccountService.sendSessionKeyTransaction(
          agentKeyData.agentPrivateKey.toString(),  // one-time read from SensitiveBuffer
          agentKeyData.approvalData,
          this.marketplaceAddress as Address,
          callData as Hex,
          BigInt(input.totalPriceWei),
        );
      } finally {
        // Zero the private key from memory immediately after signing
        agentKeyData.agentPrivateKey.zero();
      }

      await prisma.agentTransaction.update({
        where: { id: agentTx.id },
        data: {
          txHash,
          status: "confirmed",
          confirmedAt: new Date(),
        },
      });

      this.logger.log(`Transaction confirmed: ${txHash}`);
      this.publishPurchaseEvent(input, txHash, "onchain");

      // Check budget alerts
      const updatedWallet = await this.walletService.getWallet(input.userId);
      if (updatedWallet) {
        this.agentWalletService.checkAndEmitBudgetAlert(
          input.userId,
          updatedWallet.spentUsd,
          updatedWallet.monthlyCapUsd
        );
      }

      return {
        success: true,
        transactionId: agentTx.id,
        txHash,
        mode: "onchain",
        remaining: spendResult.remaining,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.agentTransaction.update({
        where: { id: agentTx.id },
        data: {
          status: "failed",
          errorMessage: message,
        },
      });

      this.eventBus.publish({
        eventName: "agent.purchase_failed",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        userId: input.userId,
        listingId: String(input.listingId),
        error: message,
      });

      return {
        success: false,
        reason: "transaction_failed",
        message,
        transactionId: agentTx.id,
      };
    }
  }


  encodeBuyCalldata(listingId: bigint, amount: bigint): string {
    return encodeFunctionData({
      abi: BUY_ABI,
      functionName: "buy",
      args: [listingId, amount],
    });
  }

  async getTransactions(userId: string, limit = 20) {
    const rows = await prisma.agentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 50),
    });

    // Resolve stem/track metadata for each transaction
    const tokenIds = [...new Set(rows.map((r) => r.tokenId))];
    const mints = await prisma.stemNftMint.findMany({
      where: { tokenId: { in: tokenIds } },
      include: {
        stem: {
          include: {
            track: { select: { title: true, artist: true } },
          },
        },
      },
    });
    const mintMap = new Map(mints.map((m) => [m.tokenId.toString(), m]));

    return rows.map((r) => {
      const mint = mintMap.get(r.tokenId.toString());
      return {
        ...r,
        listingId: String(r.listingId),
        tokenId: String(r.tokenId),
        amount: String(r.amount),
        stemName: mint?.stem?.type ?? null,
        trackTitle: mint?.stem?.track?.title ?? null,
        trackArtist: mint?.stem?.track?.artist ?? null,
      };
    });
  }

  private publishPurchaseEvent(
    input: AgentPurchaseInput,
    txHash: string,
    mode: string
  ) {
    this.eventBus.publish({
      eventName: "agent.purchase_completed",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      userId: input.userId,
      listingId: String(input.listingId),
      tokenId: String(input.tokenId),
      amount: String(input.amount),
      priceUsd: input.priceUsd,
      txHash,
      mode,
    });
  }
}
