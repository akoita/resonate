import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { ContractsService } from "./contracts.service";
import { IndexerService } from "./indexer.service";
import { MetadataController } from "./metadata.controller";
import { NotificationModule } from "../notifications/notification.module";
import { MintAuthorizationController } from "./mint-authorization.controller";
import { MintAuthorizationService } from "./mint-authorization.service";

@Module({
  imports: [SharedModule, NotificationModule],
  controllers: [MetadataController, MintAuthorizationController],
  providers: [ContractsService, IndexerService, MintAuthorizationService],
  exports: [ContractsService, IndexerService, MintAuthorizationService],
})
export class ContractsModule {}
