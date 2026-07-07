import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { SharedModule } from "../shared/shared.module";
import { GenerationModule } from "../generation/generation.module";
import { CreditsModule } from "../credits/credits.module";
import { LyriaClient } from "../generation/lyria.client";
import { EncryptionService } from "../encryption/encryption.service";
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
import {
  AUDIO_CONDITIONED_REMIX_GENERATION_PROVIDER_KIND,
  AudioConditionedRemixGenerationProvider,
} from "./audio-conditioned-remix-generation.provider";
import { RemixGenerationProcessor } from "./remix-generation.processor";
import { RemixWorkerPrewarmService } from "./remix-worker-prewarm.service";
import {
  FfmpegStemMixRenderer,
  REMIX_STEM_MIX_RENDERER,
} from "./remix-stem-mix.renderer";
import {
  FfmpegLayeredRemixRenderer,
  REMIX_LAYERED_RENDERER,
} from "./remix-layered-renderer";
import {
  FfmpegStemAudioMixer,
  STEM_AUDIO_MIXER,
  type StemAudioMixer,
} from "./stem-audio-mixer";

@Module({
  imports: [
    SharedModule,
    GenerationModule,
    CreditsModule,
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
    RemixWorkerPrewarmService,
    // Shared stem mixer (#1182 slice 4): loads + ffmpeg-mixes the unmuted
    // stems into one buffer. Used by both stem_mix render and the
    // audio-conditioned provider so the encrypted-stem deferral and
    // path-traversal containment live in one place.
    {
      provide: STEM_AUDIO_MIXER,
      useFactory: (
        storageProvider: StorageProvider,
        encryptionService: EncryptionService,
      ) => new FfmpegStemAudioMixer(storageProvider, encryptionService),
      inject: [StorageProvider, EncryptionService],
    },
    // Provider boundary (#896): REMIX_GENERATION_PROVIDER_KIND selects the
    // implementation (default stub; "lyria" reuses the catalog generation
    // stack, #1162; "audio-conditioned" sends the mixed stems to the
    // self-hosted Stable Audio 3 worker, #1182 slice 4). REMIX_GENERATION_ENABLED
    // stays the master gate inside every provider, so kind selection alone
    // never enables generation.
    {
      provide: REMIX_GENERATION_PROVIDER,
      useFactory: (
        lyriaClient: LyriaClient,
        storageProvider: StorageProvider,
        mixer: StemAudioMixer,
      ) => {
        switch (process.env.REMIX_GENERATION_PROVIDER_KIND) {
          case "lyria":
            return new LyriaRemixGenerationProvider(lyriaClient, storageProvider);
          case AUDIO_CONDITIONED_REMIX_GENERATION_PROVIDER_KIND:
            return new AudioConditionedRemixGenerationProvider(
              mixer,
              storageProvider,
            );
          default:
            return new StubRemixGenerationProvider();
        }
      },
      inject: [LyriaClient, StorageProvider, STEM_AUDIO_MIXER],
    },
    // stem_mix rendering (#1189): pure ffmpeg DSP, no AI gate — the worker
    // routes stem_mix jobs here instead of the generation provider.
    {
      provide: REMIX_STEM_MIX_RENDERER,
      useFactory: (mixer: StemAudioMixer, storageProvider: StorageProvider) =>
        new FfmpegStemMixRenderer(mixer, storageProvider),
      inject: [STEM_AUDIO_MIXER, StorageProvider],
    },
    // stem_plus_ai rendering (#1209): prompted provider output is an
    // additive generated layer, mixed over the arranged licensed stems.
    {
      provide: REMIX_LAYERED_RENDERER,
      useFactory: (mixer: StemAudioMixer, storageProvider: StorageProvider) =>
        new FfmpegLayeredRemixRenderer(mixer, storageProvider),
      inject: [STEM_AUDIO_MIXER, StorageProvider],
    },
  ],
  exports: [RemixEligibilityService, RemixProjectService],
})
export class RemixModule {}
