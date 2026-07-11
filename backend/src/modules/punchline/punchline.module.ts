import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "../encryption/encryption.service";
import { RightsModule } from "../rights/rights.module";
import { StorageProvider } from "../storage/storage_provider";
import { PunchlineController } from "./punchline.controller";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";
import { PunchlineClipService } from "./punchline-clip.service";
import { PunchlineCollectService } from "./punchline-collect.service";
import { PunchlineDropService } from "./punchline-drop.service";
import { PunchlineUnlockService } from "./punchline-unlock.service";

/**
 * Punchline Drops (#480, #481, #482, #485). Leaf module: it consumes the shared
 * upload-rights engine (via RightsModule) for the catalog-trust gate, exposes
 * the eligibility check (#480), the vocal-stem clip extraction primitive
 * (#481), the draft + publish APIs (#482), and the fan collect / ownership
 * grant (#485).
 *
 * StorageProvider, EncryptionService, and ConfigService are all provided by
 * @Global() modules (StorageModule, EncryptionModule, ConfigModule), so the
 * clip service injects them via a factory without importing those modules —
 * exactly as the remix module wires FfmpegStemAudioMixer.
 *
 * PunchlineDropService is a plain class provider: Nest resolves its EventBus
 * (from the @Global() SharedModule), ConfigService, and the two sibling
 * punchline services by type. It orchestrates the #480 gate + #481 clip
 * primitive behind the mutation boundary.
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
    PunchlineDropService,
    PunchlineCollectService,
    PunchlineUnlockService,
  ],
  exports: [
    PunchlineEligibilityService,
    PunchlineClipService,
    PunchlineDropService,
    PunchlineCollectService,
    PunchlineUnlockService,
  ],
})
export class PunchlineModule {}
