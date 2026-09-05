/**
 * Punchline Drops eligibility — Integration Test (Testcontainers) (#480)
 *
 * Exercises the real allow/deny gate against Testcontainer Postgres (no mocked
 * Prisma). Seeds User → Artist → Release → Track → Stem per case and asserts:
 *   (a) clean + published + vocals stem + allowed rights route → eligible
 *   (b) quarantined track → content_quarantined
 *   (c) dmca_removed track → content_removed
 *   (d) track with no vocals stem → no_vocals_stem
 *   (e) unpublished (processing) release → track_not_published
 *   (f) low-trust rights route (LIMITED_MONITORING) → rights_not_allowed
 *   (g) missing track → track_not_found (no track snapshot)
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-eligibility'
 */

import { prisma } from "../db/prisma";
import { PunchlineEligibilityService } from "../modules/punchline/punchline-eligibility.service";
import {
  PUNCHLINE_RIGHTS_LABEL,
  PUNCHLINE_RIGHTS_SUMMARY,
} from "../modules/punchline/punchline-rights";
import {
  PUNCHLINE_CLIP_MAX_MS,
  PUNCHLINE_CLIP_MIN_MS,
} from "../modules/punchline/punchline-clip.config";

const TEST_PREFIX = `punchline_elig_${Date.now()}_`;

const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;

// One release + track + stem per scenario.
const ELIGIBLE = `${TEST_PREFIX}eligible`;
const QUARANTINED = `${TEST_PREFIX}quarantined`;
const REMOVED = `${TEST_PREFIX}removed`;
const NO_VOCALS = `${TEST_PREFIX}no_vocals`;
const UNPUBLISHED = `${TEST_PREFIX}unpublished`;
const LOW_TRUST = `${TEST_PREFIX}low_trust`;

async function seedCase(input: {
  key: string;
  releaseStatus: string;
  contentStatus: string;
  rightsRoute: string;
  withVocalsStem: boolean;
}) {
  await prisma.release.create({
    data: {
      id: `${input.key}_release`,
      artistId: ARTIST_ID,
      title: `${input.key} release`,
      status: input.releaseStatus,
      rightsRoute: input.rightsRoute,
    },
  });
  await prisma.track.create({
    data: {
      id: `${input.key}_track`,
      releaseId: `${input.key}_release`,
      title: `${input.key} track`,
      position: 1,
      processingStatus: "complete",
      contentStatus: input.contentStatus,
      rightsRoute: input.rightsRoute,
    },
  });
  if (input.withVocalsStem) {
    await prisma.stem.create({
      data: {
        id: `${input.key}_stem`,
        trackId: `${input.key}_track`,
        type: "vocals",
        uri: `local://${input.key}-vocals`,
      },
    });
  } else {
    // A non-vocals stem so the track has stems but no usable vocal source.
    await prisma.stem.create({
      data: {
        id: `${input.key}_stem`,
        trackId: `${input.key}_track`,
        type: "drums",
        uri: `local://${input.key}-drums`,
      },
    });
  }
}

describe("Punchline eligibility (integration)", () => {
  let service: PunchlineEligibilityService;

  beforeAll(async () => {
    service = new PunchlineEligibilityService();

    await prisma.user.create({
      data: { id: USER_ID, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: USER_ID,
        displayName: "Punchline Eligibility Artist",
      },
    });

    await seedCase({
      key: ELIGIBLE,
      releaseStatus: "ready",
      contentStatus: "clean",
      rightsRoute: "STANDARD_ESCROW",
      withVocalsStem: true,
    });
    await seedCase({
      key: QUARANTINED,
      releaseStatus: "ready",
      contentStatus: "quarantined",
      rightsRoute: "STANDARD_ESCROW",
      withVocalsStem: true,
    });
    await seedCase({
      key: REMOVED,
      releaseStatus: "ready",
      contentStatus: "dmca_removed",
      rightsRoute: "STANDARD_ESCROW",
      withVocalsStem: true,
    });
    await seedCase({
      key: NO_VOCALS,
      releaseStatus: "ready",
      contentStatus: "clean",
      rightsRoute: "STANDARD_ESCROW",
      withVocalsStem: false,
    });
    await seedCase({
      key: UNPUBLISHED,
      releaseStatus: "processing",
      contentStatus: "clean",
      rightsRoute: "STANDARD_ESCROW",
      withVocalsStem: true,
    });
    await seedCase({
      key: LOW_TRUST,
      releaseStatus: "ready",
      contentStatus: "clean",
      rightsRoute: "LIMITED_MONITORING",
      withVocalsStem: true,
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
  });

  const codesOf = (r: { reasons: { code: string }[] }) =>
    r.reasons.map((reason) => reason.code);

  it("(a) allows a clean, published, vocals-stem track on an allowed route", async () => {
    const result = await service.checkEligibility(`${ELIGIBLE}_track`);

    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.rightsLabel).toBe(PUNCHLINE_RIGHTS_LABEL);
    expect(result.rightsSummary).toBe(PUNCHLINE_RIGHTS_SUMMARY);
    // The server hands the client its clip bounds so the selection UI never
    // hardcodes them; defaults are the built-in min/max.
    expect(result.clipBoundsMs).toEqual({
      minMs: PUNCHLINE_CLIP_MIN_MS,
      maxMs: PUNCHLINE_CLIP_MAX_MS,
    });
    expect(result.track).toMatchObject({
      id: `${ELIGIBLE}_track`,
      releaseStatus: "ready",
      contentStatus: "clean",
      hasVocalsStem: true,
    });
  });

  it("(b) denies a quarantined track with content_quarantined", async () => {
    const result = await service.checkEligibility(`${QUARANTINED}_track`);

    expect(result.eligible).toBe(false);
    expect(codesOf(result)).toContain("content_quarantined");
    expect(codesOf(result)).not.toContain("content_removed");
    // Always surfaces the rights posture even on denial.
    expect(result.rightsLabel).toBe(PUNCHLINE_RIGHTS_LABEL);
  });

  it("(c) denies a dmca_removed track with content_removed", async () => {
    const result = await service.checkEligibility(`${REMOVED}_track`);

    expect(result.eligible).toBe(false);
    expect(codesOf(result)).toContain("content_removed");
  });

  it("(d) denies a track with no vocals stem with no_vocals_stem", async () => {
    const result = await service.checkEligibility(`${NO_VOCALS}_track`);

    expect(result.eligible).toBe(false);
    expect(codesOf(result)).toContain("no_vocals_stem");
    expect(result.track?.hasVocalsStem).toBe(false);
  });

  it("(e) denies an unpublished release with track_not_published", async () => {
    const result = await service.checkEligibility(`${UNPUBLISHED}_track`);

    expect(result.eligible).toBe(false);
    expect(codesOf(result)).toContain("track_not_published");
  });

  it("(f) denies a low-trust rights route with rights_not_allowed", async () => {
    const result = await service.checkEligibility(`${LOW_TRUST}_track`);

    expect(result.eligible).toBe(false);
    expect(codesOf(result)).toContain("rights_not_allowed");
  });

  it("(g) reports track_not_found for a missing track and omits the snapshot", async () => {
    const result = await service.checkEligibility(`${TEST_PREFIX}missing`);

    expect(result.eligible).toBe(false);
    expect(codesOf(result)).toEqual(["track_not_found"]);
    expect(result.track).toBeUndefined();
    expect(result.rightsLabel).toBe(PUNCHLINE_RIGHTS_LABEL);
    // Bounds are surfaced even on denial so the UI can explain the range rule.
    expect(result.clipBoundsMs).toEqual({
      minMs: PUNCHLINE_CLIP_MIN_MS,
      maxMs: PUNCHLINE_CLIP_MAX_MS,
    });
  });
});
