import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CommunityModule } from "../community/community.module";
import { NotificationModule } from "../notifications/notification.module";
import { ShowsController } from "./shows.controller";
import { ShowRefundReminderService } from "./show-refund-reminder.service";
import { ShowsService } from "./shows.service";
import { ShowsEscrowIndexerService } from "./shows-escrow-indexer.service";

@Module({
  imports: [AnalyticsModule, CommunityModule, NotificationModule],
  controllers: [ShowsController],
  providers: [ShowsService, ShowsEscrowIndexerService, ShowRefundReminderService],
  exports: [ShowsService, ShowsEscrowIndexerService, ShowRefundReminderService],
})
export class ShowsModule {}
