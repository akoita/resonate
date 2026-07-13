import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "../encryption/encryption.service";
import { RightsModule } from "../rights/rights.module";
import { StorageProvider } from "../storage/storage_provider";
import { X402Module } from "../x402/x402.module";
import { PaymentsModule } from "../payments/payments.module";
import { PunchlineController } from "./punchline.controller";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";
import { PunchlineClipService } from "./punchline-clip.service";
import { PunchlineCollectService } from "./punchline-collect.service";
import { PunchlineDropService } from "./punchline-drop.service";
import { PunchlineUnlockService } from "./punchline-unlock.service";
import { PunchlineMetricsService } from "./punchline-metrics.service";
import { PunchlineX402Service } from "./punchline-x402.service";
import { X402RefundReconciliationController } from "./x402-refund-reconciliation.controller";
import { X402RefundReconciliationService } from "./x402-refund-reconciliation.service";
import { X402RefundWatchdogService } from "./x402-refund-watchdog.service";

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
  imports: [RightsModule, X402Module, PaymentsModule],
  controllers: [PunchlineController, X402RefundReconciliationController],
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
    PunchlineMetricsService,
    PunchlineX402Service,
    X402RefundReconciliationService,
    X402RefundWatchdogService,
  ],
  exports: [
    PunchlineEligibilityService,
    PunchlineClipService,
    PunchlineDropService,
    PunchlineCollectService,
    PunchlineUnlockService,
    PunchlineMetricsService,
    PunchlineX402Service,
    X402RefundReconciliationService,
  ],
})
export class PunchlineModule {}
