import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { LinkPurchaseConsentDto, RecordPurchaseConsentDto } from "./purchase_consent.dto";
import { PurchaseConsentService } from "./purchase_consent.service";

/**
 * Immediate-delivery consent at checkout (#1776). The wording is public so the
 * checkout can render it; everything else is the signed-in buyer's own record.
 */
@Controller("purchase-consents")
export class PurchaseConsentController {
  constructor(private readonly consents: PurchaseConsentService) {}

  @Get("wording")
  wording() {
    return this.consents.wording();
  }

  @UseGuards(AuthGuard("jwt"))
  @Get()
  list(@Req() req: any) {
    return this.consents.listForUser(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post()
  record(@Req() req: any, @Body() body: RecordPurchaseConsentDto) {
    return this.consents.record(req.user.userId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @HttpCode(200)
  @Post(":id/link")
  link(@Req() req: any, @Param("id") id: string, @Body() body: LinkPurchaseConsentDto) {
    return this.consents.link(req.user.userId, id, body);
  }
}
