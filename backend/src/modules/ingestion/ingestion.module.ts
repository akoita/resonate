import { Module } from "@nestjs/common";
import { IngestionController } from "./ingestion.controller";
import { IngestionService } from "./ingestion.service";
import { BullModule } from "@nestjs/bullmq";
import { StemsProcessor } from "./stems.processor";
import { StemPubSubPublisher } from "./stem-pubsub.publisher";
import { StemResultSubscriber } from "./stem-result.subscriber";
import { StemWatchdogService } from "./stem-watchdog.service";
import { ArtistModule } from "../artist/artist.module";
import { CatalogModule } from "../catalog/catalog.module";

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
    CatalogModule,
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    StemsProcessor,
    StemPubSubPublisher,
    StemResultSubscriber,
    StemWatchdogService,
  ],
  exports: [IngestionService],
})
export class IngestionModule { }
