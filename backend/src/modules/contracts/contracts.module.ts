import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { ContractsService } from "./contracts.service";
import { IndexerService } from "./indexer.service";
import { MetadataController } from "./metadata.controller";
import { NotificationModule } from "../notifications/notification.module";

@Module({
  imports: [SharedModule, NotificationModule],
  controllers: [MetadataController],
  providers: [ContractsService, IndexerService],
  exports: [ContractsService, IndexerService],
})
export class ContractsModule {}
