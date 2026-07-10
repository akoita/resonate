import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "../encryption/encryption.service";
import { RightsModule } from "../rights/rights.module";
import { StorageProvider } from "../storage/storage_provider";
import { PunchlineController } from "./punchline.controller";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";
import { PunchlineClipService } from "./punchline-clip.service";

/**
 * Punchline Drops (#480, #481). Leaf module: it consumes the shared
 * upload-rights engine (via RightsModule) for the catalog-trust gate, exposes
 * the eligibility check (#480) and the vocal-stem clip extraction primitive
 * (#481). Create/publish APIs land in #482.
 *
 * StorageProvider, EncryptionService, and ConfigService are all provided by
 * @Global() modules (StorageModule, EncryptionModule, ConfigModule), so the
 * clip service injects them via a factory without importing those modules —
 * exactly as the remix module wires FfmpegStemAudioMixer.
 */
@Module({
  imports: [RightsModule],
  controllers: [PunchlineController],
  providers: [
    PunchlineEligibilityService,
    {
      provide: PunchlineClipService,
      useFactory: (
        storageProvider: StorageProvider,
        encryptionService: EncryptionService,
        configService: ConfigService,
      ) =>
        new PunchlineClipService(
          storageProvider,
          encryptionService,
          configService,
        ),
      inject: [StorageProvider, EncryptionService, ConfigService],
    },
  ],
  exports: [PunchlineEligibilityService, PunchlineClipService],
})
export class PunchlineModule {}
