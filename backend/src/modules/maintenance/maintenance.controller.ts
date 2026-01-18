import { Controller, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { MaintenanceService } from "./maintenance.service";

@Controller("admin")
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Post("retention/cleanup")
  cleanup() {
    return this.maintenanceService.runRetentionCleanup();
  }
}
