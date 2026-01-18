import { Body, Controller, Post } from "@nestjs/common";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("initiate")
  initiate(@Body() body: { sessionId: string; amountUsd: number }) {
    return this.paymentsService.initiatePayment(body);
  }

  @Post("split")
  split(@Body() body: { paymentId: string; artistPct: number; mixerPct: number }) {
    return this.paymentsService.splitPayment(body);
  }
}
