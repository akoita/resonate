import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PaymentSurface, PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("initiate")
  initiate(@Body() body: {
    sessionId: string;
    amountUsd: number;
    trackId?: string;
    chainId?: number;
    assetId?: string;
  }) {
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

  @Get("quote")
  quote(
    @Query("amountUsd") amountUsd: string,
    @Query("chainId") chainId?: string,
    @Query("assetId") assetId?: string,
    @Query("surface") surface?: string,
    @Query("feeBps") feeBps?: string,
    @Query("royaltyBps") royaltyBps?: string,
  ) {
    return this.paymentsService.quotePayment({
      amountUsd,
      chainId: chainId ? Number(chainId) : undefined,
      assetId,
      surface: surface as PaymentSurface | undefined,
      feeBps,
      royaltyBps,
    });
  }

  @Get("policy")
  policy(
    @Query("chainId") chainId?: string,
    @Query("surface") surface?: string,
  ) {
    return this.paymentsService.getPaymentPolicy({
      chainId: chainId ? Number(chainId) : undefined,
      surface: surface as PaymentSurface | undefined,
    });
  }

  @Get("funding-options")
  fundingOptions(
    @Query("chainId") chainId?: string,
    @Query("wallet") wallet?: string,
    @Query("assetId") assetId?: string,
    @Query("surface") surface?: string,
  ) {
    return this.paymentsService.getFundingOptions({
      chainId: chainId ? Number(chainId) : undefined,
      wallet,
      assetId,
      surface: surface as PaymentSurface | undefined,
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
