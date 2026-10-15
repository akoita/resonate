import { Module } from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { NoticeService } from "./notice.service";
import { NoticeController } from "./notice.controller";
import { SharedModule } from "../shared/shared.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [SharedModule, AuditModule],
  controllers: [NoticeController],
  providers: [NotificationService, NoticeService],
  exports: [NotificationService, NoticeService],
})
export class NotificationModule {}
