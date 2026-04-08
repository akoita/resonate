import { BadRequestException, InternalServerErrorException } from "@nestjs/common";

type VerificationResult = {
  provider: string;
  status: string;
  verified: boolean;
  score?: number | null;
  threshold?: number | null;
  verifiedAt?: Date | null;
  expiresAt?: Date | null;
  details?: unknown;
};

const DEFAULT_GITCOIN_API_URL = "https://api.passport.xyz";
const DEFAULT_WORLD_API_URL = "https://developer.worldcoin.org/api/v2";

export class HumanVerificationService {
  private getProvider() {
    return (process.env.HUMAN_VERIFICATION_PROVIDER || "mock").toLowerCase();
  }

  async verify(input: {
    walletAddress: string;
    provider?: string;
    proof?: string;
  }): Promise<VerificationResult> {
    const provider = (input.provider || this.getProvider()).toLowerCase();

    if (provider === "mock") {
      const expectedProof = process.env.HUMAN_VERIFICATION_MOCK_PROOF || "resonate-human";
      if ((input.proof || "").trim() !== expectedProof) {
        throw new BadRequestException("Mock verification token is invalid.");
      }

      return {
        provider,
        status: "verified",
        verified: true,
        score: 1,
        threshold: 1,
        verifiedAt: new Date(),
      };
    }

    if (provider === "passport") {
      return this.verifyPassport(input.walletAddress);
    }

    if (provider === "worldcoin") {
      return this.verifyWorldcoin(input.walletAddress, input.proof || "");
    }

    throw new BadRequestException(`Unsupported proof-of-humanity provider: ${provider}`);
  }

  private async verifyPassport(walletAddress: string): Promise<VerificationResult> {
    const scorerId = process.env.GITCOIN_PASSPORT_SCORER_ID;
    const apiKey = process.env.GITCOIN_PASSPORT_API_KEY;
    const apiUrl = process.env.GITCOIN_PASSPORT_API_URL || DEFAULT_GITCOIN_API_URL;
    const threshold = Number(process.env.GITCOIN_PASSPORT_THRESHOLD || "20");

    if (!scorerId || !apiKey) {
      throw new BadRequestException("Gitcoin Passport is not configured.");
    }

    const response = await fetch(`${apiUrl}/v2/stamps/${encodeURIComponent(scorerId)}/score/${walletAddress.toLowerCase()}`, {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new BadRequestException(payload?.detail || payload?.message || "Gitcoin Passport verification failed.");
    }

    const score = Number(payload?.score ?? payload?.passport?.score ?? 0);
    const expiresAt = payload?.expiration_date ? new Date(payload.expiration_date) : null;

    return {
      provider: "passport",
      status: score >= threshold ? "verified" : "below_threshold",
      verified: score >= threshold,
      score,
      threshold,
      verifiedAt: score >= threshold ? new Date() : null,
      expiresAt,
      details: payload,
    };
  }

  private async verifyWorldcoin(walletAddress: string, proof: string): Promise<VerificationResult> {
    const appId = process.env.WORLD_ID_APP_ID;
    const action = process.env.WORLD_ID_ACTION;
    const apiUrl = process.env.WORLD_ID_API_URL || DEFAULT_WORLD_API_URL;
    const verificationLevel = process.env.WORLD_ID_VERIFICATION_LEVEL || "orb";

    if (!appId || !action) {
      throw new BadRequestException("World ID is not configured.");
    }

    if (!proof.trim()) {
      throw new BadRequestException("World ID proof payload is required.");
    }

    let parsedProof: any;
    try {
      parsedProof = JSON.parse(proof);
    } catch {
      throw new BadRequestException("World ID proof must be valid JSON.");
    }

    const response = await fetch(`${apiUrl}/verify/${encodeURIComponent(appId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        signal: walletAddress.toLowerCase(),
        proof: parsedProof.proof,
        merkle_root: parsedProof.merkle_root ?? parsedProof.merkleRoot,
        nullifier_hash: parsedProof.nullifier_hash ?? parsedProof.nullifierHash,
        verification_level: parsedProof.verification_level ?? parsedProof.verificationLevel ?? verificationLevel,
      }),
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new BadRequestException(payload?.detail || payload?.code || "World ID verification failed.");
    }

    if (payload?.success === false) {
      throw new InternalServerErrorException("World ID verification returned an unsuccessful response.");
    }

    return {
      provider: "worldcoin",
      status: "verified",
      verified: true,
      score: 1,
      threshold: 1,
      verifiedAt: new Date(),
      details: payload,
    };
  }
}
