/**
 * AttestationVoucherController — HTTP Contract Test
 *
 * CP-1 (#1271). Covers the JWT auth guard, the 200 response shape, and that the
 * route forwards the authenticated user id (never a client-supplied one) plus
 * the full request body — including `contentHash` and `metadataURI` — to the
 * signing service. The signing service itself is mocked here; on-chain signature
 * verification and the derivation/ownership crux are proven in the integration
 * spec.
 */

import request from "supertest";
import { ForbiddenException, INestApplication } from "@nestjs/common";
import { AttestationVoucherController } from "../modules/contracts/attestation-voucher.controller";
import { AttestationVoucherService } from "../modules/contracts/attestation-voucher.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const ATTESTER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const CONTENT_HASH = `0x${"cd".repeat(32)}`;
const METADATA_URI = "resonate://release/http-contract-fixture";
const RELEASE_ID =
  "12345678901234567890123456789012345678901234567890123456789012345678";

const REQUEST_BODY = {
  releaseId: RELEASE_ID,
  attester: ATTESTER,
  contentHash: CONTENT_HASH,
  metadataURI: METADATA_URI,
  chainId: 31337,
};

const mockService = {
  createVoucher: jest.fn().mockResolvedValue({
    attester: ATTESTER,
    tokenId: RELEASE_ID,
    deadline: 1_800_000_000,
    signature: `0x${"ab".repeat(65)}`,
  }),
};

describe("AttestationVoucherController (e2e)", () => {
  let app: INestApplication;
  const token = authToken("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");

  beforeAll(async () => {
    app = await createControllerTestApp(AttestationVoucherController, [
      { provide: AttestationVoucherService, useValue: mockService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("POST /contracts/attestation-vouchers -> 401 without JWT", async () => {
    await request(app.getHttpServer())
      .post("/contracts/attestation-vouchers")
      .send(REQUEST_BODY)
      .expect(401);

    expect(mockService.createVoucher).not.toHaveBeenCalled();
  });

  it("POST /contracts/attestation-vouchers -> 200 returns the voucher shape and forwards user id + full body", async () => {
    const res = await request(app.getHttpServer())
      .post("/contracts/attestation-vouchers")
      .set("Authorization", `Bearer ${token}`)
      .send(REQUEST_BODY)
      .expect(201);

    expect(res.body).toEqual({
      attester: ATTESTER,
      tokenId: RELEASE_ID,
      deadline: 1_800_000_000,
      signature: `0x${"ab".repeat(65)}`,
    });
    expect(mockService.createVoucher).toHaveBeenCalledWith(
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      {
        releaseId: RELEASE_ID,
        attester: ATTESTER,
        contentHash: CONTENT_HASH,
        metadataURI: METADATA_URI,
        chainId: 31337,
      },
    );
  });

  it("POST /contracts/attestation-vouchers -> ignores a client-submitted user id", async () => {
    await request(app.getHttpServer())
      .post("/contracts/attestation-vouchers")
      .set("Authorization", `Bearer ${token}`)
      // A caller trying to sign as someone else is ignored: the userId comes
      // from the verified JWT, not the body.
      .send({ ...REQUEST_BODY, userId: "0xattacker" })
      .expect(201);

    expect(mockService.createVoucher).toHaveBeenCalledWith(
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      expect.objectContaining({
        releaseId: RELEASE_ID,
        attester: ATTESTER,
        contentHash: CONTENT_HASH,
        metadataURI: METADATA_URI,
      }),
    );
  });

  it("POST /contracts/attestation-vouchers -> 403 when the service refuses (id not derivable / not owner)", async () => {
    mockService.createVoucher.mockRejectedValueOnce(
      new ForbiddenException(
        "releaseId is not derivable from attester, contentHash, and metadataURI",
      ),
    );

    await request(app.getHttpServer())
      .post("/contracts/attestation-vouchers")
      .set("Authorization", `Bearer ${token}`)
      .send(REQUEST_BODY)
      .expect(403);
  });
});
