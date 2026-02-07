import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { ContractsService } from "./contracts.service";
import { IndexerService } from "./indexer.service";
import { MetadataController } from "./metadata.controller";

@Module({
  imports: [SharedModule],
  controllers: [MetadataController],
  providers: [ContractsService, IndexerService],
  exports: [ContractsService, IndexerService],
})
export class ContractsModule {}
