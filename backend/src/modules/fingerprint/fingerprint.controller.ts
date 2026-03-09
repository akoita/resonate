import { Controller, Post, Param, Body, Logger } from "@nestjs/common";
import { FingerprintService } from "./fingerprint.service";

@Controller("ingestion")
export class FingerprintController {
  private readonly logger = new Logger(FingerprintController.name);

  constructor(private readonly fingerprintService: FingerprintService) {}

  /**
   * Receives fingerprint from the Demucs worker and checks for duplicates.
   * Called by the worker BEFORE stem separation begins.
   */
  @Post("fingerprint/:releaseId/:trackId")
  async receiveFingerprint(
    @Param("releaseId") releaseId: string,
    @Param("trackId") trackId: string,
    @Body()
    body: {
      fingerprint: string;
      fingerprintHash: string;
      duration: number;
    },
  ) {
    this.logger.log(
      `Fingerprint received for release=${releaseId}, track=${trackId} ` +
      `(hash=${body.fingerprintHash?.slice(0, 16)}...)`,
    );

    const result = await this.fingerprintService.registerFingerprint({
      trackId,
      releaseId,
      fingerprint: body.fingerprint,
      fingerprintHash: body.fingerprintHash,
      duration: body.duration,
    });

    return result;
  }
}
