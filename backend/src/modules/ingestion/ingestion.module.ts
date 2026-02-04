import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { IngestionController } from "./ingestion.controller";
import { IngestionService } from "./ingestion.service";
import { BullModule } from "@nestjs/bullmq";
import { StemsProcessor } from "./stems.processor";
import { ArtistModule } from "../artist/artist.module";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "stems",
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    ArtistModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, StemsProcessor],
  exports: [IngestionService],
})
export class IngestionModule { }
