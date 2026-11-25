import { Module } from "@nestjs/common";
import { DmcaController } from "./dmca.controller";
import { DmcaService } from "./dmca.service";
import { RightsModule } from "../rights/rights.module";
import { NotificationModule } from "../notifications/notification.module";
import { EmailModule } from "../email/email.module";

@Module({
  // EmailModule (#2664): the reporter's receipt email.
  imports: [RightsModule, NotificationModule, EmailModule],
  controllers: [DmcaController],
  providers: [DmcaService],
  exports: [DmcaService],
})
export class DmcaModule {}
