import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { PersonalDataExportService } from "./personal_data_export.service";
import { PrivacyController } from "./privacy.controller";

/**
 * Self-service personal-data rights (#1771). Slice 2 is export; erasure lands
 * in slice 3 alongside this controller.
 *
 * Imports IdentityModule for `PersonalDataResolverService` — the one place a
 * person is turned into the five identifiers their data is keyed by. Nothing
 * here re-derives identifiers.
 */
@Module({
  imports: [IdentityModule],
  controllers: [PrivacyController],
  providers: [PersonalDataExportService],
  exports: [PersonalDataExportService],
})
export class PrivacyModule {}
