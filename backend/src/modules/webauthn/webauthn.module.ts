import { Module } from "@nestjs/common";
import { WebAuthnController } from "./webauthn.controller";
import { WebAuthnService } from "./webauthn.service";

@Module({
  controllers: [WebAuthnController],
  providers: [WebAuthnService],
  exports: [WebAuthnService],
})
export class WebAuthnModule {}
