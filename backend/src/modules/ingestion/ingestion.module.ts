import { backgroundLoopProviders } from "../../config/runtime_mode";
import { Module } from "@nestjs/common";
import { IngestionController } from "./ingestion.controller";
import { IngestionService } from "./ingestion.service";
import { OfficialStemsController } from "./official-stems.controller";
import { OfficialStemsService } from "./official-stems.service";
import { BullModule } from "@nestjs/bullmq";
import { StemsProcessor } from "./stems.processor";
import { StemPubSubPublisher } from "./stem-pubsub.publisher";
import { StemResultSubscriber } from "./stem-result.subscriber";
import { StemWatchdogService } from "./stem-watchdog.service";
import { StemFeatureBackfillService } from "./stem-feature-backfill.service";
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
  controllers: [IngestionController, OfficialStemsController],
  providers: [
    IngestionService,
    OfficialStemsService,
    // Queue consumers run only where background loops run (#1608); the queue
    // itself stays registered so every mode can enqueue.
    ...backgroundLoopProviders("stemsQueueProcessor", [StemsProcessor]),
    StemPubSubPublisher,
    StemResultSubscriber,
    StemWatchdogService,
    StemFeatureBackfillService,
  ],
  exports: [IngestionService, StemFeatureBackfillService],
})
export class IngestionModule { }
