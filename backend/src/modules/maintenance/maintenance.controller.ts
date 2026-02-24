import { Controller, Delete, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { MaintenanceService } from "./maintenance.service";

@Controller("admin")
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("retention/cleanup")
  cleanup() {
    return this.maintenanceService.runRetentionCleanup();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Delete("wipe-releases")
  wipeReleases() {
    return this.maintenanceService.wipeReleases();
  }
}
