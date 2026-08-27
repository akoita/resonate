/**
 * #1663 strict-cutover source-reference scan against real Postgres metadata,
 * text, and JSONB columns. The scanner is read-only and never retains values.
 */

import { createHash } from "crypto";
import { prisma } from "../db/prisma";
import { scanForbiddenReference } from "../scripts/verify_migration";

const TEST_PREFIX = `verifycutover_${Date.now()}_`;
const userEmail = `${TEST_PREFIX}source-project@example.com`;
const eventId = `${TEST_PREFIX}event`;
const sourceProject = `${TEST_PREFIX}project-marker`;
const sourceBucket = `${TEST_PREFIX}bucket-marker`;

describe("strict cutover forbidden-reference scan (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { email: `${sourceProject}.${userEmail}` },
    });
    await prisma.analyticsEvent.create({
      data: {
        eventId,
        eventName: "migration.scan_fixture",
        eventVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        producer: "integration-test",
        environment: "test",
        privacyTier: "internal",
        payload: { storageUri: `gs://${sourceBucket}/fixture` },
        envelope: { eventId, fixture: true },
      },
    });
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventId } });
    await prisma.user.deleteMany({ where: { email: `${sourceProject}.${userEmail}` } });
  });

  it("reports count-only text and JSONB locations with a value digest", async () => {
    const projectEvidence = await scanForbiddenReference({
      label: "source-project",
      value: sourceProject,
    });
    const bucketEvidence = await scanForbiddenReference({
      label: "source-bucket",
      value: sourceBucket,
    });

    expect(projectEvidence.valueSha256).toBe(
      createHash("sha256").update(sourceProject).digest("hex"),
    );
    expect(projectEvidence.totalMatches).toBeGreaterThanOrEqual(1);
    expect(projectEvidence.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "User", column: "email", count: 1 }),
      ]),
    );
    expect(bucketEvidence.totalMatches).toBeGreaterThanOrEqual(1);
    expect(bucketEvidence.locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "AnalyticsEvent", column: "payload", count: 1 }),
      ]),
    );

    const retained = JSON.stringify([projectEvidence, bucketEvidence]);
    expect(retained).not.toContain(sourceProject);
    expect(retained).not.toContain(sourceBucket);
  });
});
