import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [IdentityModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
