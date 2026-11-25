import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { SupportController } from "./support.controller";
import { SupportService } from "./support.service";

/** Contact support (#2667): the public form and the operator queue. */
@Module({
  // EmailModule: the receipt email.
  imports: [EmailModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
