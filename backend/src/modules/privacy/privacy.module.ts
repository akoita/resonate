import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { IdentityModule } from "../identity/identity.module";
import { AccountClosureService } from "./account_closure.service";
import { PersonalDataErasureService } from "./personal_data_erasure.service";
import { PersonalDataExportService } from "./personal_data_export.service";
import { PrivacyController } from "./privacy.controller";

/**
 * Self-service personal-data rights (#1771). Slice 2 is export; slice 3 adds
 * account closure and the erasure engine.
 *
 * Imports IdentityModule for `PersonalDataResolverService` — the one place a
 * person is turned into the five identifiers their data is keyed by. Nothing
 * here re-derives identifiers. AnalyticsModule supplies
 * `AnalyticsGovernanceService`, which owns the analytics event store, the
 * warehouse mirror and the deletion lineage (#1770); the erasure engine drives
 * it rather than reimplementing any of it.
 */
@Module({
  imports: [IdentityModule, AnalyticsModule],
  controllers: [PrivacyController],
  providers: [PersonalDataExportService, AccountClosureService, PersonalDataErasureService],
  // `AccountClosureService` is exported for the sign-in path, which must be
  // able to cancel a scheduled closure; `PersonalDataErasureService` for the
  // maintenance route the external scheduler calls.
  exports: [PersonalDataExportService, AccountClosureService, PersonalDataErasureService],
})
export class PrivacyModule {}
