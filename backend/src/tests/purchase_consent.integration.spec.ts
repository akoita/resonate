/**
 * Immediate-delivery consent for consumer digital purchases (#1776) against real
 * Postgres: the consent record and its confirmation notice, linking, the
 * server-enforced delivery checkpoint (download, remix licence), the mint
 * requirement, and the machine-to-machine path staying outside the gate.
 */
import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { EncryptionController } from "../modules/encryption/encryption.controller";
import { NoticeService } from "../modules/notifications/notice.service";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import {
  CONSENT_TEXT_VERSION,
  PURCHASE_CONSENT_EFFECTIVE_AT,
  WITHDRAWAL_PERIOD_MS,
} from "../modules/purchase_consent/purchase_consent.constants";
import { requireMintConsent } from "../modules/purchase_consent/purchase_consent_delivery";
import { afterConsentCutover } from "./purchase_consent_clock";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `pconsent_${Date.now()}_`;
const BUYER = `${P}buyer`;
const OTHER = `${P}other`;
const ARTIST_USER = `${P}artist_user`;
const ARTIST = `${P}artist`;
const RELEASE = `${P}release`;
const TRACK = `${P}track`;
const STEM_NOW = `${P}stem_now`; // bought just now, no consent
const STEM_CONSENT = `${P}stem_consent`; // bought just now, consent recorded
const STEM_WAIT = `${P}stem_wait`; // bought just now, buyer chose to wait
const STEM_OLD = `${P}stem_old`; // bought 20 days ago, no consent
const STEM_LEGACY = `${P}stem_legacy`; // bought just before the consent step existed, no consent
const STEM_REMIX = `${P}stem_remix`; // remix licence bought just now, no consent
const WALLET = `0x${"ab".repeat(20)}`;
const DAY = 24 * 60 * 60 * 1000;
const hex = (label: string) => `0x${createHash("sha256").update(`${P}${label}`).digest("hex")}`;

const notices = new NoticeService(new EventBus(), new AuditService());
const consents = new PurchaseConsentService(notices);

function body(overrides: Record<string, unknown> = {}) {
  return {
    surface: "stem_purchase",
    subjectId: STEM_CONSENT,
    consented: true,
    acknowledgedWaiver: true,
    textVersion: CONSENT_TEXT_VERSION,
    ...overrides,
  } as never;
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    send(data: unknown) {
      res.body = data;
      return res;
    },
    set() {
      return res;
    },
  };
  return res;
}

async function seedPurchase(stemId: string, purchasedAt: Date, licenseType: "personal" | "remix" = "personal", n = 0) {
  await prisma.stem.create({
    data: { id: stemId, trackId: TRACK, type: "vocals", uri: `local://${stemId}.mp3`, isCurrent: true },
  });
  const listing = await prisma.stemListing.create({
    data: {
      listingId: BigInt(Date.now() + n),
      stemId,
      tokenId: BigInt(n + 1),
      chainId: 31337,
      contractAddress: `0x${"cd".repeat(20)}`,
      sellerAddress: `0x${"ef".repeat(20)}`,
      pricePerUnit: "1000000",
      amount: 5n,
      paymentToken: `0x${"00".repeat(20)}`,
      expiresAt: new Date(Date.now() + 7 * DAY),
      transactionHash: hex(`list_${stemId}`),
      blockNumber: 1n,
      licenseType,
      status: "active",
      listedAt: new Date(),
    },
  });
  await prisma.stemPurchase.create({
    data: {
      listingId: listing.id,
      buyerAddress: WALLET,
      amount: 1n,
      totalPaid: "1000000",
      royaltyPaid: "50000",
      protocolFeePaid: "100000",
      sellerReceived: "850000",
      licenseType,
      transactionHash: hex(`buy_${stemId}`),
      logIndex: 0,
      blockNumber: 2n,
      purchasedAt,
    },
  });
}

describe("purchase consent (#1776, integration)", () => {
  const encryption = {
    providerName: "aes",
    decrypt: jest.fn(),
    loadSourceBuffer: jest.fn(async () => Buffer.from("audio")),
  };
  const auth = { isAddressForUser: jest.fn(async () => true) };
  const controller = new EncryptionController(encryption as never, auth as never);
  const remix = new RemixEligibilityService();

  beforeAll(async () => {
    for (const id of [BUYER, OTHER, ARTIST_USER]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.wallet.create({ data: { userId: BUYER, address: WALLET, chainId: 31337 } });
    await prisma.artist.create({ data: { id: ARTIST, userId: ARTIST_USER, displayName: "Consent Artist" } });
    await prisma.release.create({ data: { id: RELEASE, artistId: ARTIST, title: "Consent Release", status: "ready" } });
    await prisma.track.create({ data: { id: TRACK, releaseId: RELEASE, title: "Consent Track", position: 1 } });
    // After the cutover, so the consent step applies (earlier purchases are grandfathered).
    const now = afterConsentCutover();
    await seedPurchase(STEM_LEGACY, new Date(PURCHASE_CONSENT_EFFECTIVE_AT.getTime() - 3_600_000), "personal", 6);
    await seedPurchase(STEM_NOW, now, "personal", 1);
    await seedPurchase(STEM_CONSENT, now, "personal", 2);
    await seedPurchase(STEM_WAIT, now, "personal", 3);
    await seedPurchase(STEM_OLD, new Date(Date.now() - 20 * DAY), "personal", 4);
    await seedPurchase(STEM_REMIX, now, "remix", 5);
  });

  afterAll(async () => {
    await prisma.notice.deleteMany({ where: { recipientUserId: { startsWith: P } } });
    await prisma.purchaseConsent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.stemPurchase.deleteMany({ where: { listing: { stemId: { startsWith: P } } } });
    await prisma.stemListing.deleteMany({ where: { stemId: { startsWith: P } } });
    await prisma.stem.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.track.deleteMany({ where: { id: TRACK } });
    await prisma.release.deleteMany({ where: { id: RELEASE } });
    await prisma.artist.deleteMany({ where: { id: ARTIST } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  });

  async function download(stemId: string) {
    const res = fakeRes();
    await controller.download({ stemId, walletAddress: WALLET }, { user: { userId: BUYER } }, res);
    return res;
  }

  describe("recording", () => {
    it("records a deliver-now consent and writes the confirmation notice", async () => {
      const view = await consents.record(BUYER, body({ licenseType: "personal" }));
      expect(view).toMatchObject({
        surface: "stem_purchase",
        subjectId: STEM_CONSENT,
        consented: true,
        acknowledgedWaiver: true,
        textVersion: CONSENT_TEXT_VERSION,
        deliveryAvailableAt: null,
      });
      expect(view.subjectLabel).toContain("Personal licence");

      const notice = await prisma.notice.findFirst({
        where: { recipientUserId: BUYER, dedupeKey: `purchase-consent:${view.id}` },
      });
      expect(notice).toMatchObject({ category: "purchase", audience: "user" });
      expect(notice!.body).toContain(view.subjectLabel);
      expect(notice!.body).toContain("lose your right to withdraw");
      expect(notice!.body).toContain(CONSENT_TEXT_VERSION);
    });

    it("records a wait choice with an indicative release date and says so in the notice", async () => {
      const before = Date.now();
      const view = await consents.record(
        BUYER,
        body({ subjectId: STEM_WAIT, consented: false, acknowledgedWaiver: false }),
      );
      expect(view.consented).toBe(false);
      expect(Date.parse(view.deliveryAvailableAt!)).toBeGreaterThanOrEqual(before + WITHDRAWAL_PERIOD_MS - 1000);
      const notice = await prisma.notice.findFirst({ where: { dedupeKey: `purchase-consent:${view.id}` } });
      expect(notice!.title).toContain("on hold");
    });

    it("refuses consent without the explicit acknowledgement, and an acknowledgement without consent", async () => {
      await expect(consents.record(BUYER, body({ acknowledgedWaiver: false }))).rejects.toMatchObject({
        response: { code: "waiver_acknowledgement_required" },
      });
      await expect(
        consents.record(BUYER, body({ consented: false, acknowledgedWaiver: true })),
      ).rejects.toMatchObject({ response: { code: "waiver_without_consent" } });
    });

    it("refuses outdated wording, unknown items and a mint that waits", async () => {
      await expect(consents.record(BUYER, body({ textVersion: "old" }))).rejects.toBeInstanceOf(ConflictException);
      await expect(consents.record(BUYER, body({ subjectId: `${P}missing` }))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        consents.record(
          BUYER,
          body({ surface: "collectible_mint", subjectId: "m", consented: false, acknowledgedWaiver: false }),
        ),
      ).rejects.toMatchObject({ response: { code: "consent_required_for_mint" } });
      await expect(
        consents.record(BUYER, body({ surface: "credit_topup", subjectId: "pack-10" })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts a credit top-up consent with a named label (reusable record)", async () => {
      const view = await consents.record(
        BUYER,
        body({ surface: "credit_topup", subjectId: "pack-10", subjectLabel: "10 generation credits" }),
      );
      expect(view.subjectLabel).toBe("10 generation credits");
    });
  });

  describe("linking", () => {
    it("links the payment once, idempotently, only for the owner", async () => {
      const row = await consents.record(BUYER, body({ subjectId: STEM_WAIT, consented: false, acknowledgedWaiver: false }));
      const tx = hex("pay1");
      const linked = await consents.link(BUYER, row.id, { transactionHash: tx.toUpperCase().replace("0X", "0x") } as never);
      expect(linked.transactionHash).toBe(tx.toLowerCase());
      expect(Date.parse(linked.deliveryAvailableAt!)).toBeGreaterThan(Date.now() + 13 * DAY);
      await expect(consents.link(BUYER, row.id, { transactionHash: tx } as never)).resolves.toMatchObject({
        transactionHash: tx.toLowerCase(),
      });
      await expect(consents.link(BUYER, row.id, { transactionHash: hex("pay2") } as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(consents.link(OTHER, row.id, { transactionHash: tx } as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(consents.link(BUYER, row.id, {} as never)).rejects.toBeInstanceOf(BadRequestException);
    });

    it("lists only the caller's records", async () => {
      expect((await consents.listForUser(BUYER)).items.length).toBeGreaterThan(0);
      expect((await consents.listForUser(OTHER)).items).toEqual([]);
    });
  });

  describe("delivery checkpoint", () => {
    it("refuses the download of a fresh purchase with no consent, and tells the buyer when", async () => {
      const res = await download(STEM_NOW);
      expect(res.statusCode).toBe(403);
      expect(res.body).toMatchObject({ code: "delivery_held" });
      expect(Date.parse((res.body as any).deliveryAvailableAt)).toBeGreaterThan(Date.now() + 13 * DAY);
      expect(encryption.loadSourceBuffer).not.toHaveBeenCalled();
    });

    it("refuses the download when the buyer chose to wait", async () => {
      const res = await download(STEM_WAIT);
      expect(res.statusCode).toBe(403);
      expect((res.body as any).code).toBe("delivery_held");
    });

    it("allows the download after the buyer consented to immediate delivery", async () => {
      const res = await download(STEM_CONSENT);
      expect(res.statusCode).toBe(200);
      expect(encryption.loadSourceBuffer).toHaveBeenCalled();
    });

    it("allows the download once the withdrawal period has elapsed, with no consent at all", async () => {
      const res = await download(STEM_OLD);
      expect(res.statusCode).toBe(200);
    });

    it("delivers a purchase made before the consent step existed, with no consent", async () => {
      const res = await download(STEM_LEGACY);
      expect(res.statusCode).toBe(200);
    });

    it("lets a later deliver-now consent release a held purchase", async () => {
      expect((await download(STEM_NOW)).statusCode).toBe(403);
      await consents.record(BUYER, body({ subjectId: STEM_NOW }));
      expect((await download(STEM_NOW)).statusCode).toBe(200);
    });

    it("does not activate a remix licence while its purchase is held, and does after consent", async () => {
      const licensed = () => (remix as any).findLicensedStemIds(BUYER, [STEM_REMIX]) as Promise<Set<string>>;
      expect((await licensed()).has(STEM_REMIX)).toBe(false);
      await consents.record(BUYER, body({ subjectId: STEM_REMIX, licenseType: "remix" }));
      expect((await licensed()).has(STEM_REMIX)).toBe(true);
    });
  });

  describe("mint authorization", () => {
    it("refuses a mint without a fresh consent and allows it with one", async () => {
      const moment = `${P}moment`;
      await expect(requireMintConsent(BUYER, "collectible_mint", moment)).rejects.toBeInstanceOf(ForbiddenException);
      await prisma.purchaseConsent.create({
        data: {
          userId: BUYER,
          surface: "collectible_mint",
          subjectId: moment,
          subjectLabel: "Collectible: test",
          deliveryKind: "on_chain_mint",
          consented: true,
          acknowledgedWaiver: true,
          textVersion: CONSENT_TEXT_VERSION,
        },
      });
      await expect(requireMintConsent(BUYER, "collectible_mint", moment)).resolves.toHaveProperty("consentId");
      // Not another person's, and not for a surface that is not a mint.
      await expect(requireMintConsent(OTHER, "collectible_mint", moment)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(requireMintConsent(BUYER, "stem_purchase", moment)).rejects.toThrow();
    });
  });
});
