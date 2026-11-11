/**
 * Admin remix watermark check (#2575) — integration (Testcontainers Postgres).
 *
 * The decoder is a stand-in that returns chosen candidates; the real
 * audiowmark boundary is covered in remix-watermark-detect.spec.ts. Here: a
 * match only on an exact stored token decoded with that render's key, the
 * result an admin reads, and the evidence item a match attaches as.
 */
import { prisma } from "../db/prisma";
import type {
  RemixWatermarkCandidate,
  RemixWatermarkDetector,
} from "../modules/remix/remix-watermark-detect";
import {
  REMIX_WATERMARK_MATCH_CAVEAT,
  RemixWatermarkDetectionService,
} from "../modules/remix/remix-watermark-detection.service";

const TEST_PREFIX = `wmdetect_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const hex = (seed: string) =>
  Buffer.from(`${TEST_PREFIX}${seed}`).toString("hex").padEnd(32, "0").slice(-32);
const TOKEN = hex("active");
const RETIRED_TOKEN = hex("retired");

type Stage = "plain" | "speed";
const candidate = (
  payload: string,
  keyId: string,
  stage: Stage,
  syncQuality = 2,
): RemixWatermarkCandidate => ({
  payload,
  keyId,
  keySlot: keyId === "key-old" ? "retired" : "active",
  stage,
  occurrences: 3,
  decodeError: 0.05,
  syncQuality,
});

function detectorReturning(
  byStage: Partial<Record<Stage, RemixWatermarkCandidate[] | Error>>,
  decode: () => Promise<void> = async () => undefined,
) {
  const calls: Stage[] = [];
  const detector = {
    keyIds: ["key-new", "key-old"],
    decodeClip: decode,
    candidates: async (_wav: string, stage: Stage) => {
      calls.push(stage);
      const result = byStage[stage] ?? [];
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as RemixWatermarkDetector;
  return { detector, calls };
}

describe("RemixWatermarkDetectionService (integration)", () => {
  const service = new RemixWatermarkDetectionService();
  const detectionIds: string[] = [];
  let renderId: string;
  let disputeId: string;

  const check = async (detector: RemixWatermarkDetector) => {
    service.useDetector(detector);
    const started = await service.start(Buffer.from(`${TEST_PREFIX}clip-${detectionIds.length}`));
    detectionIds.push(started.id);
    expect(started.status).toBe("pending");
    await service.settled(started.id);
    return service.get(started.id);
  };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` } });
    const row = (token: string, keyId: string) => ({
      token,
      remixProjectId: `${TEST_PREFIX}project`,
      generationJobId: `${TEST_PREFIX}gen-${keyId}`,
      renderJobId: `${TEST_PREFIX}render-${keyId}`,
      userId: USER_ID,
      sourceTrackId: `${TEST_PREFIX}track`,
      stemIds: [`${TEST_PREFIX}s1`],
      stemLicenses: [{ stemId: `${TEST_PREFIX}s1`, basis: "remix", stemPurchaseIds: [], x402SettlementIds: [] }],
      renderedStemIndexes: [],
      policyVersion: "remix-eligibility/v1",
      scheme: "audiowmark",
      schemeVersion: "0.6.5",
      strength: 15,
      keyId,
    });
    renderId = (await prisma.remixRenderWatermark.create({ data: row(TOKEN, "key-new") })).id;
    await prisma.remixRenderWatermark.create({ data: row(RETIRED_TOKEN, "key-old") });
    disputeId = (
      await prisma.dispute.create({
        data: {
          tokenId: `${TEST_PREFIX}token`,
          reporterAddr: "0xreporter",
          creatorAddr: "0xcreator",
          evidenceURI: "ipfs://x",
          counterStake: "0",
          status: "filed",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.remixWatermarkDetection.deleteMany({ where: { id: { in: detectionIds } } });
    await prisma.rightsEvidence.deleteMany({ where: { subjectType: "dispute", subjectId: disputeId } });
    await prisma.rightsEvidenceBundle.deleteMany({ where: { subjectType: "dispute", subjectId: disputeId } });
    await prisma.dispute.deleteMany({ where: { id: disputeId } });
    await prisma.remixRenderWatermark.deleteMany({ where: { userId: USER_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  it("refuses to start without a key or without a clip", async () => {
    service.useDetector(null);
    await expect(service.start(Buffer.from("x"))).rejects.toMatchObject({ status: 503 });
    expect(service.status()).toMatchObject({ configured: false, keyIds: [] });
    service.useDetector(detectorReturning({}).detector);
    await expect(service.start(undefined)).rejects.toMatchObject({ status: 400 });
  });

  it("matches a stored token on the plain stage and returns the render record, never the token", async () => {
    const { detector, calls } = detectorReturning({
      plain: [candidate(hex("noise"), "key-new", "plain", 0.2), candidate(TOKEN, "key-new", "plain")],
    });
    const view = await check(detector);
    expect(calls).toEqual(["plain"]);
    expect(view).toMatchObject({
      status: "matched",
      candidatesDecoded: 2,
      caveat: REMIX_WATERMARK_MATCH_CAVEAT,
      match: {
        keyId: "key-new",
        keySlot: "active",
        stage: "plain",
        decodeError: 0.05,
        syncQuality: 2,
        occurrences: 3,
        render: {
          id: renderId,
          remixProjectId: `${TEST_PREFIX}project`,
          generationJobId: `${TEST_PREFIX}gen-key-new`,
          ownerUserId: USER_ID,
          sourceTrackId: `${TEST_PREFIX}track`,
        },
      },
    });
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(view.clipSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls through to the speed stage, and matches a render made with the retired key", async () => {
    const { detector, calls } = detectorReturning({
      plain: [candidate(hex("noise"), "key-new", "plain", 0.2)],
      speed: [candidate(RETIRED_TOKEN, "key-old", "speed")],
    });
    const view = await check(detector);
    expect(calls).toEqual(["plain", "speed"]);
    expect(view.match).toMatchObject({ keyId: "key-old", keySlot: "retired", stage: "speed" });
  });

  it("is no match for unknown payloads, and for a token decoded with a key it was not embedded with", async () => {
    const view = await check(
      detectorReturning({
        plain: [candidate(hex("noise"), "key-new", "plain")],
        speed: [candidate(TOKEN, "key-old", "speed")],
      }).detector,
    );
    expect(view).toMatchObject({ status: "no_match", match: null, candidatesDecoded: 2 });
  });

  it("records a decode failure and a detector failure as failed, with a code", async () => {
    const undecodable = await check(
      detectorReturning({}, async () => {
        throw new Error("Invalid data found when processing input");
      }).detector,
    );
    expect(undecodable).toMatchObject({ status: "failed", failureCode: "decode_failed" });
    const broken = await check(detectorReturning({ plain: new Error("ENOENT") }).detector);
    expect(broken).toMatchObject({ status: "failed", failureCode: "detector_failed" });
  });

  it("marks an unfinished check from a lost process as interrupted", async () => {
    const row = await prisma.remixWatermarkDetection.create({
      data: {
        clipSha256: "0".repeat(64),
        clipBytes: 1,
        status: "processing",
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    });
    detectionIds.push(row.id);
    expect(await service.get(row.id)).toMatchObject({ status: "failed", failureCode: "interrupted" });
  });

  it("attaches a match to a dispute as a typed evidence item, once", async () => {
    const view = await check(detectorReturning({ plain: [candidate(TOKEN, "key-new", "plain")] }).detector);
    const attached = await service.attachEvidence(
      view.id,
      { subjectType: "dispute", subjectId: disputeId },
      "0xADMIN",
    );
    expect(attached.detection.evidenceId).toBe(attached.evidenceId);
    const evidence = await prisma.rightsEvidence.findUniqueOrThrow({ where: { id: attached.evidenceId } });
    expect(evidence).toMatchObject({
      subjectType: "dispute",
      subjectId: disputeId,
      kind: "remix_watermark_match",
      submittedByRole: "ops",
      submittedByAddress: "0xadmin",
      verificationStatus: "system_generated",
      strength: "high",
      description: REMIX_WATERMARK_MATCH_CAVEAT,
    });
    expect(evidence.metadata).toMatchObject({
      detectionId: view.id,
      renderWatermarkId: renderId,
      remixProjectId: `${TEST_PREFIX}project`,
      generationJobId: `${TEST_PREFIX}gen-key-new`,
      keyId: "key-new",
      stage: "plain",
    });
    // The evidence item reaches the dispute parties: no token, no owner id.
    const stored = JSON.stringify(evidence);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(USER_ID);

    await expect(
      service.attachEvidence(view.id, { subjectType: "dispute", subjectId: disputeId }, "0xadmin"),
    ).rejects.toMatchObject({ response: { code: "remix_watermark_already_attached" } });
  });

  it("refuses to attach a check without a match, an unknown subject or an unsupported subject type", async () => {
    const noMatch = await check(detectorReturning({}).detector);
    await expect(
      service.attachEvidence(noMatch.id, { subjectType: "dispute", subjectId: disputeId }, "0xadmin"),
    ).rejects.toMatchObject({ response: { code: "remix_watermark_no_match" } });
    await expect(
      service.attachEvidence(noMatch.id, { subjectType: "dispute", subjectId: `${TEST_PREFIX}missing` }, "0xadmin"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.attachEvidence(noMatch.id, { subjectType: "upload", subjectId: "x" }, "0xadmin"),
    ).rejects.toMatchObject({ status: 400 });
  });
});
