import { Body, Controller, Post, UseGuards } from "@nestjs/common";
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

  @Post("confirm")
  confirm(@Body() body: { paymentId: string }) {
    return this.paymentsService.confirmOnChain(body.paymentId);
  }
}
