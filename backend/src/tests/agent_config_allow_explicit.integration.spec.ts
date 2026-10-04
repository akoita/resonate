/**
 * AI DJ "include explicit tracks" preference (#2088) — config API and session
 * start, against real Postgres. Only the runtime service is stubbed.
 */
import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AgentConfigController } from "../modules/agents/agent_config.controller";

const PREFIX = `allow_explicit_${Date.now()}_`;
const USER = `${PREFIX}user`;
const req = { user: { userId: USER } };

async function waitFor(assertion: () => void, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return assertion();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

describe("AgentConfigController allowExplicit (integration)", () => {
  const runtime = {
    run: jest.fn(),
  };
  const learning = {
    resolveTasteProfile: jest.fn().mockResolvedValue(null),
    mergeLearnedGenres: jest.fn(),
  };
  const identity = { enrichConfig: jest.fn(async (config: unknown) => config) };
  const controller = new AgentConfigController(
    {} as any,
    runtime as any,
    identity as any,
    learning as any,
    { publish: jest.fn() } as any,
  );

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.resonate` } });
    await prisma.agentConfig.create({ data: { userId: USER, monthlyCapUsd: 10 } });
  });

  afterAll(async () => {
    await prisma.license.deleteMany({ where: { session: { userId: USER } } });
    await prisma.session.deleteMany({ where: { userId: USER } });
    await prisma.agentConfig.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  beforeEach(() => {
    runtime.run.mockReset();
    runtime.run.mockResolvedValue({ status: "no_tracks", tracks: [] });
  });

  it("defaults to off and is returned by GET", async () => {
    await expect(controller.get(req)).resolves.toMatchObject({ allowExplicit: false });
  });

  it("persists a boolean PATCH and rejects anything else", async () => {
    await expect(controller.update(req, { allowExplicit: true })).resolves.toMatchObject({ allowExplicit: true });
    await expect(controller.get(req)).resolves.toMatchObject({ allowExplicit: true });

    await expect(controller.update(req, { allowExplicit: "yes" as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.update(req, { allowExplicit: 1 as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.get(req)).resolves.toMatchObject({ allowExplicit: true });

    // Other edits leave the saved choice alone.
    await controller.update(req, { name: "Renamed DJ" });
    await expect(controller.get(req)).resolves.toMatchObject({ allowExplicit: true });
    await controller.update(req, { allowExplicit: false });
    await expect(controller.get(req)).resolves.toMatchObject({ allowExplicit: false });
  });

  it("session start applies the saved choice unless the session sends its own", async () => {
    const sentAllowExplicit = () => runtime.run.mock.calls.at(-1)?.[0].preferences.allowExplicit;

    await controller.update(req, { allowExplicit: false });
    await controller.startSession(req, {});
    await waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(1));
    expect(sentAllowExplicit()).toBe(false);

    await controller.update(req, { allowExplicit: true });
    await controller.startSession(req, {});
    await waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(2));
    expect(sentAllowExplicit()).toBe(true);

    await controller.startSession(req, { preferences: { allowExplicit: false } });
    await waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(3));
    expect(sentAllowExplicit()).toBe(false);
  });
});
