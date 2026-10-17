import { Module } from "@nestjs/common";
import { NotificationModule } from "../notifications/notification.module";
import { ContactEmailController } from "./contact_email.controller";
import { ContactEmailService } from "./contact_email.service";
import { EmailConfig } from "./email_config";
import { EmailDeliveryService } from "./email_delivery.service";
import { EmailPublicController } from "./email_public.controller";
import { EmailSnsService } from "./email_sns.service";
import { EMAIL_TRANSPORT, createEmailTransport } from "./email_transport";

/**
 * Optional email for platform notices (#2169). The API only manages the
 * contact address and answers the email links; sending notices is done by the
 * scheduled `run_email_deliveries` job (deployment wiring lives outside this
 * repository).
 */
@Module({
  imports: [NotificationModule],
  controllers: [ContactEmailController, EmailPublicController],
  providers: [
    {
      provide: EmailConfig,
      useFactory: () => {
        const config = new EmailConfig();
        config.logIfDisabled();
        return config;
      },
    },
    {
      provide: EMAIL_TRANSPORT,
      inject: [EmailConfig],
      useFactory: (config: EmailConfig) => createEmailTransport(config),
    },
    ContactEmailService,
    EmailDeliveryService,
    EmailSnsService,
  ],
  exports: [ContactEmailService, EmailDeliveryService, EmailConfig],
})
export class EmailModule {}
