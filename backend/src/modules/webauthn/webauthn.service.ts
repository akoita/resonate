import { Injectable, Logger } from "@nestjs/common";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import { prisma } from "../../db/prisma";
import { randomUUID } from "crypto";


/**
 * Convert a COSE-encoded P-256 public key to SPKI DER format.
 * SimpleWebAuthn stores keys in COSE format, but the ZeroDev SDK
 * expects SPKI DER base64 (for crypto.subtle.importKey('spki')).
 *
 * Instead of adding a CBOR library, we use Node's built-in crypto
 * to create the SPKI key from the raw COSE x/y coordinates.
 */
function coseToSpkiDer(coseKey: Buffer | Uint8Array): Buffer {
  // COSE P-256 key is a CBOR map with well-known byte offsets.
  // Rather than fully parsing CBOR, extract x/y using simple heuristics:
  // The x and y coordinates are 32-byte values preceded by a CBOR byte string header.
  // For a simpler approach, use Node crypto to convert:

  // Try parsing as CBOR manually: find the -2 and -3 keys
  const buf = Buffer.from(coseKey);

  // Simple CBOR map parser for COSE EC2 keys
  const map = parseCborMap(buf);

  const x = map.get(-2);
  const y = map.get(-3);

  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error("Missing or invalid x/y coordinates in COSE key");
  }

  // Build uncompressed EC point: 0x04 || x || y
  const uncompressedPoint = Buffer.concat([Buffer.from([0x04]), x, y]);

  // SPKI DER for P-256:
  // SEQUENCE {
  //   SEQUENCE {
  //     OID ecPublicKey (1.2.840.10045.2.1)
  //     OID prime256v1 (1.2.840.10045.3.1.7)
  //   }
  //   BIT STRING (uncompressed point)
  // }
  const ecPublicKeyOid = Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
  const prime256v1Oid = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, ecPublicKeyOid.length + prime256v1Oid.length]),
    ecPublicKeyOid,
    prime256v1Oid,
  ]);

  // BIT STRING: 0x03 length 0x00(padding) uncompressedPoint
  const bitString = Buffer.concat([
    Buffer.from([0x03, uncompressedPoint.length + 1, 0x00]),
    uncompressedPoint,
  ]);

  // Outer SEQUENCE
  const spki = Buffer.concat([
    Buffer.from([0x30, algorithmIdentifier.length + bitString.length]),
    algorithmIdentifier,
    bitString,
  ]);

  return spki;
}

/**
 * Minimal CBOR map parser sufficient for COSE EC2 key decoding.
 * Only handles the subset needed: maps with integer keys and byte string values.
 */
function parseCborMap(buf: Buffer): Map<number, Buffer> {
  const result = new Map<number, Buffer>();
  let offset = 0;

  // First byte should be a map (major type 5)
  const firstByte = buf[offset++];
  const majorType = firstByte >> 5;
  if (majorType !== 5) throw new Error(`Expected CBOR map, got major type ${majorType}`);

  const mapLength = firstByte & 0x1f;

  for (let i = 0; i < mapLength; i++) {
    // Read key (integer, possibly negative)
    const keyByte = buf[offset++];
    let key: number;
    const keyMajor = keyByte >> 5;
    const keyAdditional = keyByte & 0x1f;

    if (keyMajor === 0) {
      // Unsigned integer
      key = keyAdditional;
    } else if (keyMajor === 1) {
      // Negative integer: -1 - n
      key = -1 - keyAdditional;
    } else {
      throw new Error(`Unexpected CBOR key type: major ${keyMajor}`);
    }

    // Read value
    const valByte = buf[offset++];
    const valMajor = valByte >> 5;
    const valAdditional = valByte & 0x1f;

    if (valMajor === 2) {
      // Byte string
      let len: number;
      if (valAdditional < 24) {
        len = valAdditional;
      } else if (valAdditional === 24) {
        len = buf[offset++];
      } else {
        throw new Error(`Unsupported CBOR byte string length encoding`);
      }
      result.set(key, buf.subarray(offset, offset + len));
      offset += len;
    } else if (valMajor === 0) {
      // Unsigned integer value — store as 1-byte buffer
      result.set(key, Buffer.from([valAdditional]));
    } else if (valMajor === 1) {
      // Negative integer value
      result.set(key, Buffer.from([valAdditional]));
    } else {
      throw new Error(`Unsupported CBOR value type: major ${valMajor}`);
    }
  }

  return result;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);

  // In-memory challenge store (keyed by purpose + rpId)
  // Latest challenge wins — adequate for single-user local dev
  private challenges = new Map<string, { challenge: string; expiresAt: number }>();

  private get rpName() {
    return "Resonate";
  }

  private getRpId(requestedRpId?: string): string {
    return requestedRpId || process.env.WEBAUTHN_RP_ID || "localhost";
  }

  private getOrigin(): string {
    return process.env.WEBAUTHN_ORIGIN || "http://localhost:3001";
  }

  private storeChallenge(key: string, challenge: string) {
    this.challenges.set(key, {
      challenge,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
  }

  private consumeChallenge(key: string): string | null {
    const entry = this.challenges.get(key);
    if (!entry) return null;
    this.challenges.delete(key);
    if (Date.now() > entry.expiresAt) return null;
    return entry.challenge;
  }

  /**
   * POST /register/options
   * Request: { username, rpID }
   * Response: { options: PublicKeyCredentialCreationOptions, userId: string }
   */
  async getRegistrationOptions(username: string, rpID?: string) {
    const rpId = this.getRpId(rpID);
    const userId = randomUUID();

    // Find existing credentials for this user to exclude
    const existingCreds = await prisma.webAuthnCredential.findMany({
      where: { passkeyName: username, rpId },
    });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: rpId,
      userName: username,
      userDisplayName: username,
      attestationType: "none",
      excludeCredentials: existingCreds.map((cred: any) => ({
        id: cred.credentialId,
        type: "public-key" as const,
        transports: cred.transports as any[],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    // Store challenge keyed by "register:{rpId}"
    this.storeChallenge(`register:${rpId}`, options.challenge);

    this.logger.log(`Registration options generated for "${username}" (userId: ${userId})`);
    return { options, userId };
  }

  /**
   * POST /register/verify
   * Request: { userId, username, cred, rpID }
   * Response: { verified: boolean }
   */
  async verifyRegistration(
    userId: string,
    username: string,
    cred: any,
    rpID?: string,
  ) {
    const rpId = this.getRpId(rpID);
    const expectedChallenge = this.consumeChallenge(`register:${rpId}`);

    if (!expectedChallenge) {
      this.logger.warn(`No registration challenge found for rpId ${rpId}`);
      return { verified: false };
    }

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: cred,
        expectedChallenge,
        expectedOrigin: this.getOrigin(),
        expectedRPID: rpId,
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.error(`Registration verification failed: ${err}`);
      return { verified: false };
    }

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;

      // Store the credential
      await prisma.webAuthnCredential.create({
        data: {
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: (cred.response.transports || []) as string[],
          userId,
          passkeyName: username,
          rpId,
        },
      });

      this.logger.log(`Credential registered for "${username}" (credId: ${credential.id.substring(0, 16)}...)`);
    }

    return { verified: verification.verified };
  }

  /**
   * POST /login/options
   * Request: { rpID }
   * Response: PublicKeyCredentialRequestOptions (with a challengeId cookie/header)
   */
  async getAuthenticationOptions(rpID?: string) {
    const rpId = this.getRpId(rpID);

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: "preferred",
      // Allow any credential — the browser will filter by RP ID
    });

    // Store challenge keyed by "login:{rpId}"
    this.storeChallenge(`login:${rpId}`, options.challenge);

    this.logger.log(`Authentication options generated for rpId: ${rpId}`);

    // Return options directly (ZeroDev SDK expects this shape)
    return options;
  }

  /**
   * POST /login/verify
   * Request: { cred, rpID }
   * Response: { verification: { verified }, pubkey: base64-encoded SPKI DER }
   */
  async verifyAuthentication(
    cred: any,
    rpID?: string,
  ) {
    const rpId = this.getRpId(rpID);

    // Find the credential in our DB
    const storedCred = await prisma.webAuthnCredential.findUnique({
      where: { credentialId: cred.id },
    });

    if (!storedCred) {
      this.logger.warn(`Unknown credential: ${cred.id}`);
      return { verification: { verified: false }, pubkey: null };
    }

    // Retrieve the challenge
    const expectedChallenge = this.consumeChallenge(`login:${rpId}`);

    if (!expectedChallenge) {
      this.logger.warn("No valid challenge found for authentication");
      return { verification: { verified: false }, pubkey: null };
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: cred,
        expectedChallenge,
        expectedOrigin: this.getOrigin(),
        expectedRPID: rpId,
        credential: {
          id: storedCred.credentialId,
          publicKey: new Uint8Array(storedCred.publicKey),
          counter: Number(storedCred.counter),
          transports: storedCred.transports as any[],
        },
      });
    } catch (err) {
      this.logger.error(`Authentication verification failed: ${err}`);
      return { verification: { verified: false }, pubkey: null };
    }

    if (verification.verified) {
      // Update counter to prevent replay attacks
      await prisma.webAuthnCredential.update({
        where: { credentialId: cred.id },
        data: { counter: BigInt(verification.authenticationInfo.newCounter) },
      });

      // Convert COSE public key to SPKI DER base64 (what ZeroDev SDK expects)
      // The SDK imports this via crypto.subtle.importKey('spki', ...)
      const spkiDer = coseToSpkiDer(storedCred.publicKey);
      const pubkeyBase64 = spkiDer.toString("base64");

      this.logger.log(`Authentication verified for credential ${cred.id.substring(0, 16)}...`);
      return { verification: { verified: true }, pubkey: pubkeyBase64 };
    }

    return { verification: { verified: false }, pubkey: null };
  }
}

