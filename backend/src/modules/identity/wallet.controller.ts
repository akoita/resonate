import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { WalletService } from "./wallet.service";

@Controller("wallet")
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post("fund")
  @UseGuards(AuthGuard("jwt"))
  fund(@Body() body: { userId: string; amountUsd: number }) {
    return this.walletService.fundWallet(body);
  }

  @Post("budget")
  @UseGuards(AuthGuard("jwt"))
  setBudget(
    @Body() body: { userId: string; monthlyCapUsd: number; resetSpent?: boolean },
  ) {
    return this.walletService.setBudget(body);
  }

  @Post("provider")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  setProvider(@Body() body: { userId: string; provider: "local" | "erc4337" }) {
    return this.walletService.setProvider(body);
  }

  @Post("refresh")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  refresh(@Body() body: { userId: string; provider?: "local" | "erc4337" }) {
    return this.walletService.refreshWallet(body);
  }

  @Post("deploy")
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  deploy(@Body() body: { userId: string }) {
    return this.walletService.deploySmartAccount(body);
  }

  @Get(":userId")
  @UseGuards(AuthGuard("jwt"))
  get(@Param("userId") userId: string) {
    return this.walletService.getWallet(userId);
  }
}
