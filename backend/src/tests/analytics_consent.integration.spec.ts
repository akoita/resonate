import { prisma } from "../db/prisma";
import {
  ANALYTICS_CONSENT_POLICY_VERSION,
  AnalyticsConsentService,
} from "../modules/analytics/analytics_consent.service";

const TEST_PREFIX = `analytics_consent_${Date.now()}_`;
const USER_A = `${TEST_PREFIX}user_a`;
const USER_B = `${TEST_PREFIX}user_b`;

describe("AnalyticsConsentService integration", () => {
  const service = new AnalyticsConsentService();

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: USER_A, email: `${USER_A}@test.resonate` },
        { id: USER_B, email: `${USER_B}@test.resonate` },
      ],
    });
  });

  afterAll(async () => {
    await prisma.analyticsConsent
      .deleteMany({ where: { userId: { in: [USER_A, USER_B] } } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: [USER_A, USER_B] } } });
  });

  it("treats a missing decision as refusal, not as permission", async () => {
    const decision = await service.getDecision(USER_A);

    expect(decision).toEqual({ productAnalytics: false, decided: false, needsDecision: true });
    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(false);
  });

  it("opens the gate only for a decision given against the current consent text", async () => {
    await service.record(USER_A, true);

    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(true);
    await expect(service.getDecision(USER_A)).resolves.toMatchObject({
      productAnalytics: true,
      decided: true,
      needsDecision: false,
    });
  });

  it("closes the gate for a grant recorded against superseded consent text", async () => {
    // A row left behind by an earlier version of the consent copy. Consent
    // covers the processing that was described when it was given, so this
    // `productAnalytics: true` does not authorize collection under the new text.
    await prisma.analyticsConsent.create({
      data: {
        userId: USER_A,
        productAnalytics: true,
        policyVersion: "analytics-consent:2025-01-01",
        decidedAt: new Date("2025-01-02T00:00:00.000Z"),
      },
    });

    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(false);
    await expect(service.getDecision(USER_A)).resolves.toMatchObject({
      productAnalytics: true,
      decided: true,
      needsDecision: true,
      policyVersion: "analytics-consent:2025-01-01",
    });

    // Deciding again under the current text restores the gate.
    await service.record(USER_A, true);
    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(true);
    await expect(service.getDecision(USER_A)).resolves.toMatchObject({ needsDecision: false });
  });

  it("does not ask again after a refusal given against the current text", async () => {
    await service.record(USER_A, false);

    const decision = await service.getDecision(USER_A);

    // Someone who said no has decided. Re-prompting them on the next page load
    // is nagging, which undermines the validity of the refusal itself.
    expect(decision).toMatchObject({
      productAnalytics: false,
      decided: true,
      needsDecision: false,
      policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
    });
    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(false);
  });

  it("asks again after a refusal given against superseded text", async () => {
    await prisma.analyticsConsent.create({
      data: {
        userId: USER_A,
        productAnalytics: false,
        policyVersion: "analytics-consent:2025-01-01",
        decidedAt: new Date("2025-01-02T00:00:00.000Z"),
      },
    });

    await expect(service.getDecision(USER_A)).resolves.toMatchObject({ needsDecision: true });
    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(false);
  });

  it("opens and closes the gate as the person decides, and moves decidedAt each time", async () => {
    const granted = await service.record(USER_A, true);

    expect(granted.productAnalytics).toBe(true);
    expect(granted.decided).toBe(true);
    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(true);

    const refused = await service.record(USER_A, false);

    expect(refused.productAnalytics).toBe(false);
    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(false);
    expect(refused.decidedAt!.getTime()).toBeGreaterThanOrEqual(granted.decidedAt!.getTime());
    expect(refused.decidedAt!.getTime()).not.toBe(0);

    const reAffirmed = await service.record(USER_A, false);
    expect(reAffirmed.decidedAt!.getTime()).toBeGreaterThanOrEqual(refused.decidedAt!.getTime());

    const stored = await prisma.analyticsConsent.findMany({ where: { userId: USER_A } });
    expect(stored).toHaveLength(1);
  });

  it("stores and round-trips the server's policy version, never a caller's", async () => {
    const recorded = await service.record(USER_A, true);

    expect(recorded.policyVersion).toBe(ANALYTICS_CONSENT_POLICY_VERSION);
    await expect(service.getDecision(USER_A)).resolves.toMatchObject({
      productAnalytics: true,
      decided: true,
      policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
    });

    // The record is the evidence that consent was informed, so the version it
    // carries is the one the server serves — the write path has no parameter a
    // caller could use to claim otherwise.
    const stored = await prisma.analyticsConsent.findUnique({ where: { userId: USER_A } });
    expect(stored?.policyVersion).toBe(ANALYTICS_CONSENT_POLICY_VERSION);
  });

  it("refuses for an unknown, empty, or absent user id", async () => {
    await expect(service.isProductAnalyticsAllowed(`${TEST_PREFIX}never_seen`)).resolves.toBe(false);
    await expect(service.isProductAnalyticsAllowed("")).resolves.toBe(false);
    await expect(service.isProductAnalyticsAllowed("   ")).resolves.toBe(false);
    await expect(service.isProductAnalyticsAllowed(undefined)).resolves.toBe(false);
    await expect(service.isProductAnalyticsAllowed(null)).resolves.toBe(false);
    await expect(service.getDecision("")).resolves.toEqual({
      productAnalytics: false,
      decided: false,
      needsDecision: true,
    });
  });

  it("keeps one person's decision out of another person's gate", async () => {
    await service.record(USER_A, true);

    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(true);
    await expect(service.isProductAnalyticsAllowed(USER_B)).resolves.toBe(false);
    await expect(service.getDecision(USER_B)).resolves.toEqual({
      productAnalytics: false,
      decided: false,
      needsDecision: true,
    });

    await service.record(USER_B, false);

    await expect(service.isProductAnalyticsAllowed(USER_A)).resolves.toBe(true);
    await expect(service.isProductAnalyticsAllowed(USER_B)).resolves.toBe(false);
  });

  it("removes the decision with the person when the account is deleted", async () => {
    const userId = `${TEST_PREFIX}user_cascade`;
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    await service.record(userId, true);

    await prisma.user.delete({ where: { id: userId } });

    await expect(prisma.analyticsConsent.findUnique({ where: { userId } })).resolves.toBeNull();
  });
});
