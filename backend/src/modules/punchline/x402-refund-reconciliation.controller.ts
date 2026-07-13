import { Body, Controller, Get, Param, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { X402RefundReconciliationService } from "./x402-refund-reconciliation.service";

type MarkRefundedBody = { refundTxHash?: string };

/**
 * Operator surface for reconciling `refund_due` x402 settlements (#1506).
 *
 * A paid Punchline moment collect whose payment verified but whose edition
 * could not be allocated (sold out / already owned) lands `refund_due`. These
 * routes let an operator see the outstanding debt and, after sending the manual
 * out-of-band refund, record the refund tx hash. Operator/admin only — this is
 * money-movement authority evidence, mirroring the guarded lifecycle routes on
 * the shows and credits controllers.
 */
@Controller("admin/x402-refunds")
@UseGuards(AuthGuard("jwt"), RolesGuard)
@Roles("admin", "operator")
export class X402RefundReconciliationController {
  constructor(private readonly reconciliation: X402RefundReconciliationService) {}

  @Get()
  listRefundDue() {
    return this.reconciliation.listRefundDue();
  }

  @Post(":id/mark-refunded")
  markRefunded(
    @Param("id") id: string,
    @Body() body: MarkRefundedBody,
    @Request() req: any,
  ) {
    return this.reconciliation.markRefunded(
      id,
      body?.refundTxHash ?? "",
      req.user?.userId,
    );
  }
}
