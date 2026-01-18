import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("initiate")
  initiate(@Body() body: { sessionId: string; amountUsd: number }) {
    return this.paymentsService.initiatePayment(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("split")
  split(@Body() body: { paymentId: string; artistPct: number; mixerPct: number }) {
    return this.paymentsService.splitPayment(body);
  }
}
