import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FundLocalDevWalletDto } from "./payments.dto";
import { PaymentSurface, PaymentsService } from "./payments.service";

/**
 * Payment asset discovery, quotes, funding options, and local-dev funding.
 *
 * The prototype `initiate` / `split-config` / `split` / `confirm` routes were
 * removed (#1890): they had no client, and any authenticated caller could
 * publish a `payment.settled` domain event with an arbitrary amount into payout
 * analytics.
 */
@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

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
  fundLocalDevWallet(@Body() body: FundLocalDevWalletDto) {
    return this.paymentsService.fundLocalDevWallet(body);
  }
}
