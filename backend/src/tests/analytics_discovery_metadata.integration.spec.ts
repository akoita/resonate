import { prisma } from "../db/prisma";
import { AnalyticsDiscoveryMetadataService } from "../modules/analytics/analytics_discovery_metadata.service";
import { normalizeAnalyticsEventInput } from "../modules/analytics/analytics_event";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";

const prefix = `discoverymeta_${Date.now()}_`;
const owner = `${prefix}owner`;
const listener = `${prefix}listener`;
const artist = `${prefix}artist`;
const release = `${prefix}release`;
const track = `${prefix}track`;
const session = `${prefix}session`;

describe("server-owned discovery ledger dimensions", () => {
  const service = new AnalyticsDiscoveryMetadataService();
  beforeAll(async () => {
    await prisma.user.createMany({ data: [owner, listener].map((id) => ({ id, email: `${id}@test.resonate` })) });
    await prisma.artist.create({ data: { id: artist, userId: owner, displayName: "Owner" } });
    await prisma.release.create({ data: { id: release, artistId: artist, title: "Release", genre: "Jazz", status: "ready" } });
    await prisma.track.create({ data: { id: track, releaseId: release, title: "Track", aiDisclosureLevel: "ALL" } });
    await prisma.session.create({ data: { id: session, userId: listener, budgetCapUsd: 10, spentUsd: 0 } });
  });
  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: session } });
    await prisma.track.deleteMany({ where: { id: track } });
    await prisma.release.deleteMany({ where: { id: release } });
    await prisma.artist.deleteMany({ where: { id: artist } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, listener] } } });
  });
  const event = (actorId: string, trackId = track) => normalizeAnalyticsEventInput({
    eventName: "playback.completed", eventVersion: 1, occurredAt: new Date().toISOString(),
    producer: "web-app", privacyTier: "pseudonymous", consentBasis: "consent", actorId,
    payload: { trackId, artistId: "spoof", genre: "Pop", aiDisclosureLevel: "NONE", selfEngagement: false, completionRatio: 1 },
  });

  it("overwrites spoofed metadata and identifies the owner's own listen", async () => {
    const enriched = await service.enrich(event(pseudonymousAnalyticsActorId(owner)!));
    expect(enriched.payload).toMatchObject({ artistId: artist, releaseId: release, genre: "Jazz", aiDisclosureLevel: "ALL", selfEngagement: true });
  });
  it("certifies another authenticated listener and refuses unknown identities/tracks", async () => {
    expect((await service.enrich(event(pseudonymousAnalyticsActorId(listener)!))).payload.selfEngagement).toBe(false);
    expect((await service.enrich(event("anonymous"))).payload).not.toHaveProperty("selfEngagement");
    expect((await service.enrich(event(pseudonymousAnalyticsActorId(listener)!, "missing"))).payload).not.toHaveProperty("aiDisclosureLevel");
  });
  it("uses the settled session's listener rather than a supplied wallet", async () => {
    const settled = { ...event("0xwallet"), eventName: "payment.settled", consentBasis: "performance_of_contract", sessionId: session };
    const enriched = await service.enrich(settled);
    expect(enriched.actorId).toBe(pseudonymousAnalyticsActorId(listener));
    expect(enriched.payload.selfEngagement).toBe(false);
  });
  it("does not give a manager the engagement of an unrelated public credit", async () => {
    await prisma.track.update({ where: { id: track }, data: { artist: "Unrelated Public Artist" } });
    const enriched = await service.enrich(event(pseudonymousAnalyticsActorId(listener)!));
    expect(enriched.payload.creditedArtistIds).toEqual([]);
    expect(enriched.payload.creditedArtistId).toBeNull();
  });

});
