import { Controller, Get, Optional } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { X402Config } from './x402.config';
import { resolveX402AssetInfo, type X402AssetInfo } from './x402.public';

export type X402PublicConfig =
  | { enabled: false }
  | {
      enabled: true;
      network: string;
      chainId: number;
      facilitatorUrl: string;
      payoutAddress: string;
      asset: X402AssetInfo;
    };

@Controller('api/x402')
export class X402PublicController {
  constructor(
    private readonly x402Config: X402Config,
    @Optional()
    private readonly paymentsService?: PaymentsService,
  ) {}

  @Get('public-config')
  getPublicConfig(): X402PublicConfig {
    if (!this.x402Config.enabled) {
      return { enabled: false };
    }
    return {
      enabled: true,
      network: this.x402Config.network,
      chainId: this.x402Config.chainId,
      facilitatorUrl: this.x402Config.facilitatorUrl,
      payoutAddress: this.x402Config.payoutAddress,
      asset: resolveX402AssetInfo(
        this.x402Config.network,
        this.paymentsService?.getPaymentAssets(this.x402Config.chainId).assets,
      ),
    };
  }
}
