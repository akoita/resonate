import { IsIn, IsOptional } from "class-validator";
import { REPORT_FORMATS, REPORT_SECTIONS, type ReportFormat, type ReportSection } from "./billing_reconciliation";

/** Query of `GET /admin/billing/reconciliation/:month` (#2497). `csv` needs a `section`. */
export class BillingReconciliationQueryDto {
  @IsOptional()
  @IsIn(REPORT_FORMATS)
  format?: ReportFormat;

  @IsOptional()
  @IsIn(REPORT_SECTIONS)
  section?: ReportSection;
}
