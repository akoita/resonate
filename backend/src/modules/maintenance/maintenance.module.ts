import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CommunityModule } from "../community/community.module";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceService } from "./maintenance.service";

@Module({
  imports: [AnalyticsModule, CommunityModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
