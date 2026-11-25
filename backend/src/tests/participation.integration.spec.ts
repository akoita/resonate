/**
 * Artist participation agreement and consent choices (#2666) — integration.
 *
 * First acceptance with the safe defaults, the upload gate, a choice change
 * from Settings (with its history row and the remix consent event), a new
 * agreement version that asks again, and production refusing the placeholder.
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../db/prisma";
import { ArtistService } from "../modules/artist/artist.service";
import {
  ParticipationService,
  assertParticipationAccepted,
} from "../modules/participation/participation.service";
import { hashAgreementText, loadParticipationAgreement } from "../modules/participation/participation_agreement";
import { SAFE_DEFAULT_CHOICES } from "../modules/participation/consent_choices";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `participation_${Date.now()}_`;
const OWNER = `${TEST_PREFIX}owner`;
const STRANGER = `${TEST_PREFIX}stranger`;
const ARTIST = `${TEST_PREFIX}artist`;

const ENV_KEYS = [
  "PARTICIPATION_AGREEMENT_FILE",
  "PARTICIPATION_AGREEMENT_VERSION",
  "PARTICIPATION_AGREEMENT_REQUIRED",
  "NODE_ENV",
] as const;

describe("participation agreement (integration)", () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let eventBus: EventBus;
  let publish: jest.SpyInstance;
  let service: ParticipationService;
  let dir: string;

  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    delete process.env.PARTICIPATION_AGREEMENT_FILE;
    delete process.env.PARTICIPATION_AGREEMENT_VERSION;
    process.env.PARTICIPATION_AGREEMENT_REQUIRED = "true";
    dir = mkdtempSync(join(tmpdir(), "participation-"));
    await prisma.user.createMany({
      data: [
        { id: OWNER, email: `${OWNER}@test.resonate` },
        { id: STRANGER, email: `${STRANGER}@test.resonate` },
      ],
    });
    await prisma.artist.create({ data: { id: ARTIST, userId: OWNER, displayName: "Participation Artist" } });
  });

  beforeEach(() => {
    eventBus = new EventBus();
    publish = jest.spyOn(eventBus, "publish");
    service = new ParticipationService(eventBus);
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(dir, { recursive: true, force: true });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("asks a new artist to accept, offering the safe defaults", async () => {
    const status = await service.status(OWNER, ARTIST);
    expect(status.needsAcceptance).toBe(true);
    expect(status.required).toBe(true);
    expect(status.agreement.placeholder).toBe(true);
    expect(status.defaultChoices).toEqual(SAFE_DEFAULT_CHOICES);
    // Existing rows keep today's behaviour until the artist chooses.
    expect(status.choices).toEqual({
      remixConsent: "allowed",
      aiRemixApproval: "not_required",
      aiSourceUse: "allowed",
      stemListing: "allowed",
    });
  });

  it("refuses uploads before acceptance", async () => {
    await expect(assertParticipationAccepted(ARTIST)).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: "participation_agreement_required" }),
    });
  });

  it("lets only the artist read or accept", async () => {
    await expect(service.status(STRANGER, ARTIST)).rejects.toMatchObject({ status: 403 });
    const agreement = loadParticipationAgreement();
    await expect(
      service.accept(STRANGER, ARTIST, {
        version: agreement.version,
        textHash: agreement.textHash,
        choices: SAFE_DEFAULT_CHOICES,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an acceptance of text the server no longer serves", async () => {
    const agreement = loadParticipationAgreement();
    await expect(
      service.accept(OWNER, ARTIST, { version: agreement.version, textHash: "0".repeat(64), choices: SAFE_DEFAULT_CHOICES }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.participationAcceptance.count({ where: { artistId: ARTIST } })).toBe(0);
  });

  it("records the acceptance and every choice, then opens uploads", async () => {
    const agreement = loadParticipationAgreement();
    const status = await service.accept(OWNER, ARTIST, {
      version: agreement.version,
      textHash: agreement.textHash,
      choices: SAFE_DEFAULT_CHOICES,
    });
    expect(status.needsAcceptance).toBe(false);
    expect(status.accepted).toEqual(expect.objectContaining({ version: "placeholder", textHash: agreement.textHash }));
    expect(status.choices).toEqual(SAFE_DEFAULT_CHOICES);
    expect(status.history).toHaveLength(4);
    expect(new Set(status.history.map((h) => h.source))).toEqual(new Set(["onboarding"]));
    // remixConsent stayed "allowed": no remix consent event.
    expect(publish).not.toHaveBeenCalled();
    await expect(assertParticipationAccepted(ARTIST)).resolves.toBeUndefined();
  });

  it("records a change from Settings and tells published remixes when remixing is turned off", async () => {
    const status = await service.updateChoices(OWNER, ARTIST, { aiSourceUse: "allowed", remixConsent: "disabled" });
    expect(status.choices.aiSourceUse).toBe("allowed");
    expect(status.choices.remixConsent).toBe("disabled");
    const latest = status.history.filter((h) => h.source === "settings");
    expect(latest.map((h) => [h.setting, h.previousValue, h.value]).sort()).toEqual([
      ["aiSourceUse", "disabled", "allowed"],
      ["remixConsent", "allowed", "disabled"],
    ]);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "artist.remix_consent_updated", artistId: ARTIST, previous: "allowed", next: "disabled" }),
    );
  });

  it("rejects a choice value that is not offered", async () => {
    await expect(service.updateChoices(OWNER, ARTIST, { stemListing: "sometimes" })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps the remix switch in the artist settings in the same history", async () => {
    const artists = new ArtistService(new EventBus());
    await artists.updateSettings(OWNER, ARTIST, { remixConsent: "allowed" });
    const row = await prisma.artistConsentChange.findFirst({
      where: { artistId: ARTIST, setting: "remixConsent", value: "allowed", source: "settings" },
    });
    expect(row).toEqual(expect.objectContaining({ previousValue: "disabled", userId: OWNER }));
  });

  it("asks again when a new version is published, and keeps the earlier acceptance", async () => {
    const file = join(dir, "agreement-v2.md");
    const text = "# Artist participation agreement\n\nVersion two.\n";
    writeFileSync(file, text);
    process.env.PARTICIPATION_AGREEMENT_FILE = file;
    process.env.PARTICIPATION_AGREEMENT_VERSION = "2026-12-01";

    const before = await service.status(OWNER, ARTIST);
    expect(before.needsAcceptance).toBe(true);
    expect(before.agreement).toEqual(expect.objectContaining({ version: "2026-12-01", placeholder: false }));
    await expect(assertParticipationAccepted(ARTIST)).rejects.toMatchObject({ status: 403 });

    const after = await service.accept(OWNER, ARTIST, {
      version: "2026-12-01",
      textHash: hashAgreementText(text),
      choices: before.choices,
    });
    expect(after.accepted?.version).toBe("2026-12-01");
    expect(after.acceptances.map((a) => a.version).sort()).toEqual(["2026-12-01", "placeholder"]);
    await expect(assertParticipationAccepted(ARTIST)).resolves.toBeUndefined();
  });

  it("shows the record to operators", async () => {
    const record = await service.describeForOperator(ARTIST);
    expect(record.accepted?.version).toBe("2026-12-01");
    expect(record.history.length).toBeGreaterThanOrEqual(7);
  });

  it("does not let artists accept the placeholder in production", async () => {
    delete process.env.PARTICIPATION_AGREEMENT_FILE;
    delete process.env.PARTICIPATION_AGREEMENT_VERSION;
    process.env.NODE_ENV = "production";
    try {
      const agreement = loadParticipationAgreement();
      expect(agreement.available).toBe(false);
      await expect(
        service.accept(OWNER, ARTIST, { version: agreement.version, textHash: agreement.textHash, choices: SAFE_DEFAULT_CHOICES }),
      ).rejects.toMatchObject({ status: 503 });
      // The earlier placeholder acceptance does not open uploads there.
      await expect(assertParticipationAccepted(ARTIST)).rejects.toMatchObject({ status: 403 });
    } finally {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
    }
  });
});
