import { prisma } from "../db/prisma";
import { IngestionService } from "../modules/ingestion/ingestion.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `ingestion_cancel_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const RECIPIENT_ID = `${TEST_PREFIX}recipient`;
const OUTSIDER_ID = `${TEST_PREFIX}outsider`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;

describe("ingestion cancellation authority", () => {
  const eventBus = new EventBus();
  const queue = { getJobs: jest.fn().mockResolvedValue([]) };
  const service = new IngestionService(
    eventBus,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    queue as any,
  );

  beforeAll(async () => {
    for (const id of [OWNER_ID, RECIPIENT_ID, OUTSIDER_ID]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: OWNER_ID, displayName: "Cancellation owner" },
    });
    await prisma.release.create({
      data: { id: RELEASE_ID, artistId: ARTIST_ID, title: "Processing release", status: "processing" },
    });
  });

  afterAll(async () => {
    await prisma.release.deleteMany({ where: { id: RELEASE_ID } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, RECIPIENT_ID, OUTSIDER_ID] } } });
  });

  beforeEach(() => queue.getJobs.mockClear());

  it("denies a foreign user before touching the queue or publishing an event", async () => {
    const publish = jest.spyOn(eventBus, "publish");
    await expect(service.cancelProcessing(RELEASE_ID, OUTSIDER_ID)).rejects.toThrow(
      "Not authorized to cancel this release",
    );
    expect(queue.getJobs).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
  });

  it("allows the current management owner and uses the release's artist id in the event", async () => {
    const publish = jest.spyOn(eventBus, "publish");
    await expect(service.cancelProcessing(RELEASE_ID, OWNER_ID)).resolves.toMatchObject({ success: true });
    expect(queue.getJobs).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "stems.failed",
      releaseId: RELEASE_ID,
      artistId: ARTIST_ID,
    }));
    publish.mockRestore();
  });

  it("follows an accepted management owner override without retaining former-owner access", async () => {
    await prisma.release.update({
      where: { id: RELEASE_ID },
      data: { managementOwnerUserId: RECIPIENT_ID },
    });
    await expect(service.cancelProcessing(RELEASE_ID, OWNER_ID)).rejects.toThrow(
      "Not authorized to cancel this release",
    );
    expect(queue.getJobs).not.toHaveBeenCalled();
    await expect(service.cancelProcessing(RELEASE_ID, RECIPIENT_ID)).resolves.toMatchObject({ success: true });
  });
});
