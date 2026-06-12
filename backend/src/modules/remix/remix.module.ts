import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { SharedModule } from "../shared/shared.module";
import { GenerationModule } from "../generation/generation.module";
import { LyriaClient } from "../generation/lyria.client";
import { StorageProvider } from "../storage/storage_provider";
import { RemixController } from "./remix.controller";
import { RemixService } from "./remix.service";
import { RemixEligibilityService } from "./remix-eligibility.service";
import {
  REMIX_GENERATION_QUEUE,
  RemixProjectService,
} from "./remix-project.service";
import {
  REMIX_GENERATION_PROVIDER,
  StubRemixGenerationProvider,
} from "./remix-generation.provider";
import { LyriaRemixGenerationProvider } from "./lyria-remix-generation.provider";
import { RemixGenerationProcessor } from "./remix-generation.processor";

@Module({
  imports: [
    SharedModule,
    GenerationModule,
    BullModule.registerQueue({
      name: REMIX_GENERATION_QUEUE,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [RemixController],
  providers: [
    RemixService,
    RemixEligibilityService,
    RemixProjectService,
    RemixGenerationProcessor,
    // Provider boundary (#896): REMIX_GENERATION_PROVIDER_KIND selects the
    // implementation (default stub; "lyria" reuses the catalog generation
    // stack, #1162). REMIX_GENERATION_ENABLED stays the master gate inside
    // every provider, so kind selection alone never enables generation.
    {
      provide: REMIX_GENERATION_PROVIDER,
      useFactory: (lyriaClient: LyriaClient, storageProvider: StorageProvider) =>
        process.env.REMIX_GENERATION_PROVIDER_KIND === "lyria"
          ? new LyriaRemixGenerationProvider(lyriaClient, storageProvider)
          : new StubRemixGenerationProvider(),
      inject: [LyriaClient, StorageProvider],
    },
  ],
  exports: [RemixEligibilityService, RemixProjectService],
})
export class RemixModule {}
