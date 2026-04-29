import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("initiate")
  initiate(@Body() body: { sessionId: string; amountUsd: number; trackId?: string }) {
    return this.paymentsService.initiatePayment(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("split-config")
  splitConfig(@Body() body: { trackId: string; artistPct: number; mixerPct: number }) {
    return this.paymentsService.setSplitConfig(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("split")
  split(@Body() body: { paymentId: string; artistPct: number; mixerPct: number }) {
    return this.paymentsService.splitPayment(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("confirm")
  confirm(@Body() body: { paymentId: string }) {
    return this.paymentsService.confirmOnChain(body.paymentId);
  }

  @Get("assets")
  assets(@Query("chainId") chainId?: string) {
    return this.paymentsService.getPaymentAssets(
      chainId ? Number(chainId) : undefined,
    );
  }

  @Get("funding-options")
  fundingOptions(
    @Query("chainId") chainId?: string,
    @Query("wallet") wallet?: string,
  ) {
    return this.paymentsService.getFundingOptions({
      chainId: chainId ? Number(chainId) : undefined,
      wallet,
    });
  }

  @Get("dev/status")
  localDevStatus() {
    return this.paymentsService.getLocalDevStatus();
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("dev/fund")
  fundLocalDevWallet(
    @Body() body: { wallet: string; assetId: string; amount?: string },
  ) {
    return this.paymentsService.fundLocalDevWallet(body);
  }
}
