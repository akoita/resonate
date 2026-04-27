import { Injectable, Logger } from "@nestjs/common";
import path from "node:path";
import { X402Config } from "./x402.config";
import { formatUsdcAmount, QuoteLicenseKey } from "./x402.quote";
import { getDefaultX402Asset } from "./x402.public";
import { prisma } from "../../db/prisma";

const {
  decodePaymentSignatureHeader,
}: { decodePaymentSignatureHeader: (header: string) => unknown } = require(path.join(
  process.cwd(),
  "node_modules/@x402/core/dist/cjs/http/index.js",
));

export type X402ProtectedResource = {
  stemId: string;
  licenseType?: QuoteLicenseKey;
  resourceUrl: string;
  description: string;
  mimeType?: string | null;
};

export type X402PaymentChallenge = {
  scheme: "x402";
  facilitatorUrl: string;
  paymentRequirements: Record<string, unknown>;
};

@Injectable()
export class X402PaymentService {
  private readonly logger = new Logger(X402PaymentService.name);

  constructor(private readonly x402Config: X402Config) {}

  async buildPaymentRequired(resource: X402ProtectedResource) {
    const licenseType = resource.licenseType ?? "personal";
    const pricing = await prisma.stemPricing.findUnique({
      where: { stemId: resource.stemId },
    });
    const amountUsd = this.resolveLicenseAmountUsd(pricing, licenseType);
    const displayPrice = `${formatUsdcAmount(amountUsd)} USDC`;
    const assetInfo = getDefaultX402Asset(this.x402Config.network);

    return {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: resource.resourceUrl,
        description: resource.description,
        mimeType: resource.mimeType || "audio/mpeg",
      },
      accepts: [
        {
          scheme: "exact",
          network: this.x402Config.network,
          amount: this.toTokenAmount(amountUsd, assetInfo.decimals),
          asset: assetInfo.address,
          payTo: this.x402Config.payoutAddress,
          maxTimeoutSeconds: 300,
          extra: {
            name: assetInfo.name,
            version: assetInfo.version,
            displayPrice,
            tool: resource.resourceUrl.startsWith("mcp://")
              ? "stem.download"
              : undefined,
            stemId: resource.stemId,
            licenseType,
          },
        },
      ],
    };
  }

  async buildPaymentChallenge(
    resource: X402ProtectedResource,
  ): Promise<X402PaymentChallenge> {
    const paymentRequired = await this.buildPaymentRequired(resource);
    return {
      scheme: "x402",
      facilitatorUrl: this.x402Config.facilitatorUrl,
      paymentRequirements: paymentRequired.accepts[0],
    };
  }

  async verifyAndSettle(
    paymentProof: string,
    paymentRequirements: unknown,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    let paymentPayload: unknown;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentProof);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`x402 payment proof could not be decoded: ${reason}`);
      return { ok: false, reason: `payment_proof_decode_failed: ${reason}` };
    }

    const verifyResult = await this.verifyPayment(paymentPayload, paymentRequirements);
    if (!verifyResult.ok) {
      return verifyResult;
    }

    try {
      await this.settlePayment(paymentPayload, paymentRequirements);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`x402 settle threw: ${reason}`);
      return { ok: false, reason: `settle_failed: ${reason}` };
    }
  }

  resolveLicenseAmountUsd(
    pricing:
      | {
          basePlayPriceUsd?: number | null;
          remixLicenseUsd?: number | null;
          commercialLicenseUsd?: number | null;
        }
      | null
      | undefined,
    licenseType: QuoteLicenseKey,
  ) {
    if (licenseType === "remix") {
      return pricing?.remixLicenseUsd ?? 5;
    }
    if (licenseType === "commercial") {
      return pricing?.commercialLicenseUsd ?? 25;
    }
    return pricing?.basePlayPriceUsd ?? 0.05;
  }

  private toTokenAmount(amount: number, decimals: number): string {
    const [intPart, decPart = ""] = String(amount).split(".");
    const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
    return (intPart + paddedDec).replace(/^0+/, "") || "0";
  }

  private async verifyPayment(
    paymentPayload: unknown,
    paymentRequirements: unknown,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const response = await fetch(`${this.x402Config.facilitatorUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload,
          paymentRequirements,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        this.logger.warn(
          `Facilitator /verify returned ${response.status}${
            errorBody ? `: ${errorBody}` : ""
          }`,
        );
        return {
          ok: false,
          reason: `facilitator_http_${response.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ""}`,
        };
      }

      const result = await response.json();
      if (result.isValid === true) {
        return { ok: true };
      }
      const facilitatorReason = typeof result.invalidReason === "string"
        ? result.invalidReason
        : typeof result.reason === "string"
          ? result.reason
          : "verification_rejected";
      this.logger.warn(`Facilitator /verify rejected: ${facilitatorReason}`);
      return { ok: false, reason: facilitatorReason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Facilitator /verify failed: ${message}`);
      return { ok: false, reason: `facilitator_unreachable: ${message}` };
    }
  }

  private async settlePayment(
    paymentPayload: unknown,
    paymentRequirements: unknown,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.x402Config.facilitatorUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload,
          paymentRequirements,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        this.logger.warn(
          `Facilitator /settle returned ${response.status}${
            errorBody ? `: ${errorBody}` : ""
          }`,
        );
      }
    } catch (error) {
      this.logger.error(`Facilitator /settle failed: ${error}`);
    }
  }
}
