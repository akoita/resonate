import { Body, Controller, Delete, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { AnalyticsWarehouseLoadRequest } from "../analytics/analytics_warehouse_loader";
import { MaintenanceService } from "./maintenance.service";

@Controller("admin")
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("retention/cleanup")
  async cleanup() {
    return this.maintenanceService.runRetentionCleanup();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("analytics/warehouse/load")
  async loadAnalyticsWarehouse(@Body() body: AnalyticsWarehouseLoadRequest) {
    return this.maintenanceService.loadAnalyticsWarehouse(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("analytics/warehouse/backfill")
  async backfillAnalyticsWarehouse(@Body() body: AnalyticsWarehouseLoadRequest) {
    return this.maintenanceService.backfillAnalyticsWarehouse(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Delete("wipe-releases")
  wipeReleases() {
    return this.maintenanceService.wipeReleases();
  }
}
