/**
 * One "can be played publicly right now" filter (`PLAYABLE_TRACK_WHERE`) for
 * the surfaces that search or pick catalog tracks for a listener: the AI DJ's
 * catalog search tool, the reload of model picks, and playback resolution.
 * A fixture track per state must be absent from each of them, and the query
 * form must agree with `classifyTrackAvailability`.
 */
import { prisma } from "../db/prisma";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import {
  PLAYABLE_TRACK_WHERE,
  resolveTrackAvailability,
} from "../modules/catalog/track-availability";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { PrismaPlaybackIntentCatalogResolver } from "../modules/sessions/playback_intents.service";

const TEST_PREFIX = `playable_${Date.now()}_`;
const GENRE = `${TEST_PREFIX}Genre`;
const TITLE = `${TEST_PREFIX}Song`;

type Fixture = {
  key: string;
  playable: boolean;
  release?: { status?: string; rightsRoute?: string | null };
  track?: { contentStatus?: string; rightsRoute?: string | null };
};

const FIXTURES: Fixture[] = [
  { key: "published", playable: true, release: { status: "published" } },
  { key: "ready", playable: true, release: { status: "ready" } },
  { key: "public_route", playable: true, release: { status: "published", rightsRoute: "STANDARD_ESCROW" } },
  { key: "processing", playable: false, release: { status: "processing" } },
  { key: "withdrawn", playable: false, release: { status: "withdrawn" } },
  { key: "quarantined", playable: false, release: { status: "published" }, track: { contentStatus: "quarantined" } },
  { key: "removed", playable: false, release: { status: "published" }, track: { contentStatus: "dmca_removed" } },
  { key: "release_route", playable: false, release: { status: "published", rightsRoute: "QUARANTINED_REVIEW" } },
  { key: "track_route", playable: false, release: { status: "published" }, track: { rightsRoute: "QUARANTINED_REVIEW" } },
];

const trackId = (key: string) => `${TEST_PREFIX}track_${key}`;
const playableIds = FIXTURES.filter((f) => f.playable).map((f) => trackId(f.key)).sort();
const allIds = FIXTURES.map((f) => trackId(f.key));

describe("PLAYABLE_TRACK_WHERE (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Playable Fixture Artist",
        payoutAddress: `0x${"B".repeat(40)}`,
      },
    });
    for (const [index, fixture] of FIXTURES.entries()) {
      await prisma.release.create({
        data: {
          id: `${TEST_PREFIX}release_${fixture.key}`,
          title: `${TEST_PREFIX}Release ${fixture.key}`,
          artistId: `${TEST_PREFIX}artist`,
          genre: GENRE,
          ...fixture.release,
        },
      });
      await prisma.track.create({
        data: {
          id: trackId(fixture.key),
          title: `${TITLE} ${fixture.key}`,
          releaseId: `${TEST_PREFIX}release_${fixture.key}`,
          position: index + 1,
          ...fixture.track,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.track.deleteMany({ where: { id: { in: allIds } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: `${TEST_PREFIX}release_` } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it("selects exactly the tracks the availability classifier calls available", async () => {
    const rows = await prisma.track.findMany({
      where: { id: { in: allIds }, ...PLAYABLE_TRACK_WHERE },
      select: { id: true },
    });
    expect(rows.map((row) => row.id).sort()).toEqual(playableIds);

    const availability = await resolveTrackAvailability(allIds);
    const classified = allIds.filter((id) => availability.get(id)?.state === "available").sort();
    expect(classified).toEqual(playableIds);
  });

  it("the AI DJ catalog search returns only playable tracks", async () => {
    const tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore());
    const result = await tools.get("catalog.search").run({ query: GENRE, limit: 50, allowExplicit: true });
    const ids = (result.items as Array<{ id: string }>).map((item) => item.id).sort();
    expect(ids).toEqual(playableIds);

    // The "how many of the session's own tracks match" count follows the same rule.
    const counted = await tools.get("catalog.search").run({
      query: GENRE,
      limit: 50,
      allowExplicit: true,
      excludeTrackIds: allIds,
    });
    expect(counted.items).toEqual([]);
    expect(counted.excludedMatches).toBe(playableIds.length);
  });

  it("the reload of model picks drops a track that is not playable", async () => {
    const context = new DiscoveryPolicyContextService();
    const picks = await context.loadTrackCandidates(allIds, { playableOnly: true });
    expect([...picks.keys()].sort()).toEqual(playableIds);

    // Without the option (session history keys) every known track is still read.
    const history = await context.loadTrackCandidates(allIds);
    expect(history.size).toBe(allIds.length);
  });

  it("playback resolution returns only playable tracks", async () => {
    const resolver = new PrismaPlaybackIntentCatalogResolver();
    const found = await resolver.resolve({
      ownerUserId: `${TEST_PREFIX}user`,
      query: TITLE,
      constraints: { maxTracks: 10, explicit: true, source: "resonate_catalog" },
    });
    expect(found.map((candidate) => candidate.trackId).sort()).toEqual(playableIds);
  });
});
