import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  AttestationVoucherResponse,
  AttestationVoucherService,
} from "./attestation-voucher.service";

type AttestationVoucherBody = {
  releaseId: string;
  attester: string;
  contentHash: string;
  metadataURI: string;
  chainId?: number;
};

/**
 * CP-1 (#1271): issues registrar-signed EIP-712 attestation authorization
 * vouchers for ContentProtection.attest / attestRelease. The signing service
 * verifies the caller controls `attester` and that `releaseId` is derivable
 * from that attester (+ contentHash + metadataURI) before signing — see
 * AttestationVoucherService for the crux.
 */
@Controller("contracts/attestation-vouchers")
export class AttestationVoucherController {
  constructor(
    private readonly attestationVoucherService: AttestationVoucherService,
  ) {}

  @Post()
  @UseGuards(AuthGuard("jwt"))
  async createVoucher(
    @Body() body: AttestationVoucherBody,
    @Req() req: { user: { userId: string } },
  ): Promise<AttestationVoucherResponse> {
    return this.attestationVoucherService.createVoucher(req.user.userId, {
      releaseId: body.releaseId,
      attester: body.attester,
      contentHash: body.contentHash,
      metadataURI: body.metadataURI,
      chainId: body.chainId,
    });
  }
}
