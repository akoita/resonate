import { Module } from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { SharedModule } from "../shared/shared.module";

@Module({
  imports: [SharedModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
