import { BadRequestException, Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import type { Response } from "express";
import { AdminAudit, auditCode, auditRef } from "../admin_audit/admin_audit.interceptor";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { REPORT_FORMATS, REPORT_SECTIONS, sectionToCsv } from "./billing_reconciliation";
import { BillingReconciliationQueryDto } from "./billing_reconciliation.dto";
import { BillingReconciliationService } from "./billing_reconciliation.service";

/**
 * Monthly billing reconciliation report (#2497): Stripe payments, the
 * generation-credit ledger and deferred subscription revenue for one UTC month.
 * Read-only and operator/admin only. `?format=csv&section=<section>` returns
 * one section as CSV; otherwise the whole report as JSON (a `section` without
 * `format=csv` is ignored). Never cached. The report holds ids, codes, amounts
 * and dates only; opening it is recorded in the admin audit log.
 */
@Controller("admin/billing/reconciliation")
@UseGuards(AuthGuard("jwt"), RolesGuard)
@Roles("admin", "operator")
export class BillingReconciliationController {
  constructor(private readonly reconciliation: BillingReconciliationService) {}

  @Get(":month")
  @AdminAudit("billing.reconciliation_viewed", (c) => ({
    detail: {
      month: auditRef(c.params.month),
      format: auditCode(c.query.format, REPORT_FORMATS),
      section: auditCode(c.query.section, REPORT_SECTIONS),
    },
  }))
  async report(
    @Param("month") month: string,
    @Query() query: BillingReconciliationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (query.format === "csv" && !query.section) {
      throw new BadRequestException({ code: "section_required", message: "format=csv needs a section" });
    }
    const report = await this.reconciliation.build(month);
    res.setHeader("Cache-Control", "no-store");
    if (query.format === "csv" && query.section) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="billing-reconciliation-${report.month}-${query.section}.csv"`,
      );
      return sectionToCsv(report, query.section);
    }
    return report;
  }
}
