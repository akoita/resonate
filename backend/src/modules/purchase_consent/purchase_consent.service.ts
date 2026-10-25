import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { PurchaseConsent } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NoticeService } from "../notifications/notice.service";
import {
  PURCHASE_CONSENT_NOTICE_ACTOR,
  PURCHASE_CONSENT_NOTICE_CATEGORY,
  PURCHASE_CONSENT_SURFACES,
  PURCHASE_CONSENT_WORDING,
  SUBSCRIPTION_CONSENT_WORDING,
  WITHDRAWAL_PERIOD_DAYS,
  WITHDRAWAL_PERIOD_MS,
  isPurchaseConsentSurface,
  type PurchaseConsentSurface,
} from "./purchase_consent.constants";
import type { LinkPurchaseConsentDto, RecordPurchaseConsentDto } from "./purchase_consent.dto";

/** Where every confirmation notice leads. */
export const PURCHASE_CONSENT_HELP_PATH = "/help/immediate-delivery-and-withdrawal";
const LIST_LIMIT = 100;

export type PurchaseConsentView = {
  id: string;
  surface: string;
  subjectId: string;
  subjectLabel: string;
  licenseType: string | null;
  consented: boolean;
  acknowledgedWaiver: boolean;
  textVersion: string;
  transactionHash: string | null;
  purchaseRef: string | null;
  deliveryAvailableAt: string | null;
  createdAt: string;
};

export function toPurchaseConsentView(row: PurchaseConsent): PurchaseConsentView {
  return {
    id: row.id,
    surface: row.surface,
    subjectId: row.subjectId,
    subjectLabel: row.subjectLabel,
    licenseType: row.licenseType,
    consented: row.consented,
    acknowledgedWaiver: row.acknowledgedWaiver,
    textVersion: row.textVersion,
    transactionHash: row.transactionHash,
    purchaseRef: row.purchaseRef,
    deliveryAvailableAt: row.deliveryAvailableAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * Records the buyer's delivery choice at checkout (#1776), confirms it on a
 * durable medium, and links it to the payment afterwards. Reading delivery
 * decisions lives in `purchase_consent_delivery.ts`.
 */
@Injectable()
export class PurchaseConsentService {
  private readonly logger = new Logger(PurchaseConsentService.name);

  constructor(private readonly notices: NoticeService) {}

  wording() {
    return PURCHASE_CONSENT_WORDING;
  }

  async record(userId: string, input: RecordPurchaseConsentDto): Promise<PurchaseConsentView> {
    if (!isPurchaseConsentSurface(input.surface)) {
      throw new BadRequestException({ code: "invalid_surface", message: "Unknown purchase surface." });
    }
    const surface = input.surface;
    if (surface === "subscription") {
      // Recorded by the subscription checkout itself, with its own wording.
      throw new BadRequestException({
        code: "use_subscription_checkout",
        message: "A subscription consent is recorded when you start the subscription checkout.",
      });
    }
    const rules = PURCHASE_CONSENT_SURFACES[surface];

    if (input.textVersion !== PURCHASE_CONSENT_WORDING.version) {
      throw new ConflictException({
        code: "consent_text_outdated",
        message: "The delivery wording changed. Reload it and confirm your choice again.",
        currentVersion: PURCHASE_CONSENT_WORDING.version,
      });
    }
    if (input.consented && !input.acknowledgedWaiver) {
      throw new BadRequestException({
        code: "waiver_acknowledgement_required",
        message: "Immediate delivery needs your explicit acknowledgement that you lose your right to withdraw.",
      });
    }
    if (!input.consented && input.acknowledgedWaiver) {
      throw new BadRequestException({
        code: "waiver_without_consent",
        message: "An acknowledgement of the waiver only goes with a request for immediate delivery.",
      });
    }
    if (!input.consented && !rules.holdAllowed) {
      throw new BadRequestException({
        code: "consent_required_for_mint",
        message: "This is recorded on a blockchain and cannot be undone, so it can only be bought with immediate delivery.",
      });
    }

    const subjectId = input.subjectId.trim();
    if (!subjectId) {
      throw new BadRequestException({ code: "invalid_subject", message: "subjectId is required." });
    }
    const subjectLabel = await this.resolveSubjectLabel(surface, subjectId, input);
    const now = new Date();

    const row = await prisma.purchaseConsent.create({
      data: {
        userId,
        surface,
        subjectId,
        subjectLabel,
        licenseType: input.licenseType ?? null,
        deliveryKind: rules.deliveryKind,
        consented: input.consented,
        acknowledgedWaiver: input.acknowledgedWaiver,
        textVersion: input.textVersion,
        // Indicative until the consent is linked to the payment: the real date
        // is 14 days after the purchase, which has not happened yet.
        deliveryAvailableAt: input.consented ? null : new Date(now.getTime() + WITHDRAWAL_PERIOD_MS),
      },
    });

    await this.confirm(userId, row);
    return toPurchaseConsentView(row);
  }

  /**
   * The immediate-start consent of an Artist Pro subscription (#2407), recorded
   * by the subscription checkout BEFORE the Stripe Checkout Session exists. The
   * caller has already checked that the person ticked the acknowledgement and
   * saw the current wording. `consented` means "start now";
   * `acknowledgedWaiver` means the person acknowledged that withdrawing within
   * 14 days refunds only the unused time. There is no hold.
   */
  async recordSubscriptionStart(
    userId: string,
    input: { subjectId: string; subjectLabel: string },
  ): Promise<PurchaseConsentView> {
    const rules = PURCHASE_CONSENT_SURFACES.subscription;
    const row = await prisma.purchaseConsent.create({
      data: {
        userId,
        surface: "subscription",
        subjectId: input.subjectId,
        subjectLabel: input.subjectLabel.slice(0, 200),
        licenseType: null,
        deliveryKind: rules.deliveryKind,
        consented: true,
        acknowledgedWaiver: true,
        textVersion: SUBSCRIPTION_CONSENT_WORDING.version,
        deliveryAvailableAt: null,
      },
    });
    await this.confirm(userId, row);
    return toPurchaseConsentView(row);
  }

  /** Attach the payment to a consent once it is known. Idempotent; a different payment is a conflict. */
  async link(userId: string, id: string, input: LinkPurchaseConsentDto): Promise<PurchaseConsentView> {
    const transactionHash = input.transactionHash?.toLowerCase();
    const purchaseRef = input.purchaseRef?.trim();
    if (!transactionHash && !purchaseRef) {
      throw new BadRequestException({
        code: "nothing_to_link",
        message: "Provide a transactionHash or a purchaseRef.",
      });
    }
    // 404 for another person's record: never reveal that it exists.
    const row = await prisma.purchaseConsent.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException("Consent record not found.");

    if (
      (row.transactionHash && transactionHash && row.transactionHash !== transactionHash) ||
      (row.purchaseRef && purchaseRef && row.purchaseRef !== purchaseRef)
    ) {
      throw new ConflictException({
        code: "consent_already_linked",
        message: "This consent is already linked to a different payment.",
      });
    }

    const data: { transactionHash?: string; purchaseRef?: string; linkedAt?: Date; deliveryAvailableAt?: Date } = {};
    if (transactionHash && !row.transactionHash) data.transactionHash = transactionHash;
    if (purchaseRef && !row.purchaseRef) data.purchaseRef = purchaseRef;
    if (Object.keys(data).length === 0) return toPurchaseConsentView(row);
    const linkedAt = new Date();
    data.linkedAt = linkedAt;
    // A held delivery runs 14 days from the purchase, which is now known.
    if (!row.consented) data.deliveryAvailableAt = new Date(linkedAt.getTime() + WITHDRAWAL_PERIOD_MS);

    const updated = await prisma.purchaseConsent.update({ where: { id: row.id }, data });
    return toPurchaseConsentView(updated);
  }

  async listForUser(userId: string): Promise<{ items: PurchaseConsentView[] }> {
    const rows = await prisma.purchaseConsent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
    });
    return { items: rows.map(toPurchaseConsentView) };
  }

  // -------------------------------------------------------------------------

  private async resolveSubjectLabel(
    surface: PurchaseConsentSurface,
    subjectId: string,
    input: RecordPurchaseConsentDto,
  ): Promise<string> {
    if (surface === "stem_purchase") {
      const stem = await prisma.stem.findUnique({
        where: { id: subjectId },
        select: { title: true, type: true, track: { select: { title: true } } },
      });
      if (!stem) throw new NotFoundException({ code: "subject_not_found", message: "Stem not found." });
      const name = stem.title?.trim() || titleCase(stem.type);
      const track = stem.track?.title?.trim();
      const tier = input.licenseType ? ` (${titleCase(input.licenseType)} licence)` : "";
      return `${track && track !== name ? `${name} from ${track}` : name}${tier}`.slice(0, 200);
    }
    if (surface === "punchline_collect" || surface === "collectible_mint") {
      const moment = await prisma.punchlineMoment.findUnique({
        where: { id: subjectId },
        select: { title: true },
      });
      if (!moment) throw new NotFoundException({ code: "subject_not_found", message: "Moment not found." });
      return `Collectible: ${moment.title}`.slice(0, 200);
    }
    // credit_topup: no catalogue item; the checkout names what is being bought.
    const label = input.subjectLabel?.trim();
    if (!label) {
      throw new BadRequestException({ code: "subject_label_required", message: "subjectLabel is required for this purchase." });
    }
    return label.slice(0, 200);
  }

  /**
   * The durable confirmation (Directive 2011/83/EU art. 8(7)): a platform
   * notice in the person's inbox, emailed to a confirmed contact address
   * (category `purchase` is an email-required category). Failure never loses
   * the consent record, which the person can also read in the app.
   */
  private async confirm(userId: string, row: PurchaseConsent): Promise<void> {
    const when = row.createdAt.toISOString().replace("T", " ").slice(0, 16);
    const wording = `Wording version ${row.textVersion}.`;
    let title: string;
    let body: string;
    if (row.deliveryKind === "service") {
      title = "Subscription start confirmed";
      body =
        `On ${when} UTC you asked for "${row.subjectLabel}" to start straight away, before the ` +
        `${WITHDRAWAL_PERIOD_DAYS}-day withdrawal period ends, and you acknowledged that if you withdraw within ` +
        `those ${WITHDRAWAL_PERIOD_DAYS} days you are refunded only for the unused time, less the value of any ` +
        `monthly generation allowance you have already used. ${wording}`;
    } else if (row.deliveryKind === "on_chain_mint") {
      title = "Immediate delivery confirmed";
      body =
        `On ${when} UTC you asked us to mint "${row.subjectLabel}" for you right away and you acknowledged ` +
        `that, because delivery begins immediately, you lose your right to withdraw from this purchase. ${wording}`;
    } else if (row.consented) {
      title = "Immediate delivery confirmed";
      body =
        `On ${when} UTC you asked us to deliver "${row.subjectLabel}" as soon as your payment is confirmed, ` +
        `before the ${WITHDRAWAL_PERIOD_DAYS}-day withdrawal period ends, and you acknowledged that once delivery ` +
        `begins you lose your right to withdraw from this purchase. ${wording}`;
    } else {
      title = `Delivery on hold for ${WITHDRAWAL_PERIOD_DAYS} days`;
      body =
        `On ${when} UTC you chose to keep your right to withdraw from your purchase of "${row.subjectLabel}". ` +
        `Delivery is held until ${WITHDRAWAL_PERIOD_DAYS} days after the purchase and is then released to you ` +
        `automatically. You can ask for immediate delivery from your library at any time, which ends your right to withdraw. ${wording}`;
    }
    try {
      await this.notices.sendTargeted(
        {
          userIds: [userId],
          category: PURCHASE_CONSENT_NOTICE_CATEGORY,
          title,
          body,
          link: PURCHASE_CONSENT_HELP_PATH,
        },
        PURCHASE_CONSENT_NOTICE_ACTOR,
        { dedupeKey: `purchase-consent:${row.id}` },
      );
    } catch (error) {
      this.logger.error(
        `Could not write the consent confirmation notice for ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
