/**
 * Remix watermark token row (#2573) — integration (Testcontainers Postgres).
 *
 * The worker writes one admin-only row per watermarked render: the token, the
 * render's provenance and the licence basis of each rendered stem.
 */
import { prisma } from "../db/prisma";
import { recordRemixRenderWatermark } from "../modules/remix/remix-watermark-record";

const TEST_PREFIX = `wmrecord_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;

describe("recordRemixRenderWatermark (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` },
    });
  });

  afterAll(async () => {
    await prisma.remixRenderWatermark.deleteMany({ where: { userId: USER_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  const watermark = (token: string) => ({
    token,
    scheme: "audiowmark" as const,
    schemeVersion: "0.6.5",
    strength: 15,
    keyId: "test-key",
    stemIndexes: [0, 1],
  });

  it("writes the token row with the rendered stems' licence basis", async () => {
    const token = "a".repeat(32);
    await recordRemixRenderWatermark({
      watermark: watermark(token),
      remixProjectId: `${TEST_PREFIX}project`,
      generationJobId: `${TEST_PREFIX}gen`,
      renderJobId: `${TEST_PREFIX}render`,
      userId: USER_ID,
      sourceTrackId: `${TEST_PREFIX}track`,
      secondarySourceTrackId: null,
      stemIds: [`${TEST_PREFIX}s1`, `${TEST_PREFIX}s2`],
      eligibility: [
        { stemId: `${TEST_PREFIX}s1`, licensed: true, exportLicensed: true },
        { stemId: `${TEST_PREFIX}s2`, licensed: true, exportLicensed: false },
        // Muted in this render: not part of the record.
        { stemId: `${TEST_PREFIX}s3`, licensed: true, exportLicensed: true },
      ],
      policyVersion: "remix-eligibility/v1",
    });

    const row = await prisma.remixRenderWatermark.findUniqueOrThrow({ where: { token } });
    expect(row).toMatchObject({
      remixProjectId: `${TEST_PREFIX}project`,
      generationJobId: `${TEST_PREFIX}gen`,
      renderJobId: `${TEST_PREFIX}render`,
      userId: USER_ID,
      sourceTrackId: `${TEST_PREFIX}track`,
      secondarySourceTrackId: null,
      stemIds: [`${TEST_PREFIX}s1`, `${TEST_PREFIX}s2`],
      renderedStemIndexes: [0, 1],
      policyVersion: "remix-eligibility/v1",
      scheme: "audiowmark",
      schemeVersion: "0.6.5",
      strength: 15,
      keyId: "test-key",
    });
    // No wallet, no purchases: a licensed stem was licensed by ownership.
    expect(row.stemLicenses).toEqual([
      { stemId: `${TEST_PREFIX}s1`, basis: "owner", stemPurchaseIds: [], x402SettlementIds: [] },
      { stemId: `${TEST_PREFIX}s2`, basis: "owner", stemPurchaseIds: [], x402SettlementIds: [] },
    ]);
  });

  it("refuses a duplicate token", async () => {
    const input = {
      watermark: watermark("b".repeat(32)),
      remixProjectId: `${TEST_PREFIX}project`,
      generationJobId: `${TEST_PREFIX}gen2`,
      renderJobId: `${TEST_PREFIX}render2`,
      userId: USER_ID,
      sourceTrackId: `${TEST_PREFIX}track`,
      secondarySourceTrackId: null,
      stemIds: [],
      eligibility: [],
      policyVersion: "remix-eligibility/v1",
    };
    await recordRemixRenderWatermark(input);
    await expect(recordRemixRenderWatermark(input)).rejects.toThrow();
  });
});
