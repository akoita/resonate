/**
 * Generation-credit meter gating remix AI drafts — Integration Test (#1334).
 *
 * Proves the meter blocks a zero-balance user from an AI (prompted) remix draft
 * and debits a granted user, while a free stem_mix draft is never charged. Uses
 * a REAL GenerationCreditsService against real Postgres; the generation provider
 * and storage are stubbed. Mirrors the remix-draft-versions harness.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  type RemixGenerationJobData,
} from "../modules/remix/remix-project.service";
import {
  RemixGenerationProviderError,
  type RemixGenerationInput,
  type RemixGenerationJob,
  type StemRenderAuthorization,
} from "../modules/remix/remix-generation.provider";
import {
  GenerationCreditsService,
  InsufficientCreditsException,
} from "../modules/credits/generation-credits.service";

const TEST_PREFIX = `credremix_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const STEM_ID = `${TEST_PREFIX}stem_vocals`;

// Minimal AI provider: returns a draft job for prompted modes. Spy lets us
// assert whether generation was actually reached (i.e. the debit passed).
const providerRender = jest.fn(
  async (
    input: RemixGenerationInput,
    _auth: StemRenderAuthorization,
  ): Promise<RemixGenerationJob> => ({
    provider: "remix-stub",
    jobId: `rmxgen_${input.provenance.remixProjectId}`,
    estimatedCostUsd: 0,
    outputMetadata: {
      outputUri: "local://draft.mp3",
      mimeType: "audio/mpeg",
      synthIdPresent: false,
      seed: null,
      sampleRate: null,
    },
  }),
);
const generationProvider = { createRemixDraft: providerRender };

const storageProvider = {
  upload: jest.fn(),
  download: jest.fn((uri: string) => Promise.resolve(Buffer.from(`audio:${uri}`))),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };
const stemMixRenderer = {
  render: jest.fn().mockResolvedValue({
    jobId: "stemmix-1",
    provider: "stem-mix-render",
    estimatedCostUsd: 0,
    outputMetadata: {
      outputUri: "local://stemmix.mp3",
      mimeType: "audio/mpeg",
      synthIdPresent: false,
      seed: null,
      sampleRate: null,
    },
  }),
};

describe("Generation-credit meter gates remix AI drafts (#1334)", () => {
  let projectService: RemixProjectService;
  let eventBus: EventBus;
  const credits = new GenerationCreditsService(
    { get: (_k: string, fallback?: unknown) => fallback } as any,
  );
  const prevEnabled = process.env.REMIX_GENERATION_ENABLED;

  beforeAll(async () => {
    process.env.REMIX_GENERATION_ENABLED = "true";
    await prisma.user.create({
      data: { id: OWNER_ID, email: `${TEST_PREFIX}owner@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: OWNER_ID,
        displayName: "Credits Remix Artist",
        payoutAddress: `0x${"c3".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Credits Remix Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Credits Remix Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: { id: STEM_ID, trackId: TRACK_ID, type: "vocals", uri: "local://v" },
    });

    eventBus = new EventBus();
    projectService = new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      generationProvider as never,
      stemMixRenderer as never,
      storageProvider as never,
      generationQueue as never,
      credits as never,
    );
  });

  afterAll(async () => {
    if (prevEnabled === undefined) delete process.env.REMIX_GENERATION_ENABLED;
    else process.env.REMIX_GENERATION_ENABLED = prevEnabled;
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: OWNER_ID } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: OWNER_ID } });
    await prisma.remixProjectStem.deleteMany({
      where: { project: { sourceTrackId: TRACK_ID } },
    });
    await prisma.remixProject.deleteMany({ where: { sourceTrackId: TRACK_ID } });
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: OWNER_ID } });
    eventBus.destroy();
  });

  beforeEach(() => jest.clearAllMocks());

  async function enqueueDraft(mode: string): Promise<RemixGenerationJobData> {
    const project = await projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [STEM_ID],
      title: `Draft ${mode} ${Date.now()}`,
      mode,
      prompt: mode === "stem_mix" ? null : "warmer, halftime",
    });
    await projectService.generateDraft(OWNER_ID, project.id, { retry: false });
    return generationQueue.add.mock.calls.at(-1)?.[1] as RemixGenerationJobData;
  }

  it("blocks a zero-balance user's AI draft before the provider renders", async () => {
    const jobData = await enqueueDraft("variation");

    await expect(projectService.processGenerationJob(jobData)).rejects.toBeInstanceOf(
      InsufficientCreditsException,
    );

    // The provider was never reached — the debit gates it.
    expect(providerRender).not.toHaveBeenCalled();
    expect((await credits.getBalance(OWNER_ID)).balanceCents).toBe(0);
  });

  it("debits a granted user and renders the AI draft", async () => {
    await credits.grant(OWNER_ID, 100, "promo_grant");
    const jobData = await enqueueDraft("variation");

    await projectService.processGenerationJob(jobData);

    expect(providerRender).toHaveBeenCalledTimes(1);
    // 30s default duration → 10¢ charged (100 → 90).
    const { balanceCents, recentTransactions } = await credits.getBalance(OWNER_ID);
    expect(balanceCents).toBe(90);
    expect(
      recentTransactions.find((t) => t.type === "debit" && t.reason === "remix_draft"),
    ).toMatchObject({ amountCents: 10 });
  });

  it("does NOT charge a free stem_mix draft", async () => {
    await credits.grant(OWNER_ID, 50, "promo_grant"); // 90 → 140
    const jobData = await enqueueDraft("stem_mix");

    await projectService.processGenerationJob(jobData);

    expect(stemMixRenderer.render).toHaveBeenCalledTimes(1);
    // No debit for stem_mix; balance unchanged at 140.
    expect((await credits.getBalance(OWNER_ID)).balanceCents).toBe(140);
  });

  it("refunds the charge when the AI provider render throws", async () => {
    await credits.grant(OWNER_ID, 10, "promo_grant"); // 140 → 150
    providerRender.mockRejectedValueOnce(
      new RemixGenerationProviderError("provider_unavailable", "boom", true),
    );
    const jobData = await enqueueDraft("variation");

    await expect(projectService.processGenerationJob(jobData)).rejects.toThrow();

    // Debited 10¢ then refunded → balance back to 150.
    expect((await credits.getBalance(OWNER_ID)).balanceCents).toBe(150);
  });
});
