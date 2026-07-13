import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { ContractsService } from "./contracts.service";
import { IndexerService } from "./indexer.service";
import { MetadataController } from "./metadata.controller";
import { NotificationModule } from "../notifications/notification.module";
import { MintAuthorizationController } from "./mint-authorization.controller";
import { MintAuthorizationService } from "./mint-authorization.service";
import { AttestationVoucherController } from "./attestation-voucher.controller";
import { AttestationVoucherService } from "./attestation-voucher.service";
import { RightsModule } from "../rights/rights.module";
import { TrustModule } from "../trust/trust.module";
import { RemixModule } from "../remix/remix.module";

@Module({
  imports: [SharedModule, NotificationModule, RightsModule, TrustModule, RemixModule],
  controllers: [
    MetadataController,
    MintAuthorizationController,
    AttestationVoucherController,
  ],
  providers: [
    ContractsService,
    IndexerService,
    MintAuthorizationService,
    AttestationVoucherService,
  ],
  exports: [
    ContractsService,
    IndexerService,
    MintAuthorizationService,
    AttestationVoucherService,
  ],
})
export class ContractsModule {}
