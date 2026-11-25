import { Global, Module } from "@nestjs/common";
import { AdminInvitationsController } from "./admin_invitations.controller";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

/** #2662. Global so sign-in and artist onboarding can consult the registration rules. */
@Global()
@Module({
  controllers: [InvitationsController, AdminInvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
