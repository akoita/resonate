import { prisma } from "../db/prisma";
import { StemResultSubscriber } from "../modules/ingestion/stem-result.subscriber";
import { EventBus } from "../modules/shared/event_bus";

const P = `stem_result_replacement_${Date.now()}_`;
const artistId = `${P}artist`;
const releaseId = `${P}release`;
const trackId = `${P}track`;
const activeRevision = "11111111-1111-4111-8111-111111111111";
const pendingRevision = "22222222-2222-4222-8222-222222222222";
const staleRevision = "33333333-3333-4333-8333-333333333333";
const activeStemId = `${P}active_stem`;
const stagedStemId = `${P}staged_stem`;

describe("replacement result after release publication", () => {
  const subscriber = new StemResultSubscriber(
    new EventBus(),
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeAll(async () => {
    await prisma.artist.create({ data: { id: artistId, displayName: "Replacement result test" } });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: "Published release", status: "published" },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: "Track",
        position: 1,
        processingStatus: "complete",
        activeAudioRevision: activeRevision,
        pendingAudioRevision: pendingRevision,
        audioReplacementStatus: "processing",
        pendingAudioFingerprint: "pending fingerprint",
        pendingAudioFingerprintHash: "pending hash",
        pendingAudioFingerprintDuration: 21.5,
      },
    });
    await prisma.stem.createMany({
      data: [
        {
          id: activeStemId,
          trackId,
          type: "original",
          uri: "/stems/active.mp3",
          audioRevision: activeRevision,
          isCurrent: true,
        },
        {
          id: stagedStemId,
          trackId,
          type: "original",
          uri: "/stems/staged.mp3",
          audioRevision: pendingRevision,
          isCurrent: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { trackId } });
    await prisma.track.deleteMany({ where: { id: trackId } });
    await prisma.release.deleteMany({ where: { id: releaseId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
  });

  it("fails only the matching pending attempt and leaves stale results untouched", async () => {
    const deliver = async (audioRevision: string) => {
      const message = {
        data: Buffer.from(JSON.stringify({
          jobId: `job_${audioRevision}`,
          releaseId,
          artistId,
          trackId,
          audioRevision,
          status: "completed",
          stems: { vocals: "/stems/vocals.mp3" },
        })),
        ack: jest.fn(),
        nack: jest.fn(),
      };
      await (subscriber as any).handleMessage(message);
      return message;
    };

    const staleMessage = await deliver(staleRevision);
    expect(staleMessage.ack).toHaveBeenCalledTimes(1);
    expect(staleMessage.nack).not.toHaveBeenCalled();
    expect(await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).toMatchObject({
      pendingAudioRevision: pendingRevision,
      audioReplacementStatus: "processing",
      pendingAudioFingerprint: "pending fingerprint",
    });

    const matchingMessage = await deliver(pendingRevision);
    expect(matchingMessage.ack).toHaveBeenCalledTimes(1);
    expect(matchingMessage.nack).not.toHaveBeenCalled();

    expect(await prisma.track.findUniqueOrThrow({ where: { id: trackId } })).toMatchObject({
      activeAudioRevision: activeRevision,
      pendingAudioRevision: null,
      audioReplacementStatus: "failed",
      pendingAudioFingerprint: null,
      pendingAudioFingerprintHash: null,
      pendingAudioFingerprintDuration: null,
    });
    expect(await prisma.stem.findMany({ where: { trackId }, orderBy: { id: "asc" } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: activeStemId, isCurrent: true, audioRevision: activeRevision }),
        expect.objectContaining({ id: stagedStemId, isCurrent: false, audioRevision: pendingRevision }),
      ]),
    );
  });
});
