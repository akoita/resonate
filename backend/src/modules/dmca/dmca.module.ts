import { Module } from "@nestjs/common";
import { DmcaController } from "./dmca.controller";
import { DmcaService } from "./dmca.service";
import { RightsModule } from "../rights/rights.module";
import { NotificationModule } from "../notifications/notification.module";

@Module({
  imports: [RightsModule, NotificationModule],
  controllers: [DmcaController],
  providers: [DmcaService],
  exports: [DmcaService],
})
export class DmcaModule {}
