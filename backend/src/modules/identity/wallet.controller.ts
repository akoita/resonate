import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { WalletService } from "./wallet.service";

@Controller("wallet")
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post("fund")
  fund(@Body() body: { userId: string; amountUsd: number }) {
    return this.walletService.fundWallet(body);
  }

  @Post("budget")
  setBudget(@Body() body: { userId: string; monthlyCapUsd: number }) {
    return this.walletService.setBudget(body);
  }

  @Get(":userId")
  get(@Param("userId") userId: string) {
    return this.walletService.getWallet(userId);
  }
}
