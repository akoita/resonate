import { Controller, Post, Patch, Get, Param, Body, Query, Logger } from "@nestjs/common";
import { DmcaService } from "./dmca.service";

@Controller("api/dmca")
export class DmcaController {
  private readonly logger = new Logger(DmcaController.name);

  constructor(private readonly dmcaService: DmcaService) {}

  /**
   * File a DMCA takedown report.
   * POST /api/dmca/report
   */
  @Post("report")
  async fileReport(
    @Body()
    body: {
      trackId: string;
      claimantName: string;
      claimantEmail: string;
      originalWorkUrl: string;
      reason: string;
    },
  ) {
    return this.dmcaService.fileReport(body);
  }

  /**
   * File a counter-notification.
   * POST /api/dmca/counter
   */
  @Post("counter")
  async fileCounter(
    @Body() body: { reportId: string; counterNotice: string },
  ) {
    return this.dmcaService.fileCounter(body.reportId, body.counterNotice);
  }

  /**
   * Resolve a DMCA report (admin).
   * PATCH /api/dmca/:id/resolve
   */
  @Patch(":id/resolve")
  async resolveReport(
    @Param("id") id: string,
    @Body() body: { outcome: "upheld" | "rejected" },
  ) {
    return this.dmcaService.resolveReport(id, body.outcome);
  }

  /**
   * List DMCA reports (admin).
   * GET /api/dmca
   */
  @Get()
  async listReports(@Query("status") status?: string) {
    return this.dmcaService.listReports(status);
  }
}
