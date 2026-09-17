import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * #1772: the canonical version of the consent text the product currently ships.
 *
 * This lives in code, not configuration: it versions the wording a person is
 * shown, so it changes in the same commit that changes that wording. Bump it
 * whenever the analytics consent copy changes materially, so previously
 * recorded decisions read as agreements to the older text instead of being
 * silently re-attributed to the new one.
 *
 * The server always stores this value. A client never gets to say what a person
 * agreed to: the stored version is the evidence that consent was informed, and
 * a stale browser recording a newer version while displaying older text would
 * destroy exactly that evidence.
 *
 * A decision is scoped to the version it was given against: consent covers the
 * processing that was described when it was given, so a decision recorded
 * against superseded text does not open the gate. `isProductAnalyticsAllowed`
 * enforces that.
 *
 * BUMP THIS ONLY FOR A MATERIAL CHANGE. A typo fix or a reworded sentence must
 * not bump it. Every bump closes the gate for everyone until they decide again,
 * and re-asking people about nothing trains them to click through — which
 * degrades the quality of every consent that follows. That tradeoff is the
 * whole reason the version exists: it must mean "what we do with your data
 * changed", never "we edited the copy".
 */
export const ANALYTICS_CONSENT_POLICY_VERSION = "analytics-consent:2026-09-17";

export interface AnalyticsConsentDecision {
  productAnalytics: boolean;
  decided: boolean;
  /**
   * True when the person must be asked: either nothing has been recorded, or
   * their decision was given against superseded consent text. Computed here so
   * every client renders the same three states instead of re-deriving them from
   * a version-string comparison and drifting.
   *
   * A recorded refusal against the current version is NOT `needsDecision`.
   * Someone who said no has decided, and re-prompting them on the next page
   * load is nagging, which undermines the validity of the refusal itself.
   */
  needsDecision: boolean;
  policyVersion?: string;
  decidedAt?: Date;
}

const UNDECIDED: AnalyticsConsentDecision = {
  productAnalytics: false,
  decided: false,
  needsDecision: true,
};

/**
 * #1772: server-side consent gate for client-emitted product telemetry.
 *
 * The boundary is the ingest surface, not the event name: everything a browser
 * posts to the three authenticated telemetry routes is optional analytics and
 * is gated here. Server-emitted domain records (commerce, rights, contract,
 * generation) are records of something that happened, run under
 * performance-of-contract or legal obligation, and are not gated.
 */
@Injectable()
export class AnalyticsConsentService {
  async getDecision(userId: string): Promise<AnalyticsConsentDecision> {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      return { ...UNDECIDED };
    }

    const record = await prisma.analyticsConsent.findUnique({
      where: { userId: normalizedUserId },
      select: { productAnalytics: true, policyVersion: true, decidedAt: true },
    });

    if (!record) {
      return { ...UNDECIDED };
    }

    return {
      productAnalytics: record.productAnalytics,
      decided: true,
      needsDecision: record.policyVersion !== ANALYTICS_CONSENT_POLICY_VERSION,
      policyVersion: record.policyVersion,
      decidedAt: record.decidedAt,
    };
  }

  /**
   * Record an explicit decision. `decidedAt` moves on every decision, including
   * a re-affirmation of the same answer, because the timestamp is evidence of
   * when the person last chose — not of when the value last changed.
   *
   * The stored `policyVersion` is always the server's constant. There is
   * deliberately no parameter for it: the caller cannot record a decision
   * against a version the server is not currently serving.
   */
  async record(userId: string, productAnalytics: boolean): Promise<AnalyticsConsentDecision> {
    const decidedAt = new Date();
    const policyVersion = ANALYTICS_CONSENT_POLICY_VERSION;
    const record = await prisma.analyticsConsent.upsert({
      where: { userId },
      create: { userId, productAnalytics, policyVersion, decidedAt },
      update: { productAnalytics, policyVersion, decidedAt },
      select: { productAnalytics: true, policyVersion: true, decidedAt: true },
    });

    return {
      productAnalytics: record.productAnalytics,
      decided: true,
      needsDecision: false,
      policyVersion: record.policyVersion,
      decidedAt: record.decidedAt,
    };
  }

  /**
   * The gate.
   *
   * NO RECORDED DECISION MEANS FALSE. Do not "fix" this to default to true.
   * GDPR Article 7 requires a clear affirmative act, so silence is refusal, not
   * permission: a user who has never been asked has not consented, and a user
   * whose row is missing for any other reason has not consented either.
   *
   * An absent or empty userId is also false — unauthenticated telemetry has no
   * recorded consent to rely on.
   *
   * A decision given against superseded consent text is also false. Consent
   * covers the processing that was described when it was given; once that
   * description materially changed, collecting on the old agreement would be
   * relying on agreement to something else. That is why the stored
   * `policyVersion` is read here and not merely recorded.
   */
  async isProductAnalyticsAllowed(userId?: string | null): Promise<boolean> {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      return false;
    }

    const decision = await this.getDecision(normalizedUserId);
    return (
      decision.decided &&
      decision.productAnalytics &&
      decision.policyVersion === ANALYTICS_CONSENT_POLICY_VERSION
    );
  }
}

function normalizeUserId(userId?: string | null) {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  return normalized || undefined;
}
