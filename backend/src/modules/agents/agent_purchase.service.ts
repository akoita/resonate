import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { Erc4337Client, UserOperation } from "../identity/erc4337/erc4337_client";
import { WalletService } from "../identity/wallet.service";
import { AgentWalletService } from "./agent_wallet.service";
import { encodeFunctionData } from "viem";

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
  private readonly marketplaceAddress: string;
  private readonly skipBundler: boolean;

  constructor(
    private readonly walletService: WalletService,
    private readonly agentWalletService: AgentWalletService,
    private readonly erc4337Client: Erc4337Client,
    private readonly eventBus: EventBus
  ) {
    this.marketplaceAddress =
      process.env.MARKETPLACE_ADDRESS ??
      "0x0000000000000000000000000000000000000000";
    this.skipBundler = process.env.AA_SKIP_BUNDLER === "true";
  }

  async purchase(input: AgentPurchaseInput) {
    // 1. Validate session key
    const keyValid = this.agentWalletService.validateSessionKey(input.userId);
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

    // 5. Submit UserOp or mock
    try {
      const wallet = await this.walletService.getWallet(input.userId);

      if (this.skipBundler) {
        // Dev mode: mock the transaction
        const mockTxHash = `0x${Buffer.from(
          `agent-buy-${input.listingId}-${Date.now()}`
        )
          .toString("hex")
          .slice(0, 64)}`;

        const confirmed = await prisma.agentTransaction.update({
          where: { id: agentTx.id },
          data: {
            txHash: mockTxHash,
            status: "confirmed",
            confirmedAt: new Date(),
          },
        });

        this.publishPurchaseEvent(input, mockTxHash, "mock");

        // Check budget alerts after purchase
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
          transactionId: confirmed.id,
          txHash: mockTxHash,
          mode: "mock",
          remaining: spendResult.remaining,
        };
      }

      // Real UserOp submission
      const userOp: UserOperation = {
        sender: wallet!.address,
        nonce: "0x0",
        factory: null,
        factoryData: "0x",
        callData,
        callGasLimit: "0x30000",
        verificationGasLimit: "0x100000",
        preVerificationGas: "0x5208",
        maxFeePerGas: "0x3b9aca00",
        maxPriorityFeePerGas: "0x3b9aca00",
        paymaster: (wallet as any)?.paymaster ?? null,
        paymasterVerificationGasLimit: "0x0",
        paymasterPostOpGasLimit: "0x0",
        paymasterData: "0x",
        signature: "0x",
      };

      const userOpHash = await this.erc4337Client.sendUserOperation(userOp);

      await prisma.agentTransaction.update({
        where: { id: agentTx.id },
        data: {
          userOpHash,
          status: "submitted",
        },
      });

      // Wait for receipt
      const receipt = await this.erc4337Client.waitForReceipt(userOpHash);
      const txHash =
        typeof receipt === "object" && receipt !== null
          ? (receipt as any).transactionHash ?? userOpHash
          : userOpHash;

      await prisma.agentTransaction.update({
        where: { id: agentTx.id },
        data: {
          txHash,
          status: "confirmed",
          confirmedAt: new Date(),
        },
      });

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
        userOpHash,
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
    // BigInt fields can't be JSON-serialized — convert to strings
    return rows.map((r) => ({
      ...r,
      listingId: String(r.listingId),
      tokenId: String(r.tokenId),
      amount: String(r.amount),
    }));
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
