import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { pseudonymousAnalyticsActorId } from "../analytics/analytics_identity";
import { normalizeAnalyticsGeoDimension } from "../analytics/analytics_event";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../analytics/analytics_consent.service";
import { findResonance } from "../discovery_journal/discovery_journal.service";

export const SCENE_SCOUT_SOURCE = Symbol("SCENE_SCOUT_SOURCE");

export type SceneScoutWindowDays = 7 | 28;
export type SceneScoutStatus = "ready" | "thin_data" | "unavailable";

export interface SceneScoutCityDemandRow {
  releaseId: string;
  releaseTitle: string;
  citySlug: string;
  countryCode: string;
  windowDays: SceneScoutWindowDays;
  resonantListeners: number;
  saves: number;
  follows: number;
  purchases: number;
  pledges: number;
  uniqueListeners: number;
  signalCount: number;
  computedAt: Date;
}

export interface SceneScoutResult {
  status: SceneScoutStatus;
  reason?: string;
  cityDemand: SceneScoutCityDemandRow[];
}

export interface SceneScoutSource {
  getArtistSceneScout(
    artistId: string,
    options?: { now?: Date },
  ): Promise<SceneScoutResult>;
}

/** Entitlement seam; the initial implementation keeps Scene Scout free. */
@Injectable()
export class SceneScoutEntitlementsService {
  async canRead(_artistId: string): Promise<boolean> {
    return true;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Per-artist event/catalog limit and global consent/policy-state read ceiling. */
export const SCENE_SCOUT_READ_CAP = 20_000;
const TRACK_ID_QUERY_CHUNK_SIZE = 500;
const SERVING_SIGNAL_FLOOR = 5;
const WINDOW_DAYS: readonly SceneScoutWindowDays[] = [7, 28];
const LEDGER_EVENT_NAMES = [
  "playback.completed",
  "library.saved",
  "playlist.track_added",
  "x402.purchase",
] as const;
const CONSENTED_EVENT_NAMES = new Set([
  "playback.completed",
  "library.saved",
  "playlist.track_added",
]);
const SETTLEMENT_CONSENT_BASES = new Set(["performance_of_contract", "contract"]);
const SAVE_EVENT_NAMES = new Set(["library.saved", "playlist.track_added"]);
const SUCCESSFUL_X402_SETTLEMENT_STATUSES = ["download_granted", "collected"];

type JsonObject = Record<string, unknown>;

interface LedgerEvent {
  eventId: string;
  eventName: string;
  occurredAt: Date;
  producer: string;
  actorId: string | null;
  sessionId: string | null;
  consentBasis: string | null;
  payload: Prisma.JsonValue;
  envelope: Prisma.JsonValue;
}

interface CatalogTrack {
  releaseId: string;
  releaseTitle: string;
}

interface CityKey {
  citySlug: string;
  countryCode: string;
}

interface ResonanceEventGroup {
  artistId: string;
  releaseId: string;
  releaseTitle: string;
  city: CityKey;
  actorId: string;
  trackId: string;
  events: Array<{
    action: string;
    createdAt: Date;
    sessionId: string | null;
    metadata: unknown;
  }>;
}

interface AggregateAccumulator {
  releaseId: string;
  releaseTitle: string;
  citySlug: string;
  countryCode: string;
  resonantActors: Set<string>;
  uniqueActors: Set<string>;
  saveContributions: Set<string>;
  followContributions: Set<string>;
  purchaseContributions: Set<string>;
  pledgeContributions: Set<string>;
}

interface ListenerTastePolicy {
  resetAt: Date | null;
  agentPlaybackTrainingEnabled: boolean;
}

interface ListenerIdentityContext {
  canonicalActorIds: Map<string, string>;
  grantedConsentActors: Set<string>;
  tastePolicies: Map<string, ListenerTastePolicy>;
  ownerActorId: string | null;
}

interface ListenerIdentityLoad {
  context: ListenerIdentityContext;
  incomplete: boolean;
}

interface CanonicalPurchase {
  trackId: string;
  canonicalActorId: string;
  actorAliases: Set<string>;
}

interface CanonicalPurchaseLoad {
  purchases: Map<string, CanonicalPurchase>;
  incomplete: boolean;
}

function jsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function cityFromEnvelope(envelope: Prisma.JsonValue): CityKey | null {
  let geo: ReturnType<typeof normalizeAnalyticsGeoDimension>;
  try {
    geo = normalizeAnalyticsGeoDimension(jsonObject(envelope).geo);
  } catch {
    return null;
  }
  if (
    !geo ||
    geo.source !== "user_declared" ||
    geo.precision !== "city" ||
    !geo.citySlug
  ) {
    return null;
  }
  return { citySlug: geo.citySlug, countryCode: geo.countryCode };
}

function actorKeys(userId: string) {
  return [...new Set([userId, userId.toLowerCase(), pseudonymousAnalyticsActorId(userId)])].filter(
    (value): value is string => Boolean(value),
  );
}

function actorTrackCityKey(actorId: string, trackId: string, city: CityKey) {
  return `${actorId}\u0000${trackId}\u0000${city.countryCode}\u0000${city.citySlug}`;
}

function aggregateKey(releaseId: string, city: CityKey) {
  return `${releaseId}\u0000${city.countryCode}\u0000${city.citySlug}`;
}

function contributionKey(actorId: string, trackId: string) {
  return `${actorId}\u0000${trackId}`;
}

function newAccumulator(
  releaseId: string,
  releaseTitle: string,
  city: CityKey,
): AggregateAccumulator {
  return {
    releaseId,
    releaseTitle,
    citySlug: city.citySlug,
    countryCode: city.countryCode,
    resonantActors: new Set(),
    uniqueActors: new Set(),
    saveContributions: new Set(),
    followContributions: new Set(),
    purchaseContributions: new Set(),
    pledgeContributions: new Set(),
  };
}

function signalCount(row: AggregateAccumulator) {
  return (
    row.resonantActors.size +
    row.saveContributions.size +
    row.followContributions.size +
    row.purchaseContributions.size +
    row.pledgeContributions.size
  );
}

function isAgentOriginated(payload: JsonObject) {
  return payload.source === "agent_session" || payload.agentOriginated === true;
}

export function sceneScoutMinimumAudience() {
  const configured = Number(process.env.DISCOVERY_MIN_AUDIENCE ?? "");
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 3;
}

export function sceneScoutMeetsAudienceThreshold(uniqueListeners: number) {
  return Number.isSafeInteger(uniqueListeners) && uniqueListeners >= sceneScoutMinimumAudience();
}

export function sceneScoutMeetsServingThreshold(row: Pick<SceneScoutCityDemandRow, "uniqueListeners" | "signalCount">) {
  return sceneScoutMeetsAudienceThreshold(row.uniqueListeners) &&
    Number.isSafeInteger(row.signalCount) &&
    row.signalCount >= SERVING_SIGNAL_FLOOR;
}

/**
 * Builds per-city, per-release aggregates from accepted analytics events.
 * Listener and track identities stay in memory only; returned rows contain
 * counters and catalog labels, never audience identifiers.
 */
export function aggregateSceneScoutEvents(input: {
  artistId: string;
  events: LedgerEvent[];
  catalogTracks: Map<string, CatalogTrack>;
  identity: ListenerIdentityContext;
  canonicalPurchases: Map<string, CanonicalPurchase>;
  now: Date;
}): SceneScoutCityDemandRow[] {
  const resonanceGroups = new Map<string, ResonanceEventGroup>();
  const accumulators = new Map<string, Map<SceneScoutWindowDays, AggregateAccumulator>>();
  const windowsFrom = new Map(
    WINDOW_DAYS.map((windowDays) => [windowDays, new Date(input.now.getTime() - windowDays * DAY_MS)]),
  );

  const accumulatorFor = (
    releaseId: string,
    releaseTitle: string,
    city: CityKey,
    windowDays: SceneScoutWindowDays,
  ) => {
    const key = aggregateKey(releaseId, city);
    const windows = accumulators.get(key) ?? new Map<SceneScoutWindowDays, AggregateAccumulator>();
    const accumulator = windows.get(windowDays) ?? newAccumulator(releaseId, releaseTitle, city);
    windows.set(windowDays, accumulator);
    accumulators.set(key, windows);
    return accumulator;
  };

  for (const event of input.events) {
    const rawActorId = event.actorId;
    const payload = jsonObject(event.payload);
    const trackId = typeof payload.trackId === "string" ? payload.trackId : "";
    const catalogTrack = input.catalogTracks.get(trackId);
    if (!rawActorId || !catalogTrack) continue;
    const purchaseReceiptId = typeof payload.receiptId === "string" ? payload.receiptId : "";
    const purchase = event.eventName === "x402.purchase"
      ? input.canonicalPurchases.get(purchaseReceiptId)
      : undefined;
    if (
      event.eventName === "x402.purchase" &&
      (!purchase || !purchase.actorAliases.has(rawActorId.trim().toLowerCase()))
    ) continue;
    const actorId = purchase?.canonicalActorId ?? input.identity.canonicalActorIds.get(rawActorId) ?? rawActorId;
    if (actorId === input.identity.ownerActorId) continue;
    const city = cityFromEnvelope(event.envelope);
    if (!city) continue;

    const isConsentedEvent = CONSENTED_EVENT_NAMES.has(event.eventName);
    if (isConsentedEvent) {
      if (event.consentBasis !== "consent" || !input.identity.grantedConsentActors.has(actorId)) continue;
      const policy = input.identity.tastePolicies.get(actorId);
      if (policy?.resetAt && event.occurredAt <= policy.resetAt) continue;
      if (policy?.agentPlaybackTrainingEnabled === false && isAgentOriginated(payload)) {
        continue;
      }
    } else if (
      event.eventName === "x402.purchase" &&
      (!SETTLEMENT_CONSENT_BASES.has(event.consentBasis ?? "") ||
        event.producer !== "x402-controller" ||
        purchase?.trackId !== trackId)
    ) {
      continue;
    } else if (event.eventName !== "x402.purchase") {
      continue;
    }

    const eventAt = event.occurredAt.getTime();
    for (const windowDays of WINDOW_DAYS) {
      const from = windowsFrom.get(windowDays)!;
      if (eventAt < from.getTime() || eventAt > input.now.getTime()) continue;
      const accumulator = accumulatorFor(
        catalogTrack.releaseId,
        catalogTrack.releaseTitle,
        city,
        windowDays,
      );
      accumulator.uniqueActors.add(actorId);
      if (SAVE_EVENT_NAMES.has(event.eventName)) {
        accumulator.saveContributions.add(contributionKey(actorId, trackId));
      } else if (event.eventName === "x402.purchase" && purchaseReceiptId) {
        accumulator.purchaseContributions.add(purchaseReceiptId);
      }
    }

    if (!CONSENTED_EVENT_NAMES.has(event.eventName)) continue;
    const groupKey = actorTrackCityKey(actorId, trackId, city);
    const group = resonanceGroups.get(groupKey) ?? {
      artistId: input.artistId,
      releaseId: catalogTrack.releaseId,
      releaseTitle: catalogTrack.releaseTitle,
      city,
      actorId,
      trackId,
      events: [],
    };
    if (event.eventName === "playback.completed") {
      group.events.push({
        action: "complete",
        createdAt: event.occurredAt,
        sessionId: event.sessionId,
        metadata: { outcome: { completionRatio: payload.completionRatio } },
      });
    } else {
      group.events.push({
        action: event.eventName === "library.saved" ? "save" : "add_to_playlist",
        createdAt: event.occurredAt,
        sessionId: event.sessionId,
        metadata: {},
      });
    }
    resonanceGroups.set(groupKey, group);
  }

  for (const group of resonanceGroups.values()) {
    for (const windowDays of WINDOW_DAYS) {
      const found = findResonance({
        events: group.events,
        libraryAdds: [],
        from: windowsFrom.get(windowDays)!,
        now: input.now,
      });
      if (!found) continue;
      accumulatorFor(
        group.releaseId,
        group.releaseTitle,
        group.city,
        windowDays,
      ).resonantActors.add(group.actorId);
    }
  }

  const rows: SceneScoutCityDemandRow[] = [];
  for (const windows of accumulators.values()) {
    for (const [windowDays, aggregate] of windows) {
      rows.push({
        releaseId: aggregate.releaseId,
        releaseTitle: aggregate.releaseTitle,
        citySlug: aggregate.citySlug,
        countryCode: aggregate.countryCode,
        windowDays,
        resonantListeners: aggregate.resonantActors.size,
        saves: aggregate.saveContributions.size,
        // The current analytics event model has no canonical listener-follow event.
        follows: aggregate.followContributions.size,
        purchases: aggregate.purchaseContributions.size,
        // Current pledges are campaign-scoped and have no canonical release/track link.
        pledges: aggregate.pledgeContributions.size,
        uniqueListeners: aggregate.uniqueActors.size,
        signalCount: signalCount(aggregate),
        computedAt: input.now,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      a.windowDays - b.windowDays ||
      a.countryCode.localeCompare(b.countryCode) ||
      a.citySlug.localeCompare(b.citySlug) ||
      a.releaseId.localeCompare(b.releaseId),
  );
}

@Injectable()
export class SceneScoutService implements SceneScoutSource {
  private readonly entitlements: SceneScoutEntitlementsService;

  constructor(@Optional() entitlements?: SceneScoutEntitlementsService) {
    this.entitlements = entitlements ?? new SceneScoutEntitlementsService();
  }

  async getArtistSceneScout(
    artistId: string,
    options: { now?: Date } = {},
  ): Promise<SceneScoutResult> {
    if (!(await this.entitlements.canRead(artistId))) {
      return {
        status: "unavailable",
        reason: "Scene Scout is not included in this artist's current access.",
        cityDemand: [],
      };
    }

    const now = options.now ?? new Date();
    const from = new Date(now.getTime() - 28 * DAY_MS);
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { userId: true },
    });
    if (!artist) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "This artist is no longer available for Scene Scout.",
        cityDemand: [],
      };
    }

    const catalog = await this.readBoundedCatalogTracks(artistId);
    if (catalog.truncated) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "The catalog is too large to measure completely right now, so no city estimates are shown.",
        cityDemand: [],
      };
    }
    const catalogTracks = catalog.tracks;
    if (catalogTracks.size === 0) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "This artist needs a release with tracks before city demand can be calculated.",
        cityDemand: [],
      };
    }

    const ledger = await this.readBoundedLedgerEvents([...catalogTracks.keys()], from, now);
    if (ledger.truncated) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "Scene Scout could not read the full recent event window, so no city estimates are shown.",
        cityDemand: [],
      };
    }
    if (ledger.events.length === 0) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "Not enough recent listening data yet to show city demand.",
        cityDemand: [],
      };
    }

    const [identity, canonicalPurchases] = await Promise.all([
      this.loadListenerIdentity(ledger.events, artist.userId),
      this.loadCanonicalPurchases(ledger.events, from, now),
    ]);
    if (identity.incomplete || canonicalPurchases.incomplete) {
      await this.replaceSnapshots(artistId, []);
      return {
        status: "thin_data",
        reason: "Scene Scout could not verify current listener permissions completely, so no city estimates are shown.",
        cityDemand: [],
      };
    }

    const rows = aggregateSceneScoutEvents({
      artistId,
      events: ledger.events,
      catalogTracks,
      identity: identity.context,
      canonicalPurchases: canonicalPurchases.purchases,
      now,
    }).filter((row) => sceneScoutMeetsAudienceThreshold(row.uniqueListeners));

    await this.replaceSnapshots(artistId, rows);
    const cityDemand = rows.filter(sceneScoutMeetsServingThreshold);
    if (cityDemand.length === 0) {
      return {
        status: "thin_data",
        reason: `Not enough recent listening data yet. At least ${sceneScoutMinimumAudience()} listeners and ${SERVING_SIGNAL_FLOOR} signals are needed to show a city.`,
        cityDemand: [],
      };
    }
    return { status: "ready", cityDemand };
  }

  private async readBoundedCatalogTracks(artistId: string) {
    const rows = await prisma.track.findMany({
      where: { release: { is: { artistId } } },
      orderBy: { id: "asc" },
      take: SCENE_SCOUT_READ_CAP + 1,
      select: { id: true, releaseId: true, release: { select: { title: true } } },
    });
    if (rows.length > SCENE_SCOUT_READ_CAP) return { tracks: new Map<string, CatalogTrack>(), truncated: true };
    const tracks = new Map<string, CatalogTrack>();
    for (const row of rows) {
      tracks.set(row.id, { releaseId: row.releaseId, releaseTitle: row.release.title });
    }
    return { tracks, truncated: false };
  }

  private async readBoundedLedgerEvents(trackIds: string[], from: Date, now: Date) {
    const events: LedgerEvent[] = [];
    for (let offset = 0; offset < trackIds.length; offset += TRACK_ID_QUERY_CHUNK_SIZE) {
      const trackChunk = trackIds.slice(offset, offset + TRACK_ID_QUERY_CHUNK_SIZE);
      const remaining = SCENE_SCOUT_READ_CAP - events.length;
      const rows = await prisma.$queryRaw<LedgerEvent[]>(Prisma.sql`
        SELECT "eventId", "eventName", "occurredAt", "producer", "actorId", "sessionId",
               "consentBasis", "payload", "envelope"
        FROM "AnalyticsEvent"
        WHERE "eventName" IN (${Prisma.join(LEDGER_EVENT_NAMES)})
          AND "occurredAt" >= ${from}
          AND "occurredAt" <= ${now}
          AND "payload"->>'trackId' IN (${Prisma.join(trackChunk)})
        ORDER BY "occurredAt" ASC, "eventId" ASC
        LIMIT ${remaining + 1}
      `);
      if (rows.length > remaining) {
        events.push(...rows.slice(0, remaining));
        return { events, truncated: true };
      }
      events.push(...rows);
    }
    return { events, truncated: false };
  }

  private async loadListenerIdentity(
    events: LedgerEvent[],
    ownerUserId: string | null,
  ): Promise<ListenerIdentityLoad> {
    const [consentRows, tasteRows] = await Promise.all([
      prisma.analyticsConsent.findMany({
        orderBy: { userId: "asc" },
        take: SCENE_SCOUT_READ_CAP + 1,
        select: { userId: true, productAnalytics: true, policyVersion: true },
      }),
      prisma.listenerTasteMemorySettings.findMany({
        orderBy: { userId: "asc" },
        take: SCENE_SCOUT_READ_CAP + 1,
        select: { userId: true, resetAt: true, agentPlaybackTrainingEnabled: true },
      }),
    ]);
    if (
      consentRows.length > SCENE_SCOUT_READ_CAP ||
      tasteRows.length > SCENE_SCOUT_READ_CAP
    ) {
      return {
        context: {
          canonicalActorIds: new Map(),
          grantedConsentActors: new Set(),
          tastePolicies: new Map(),
          ownerActorId: null,
        },
        incomplete: true,
      };
    }

    const canonicalActorIds = new Map<string, string>();
    const canonicalByUserId = new Map<string, string>();
    const registerUser = (userId: string) => {
      const canonical = `user:${userId.toLowerCase()}`;
      canonicalByUserId.set(userId, canonical);
      for (const alias of actorKeys(userId)) canonicalActorIds.set(alias, canonical);
      return canonical;
    };

    for (const row of consentRows) registerUser(row.userId);
    for (const row of tasteRows) registerUser(row.userId);
    const ownerActorId = ownerUserId ? registerUser(ownerUserId) : null;

    // A bounded event window can contain both identity forms even if an
    // account lacks a current consent row (for example, contract settlements).
    // Pair them in memory so one person cannot inflate audience counts.
    const eventActors = new Set(
      events.map((event) => event.actorId).filter((actorId): actorId is string => Boolean(actorId)),
    );
    const hashedActorId = /^user_[0-9a-f]{32}$/i;
    for (const rawActorId of eventActors) {
      if (hashedActorId.test(rawActorId)) continue;
      const hashedActor = pseudonymousAnalyticsActorId(rawActorId);
      if (!hashedActor || !eventActors.has(hashedActor)) continue;
      const canonical =
        canonicalByUserId.get(rawActorId) ?? `observed-user:${rawActorId.toLowerCase()}`;
      canonicalActorIds.set(rawActorId, canonical);
      canonicalActorIds.set(hashedActor, canonical);
    }

    const grantedConsentActors = new Set<string>();
    for (const row of consentRows) {
      if (
        row.productAnalytics &&
        row.policyVersion === ANALYTICS_CONSENT_POLICY_VERSION
      ) {
        grantedConsentActors.add(canonicalByUserId.get(row.userId)!);
      }
    }

    const tastePolicies = new Map<string, ListenerTastePolicy>();
    for (const row of tasteRows) {
      tastePolicies.set(canonicalByUserId.get(row.userId)!, {
        resetAt: row.resetAt,
        agentPlaybackTrainingEnabled: row.agentPlaybackTrainingEnabled,
      });
    }
    return {
      context: { canonicalActorIds, grantedConsentActors, tastePolicies, ownerActorId },
      incomplete: false,
    };
  }

  private async loadCanonicalPurchases(events: LedgerEvent[], from: Date, now: Date): Promise<CanonicalPurchaseLoad> {
    const candidates = events.filter((event) => {
      if (
        event.eventName !== "x402.purchase" ||
        event.producer !== "x402-controller" ||
        !SETTLEMENT_CONSENT_BASES.has(event.consentBasis ?? "")
      ) {
        return false;
      }
      const payload = jsonObject(event.payload);
      return (
        typeof payload.receiptId === "string" &&
        payload.receiptId.length > 0 &&
        typeof payload.transactionHash === "string" &&
        payload.transactionHash.length > 0 &&
        (payload.paymentRail === "facilitator" || payload.paymentRail === "smart_account")
      );
    });
    const receiptIds = [...new Set(candidates.map((event) => String(jsonObject(event.payload).receiptId)))];
    if (receiptIds.length === 0) return { purchases: new Map(), incomplete: false };

    const settlements = await prisma.x402Settlement.findMany({
      where: {
        receiptId: { in: receiptIds },
        status: { in: SUCCESSFUL_X402_SETTLEMENT_STATUSES },
        purchasedAt: { gte: from, lte: now },
      },
      select: {
        receiptId: true,
        payerAddress: true,
        stem: { select: { trackId: true } },
        moment: { select: { drop: { select: { trackId: true } } } },
      },
    });
    const payerAddresses = [...new Set(
      settlements
        .map((settlement) => settlement.payerAddress?.trim().toLowerCase())
        .filter((address): address is string => Boolean(address)),
    )];
    if (payerAddresses.length === 0) return { purchases: new Map(), incomplete: false };

    const wallets = await prisma.wallet.findMany({
      where: { address: { in: payerAddresses, mode: "insensitive" } },
      orderBy: { id: "asc" },
      take: SCENE_SCOUT_READ_CAP + 1,
      select: { address: true, userId: true },
    });
    if (wallets.length > SCENE_SCOUT_READ_CAP) {
      return { purchases: new Map(), incomplete: true };
    }
    const userIdsByAddress = new Map<string, Set<string>>();
    for (const wallet of wallets) {
      const address = wallet.address.trim().toLowerCase();
      const users = userIdsByAddress.get(address) ?? new Set<string>();
      users.add(wallet.userId);
      userIdsByAddress.set(address, users);
    }
    const canonicalUserByAddress = new Map<string, string>();
    for (const [address, userIds] of userIdsByAddress) {
      // An address linked to more than one account is ambiguous and cannot
      // establish a unique listener identity for contract settlement demand.
      if (userIds.size !== 1) continue;
      const userId = userIds.values().next().value as string | undefined;
      if (userId) canonicalUserByAddress.set(address, `user:${userId.toLowerCase()}`);
    }

    const purchases = new Map<string, CanonicalPurchase>();
    for (const settlement of settlements) {
      const trackId = settlement.stem?.trackId ?? settlement.moment?.drop.trackId;
      const payerAddress = settlement.payerAddress?.trim().toLowerCase();
      const canonicalActorId = payerAddress ? canonicalUserByAddress.get(payerAddress) : undefined;
      if (!trackId || !payerAddress || !canonicalActorId) continue;
      const pseudonymousWalletId = pseudonymousAnalyticsActorId(payerAddress);
      purchases.set(settlement.receiptId, {
        trackId,
        canonicalActorId,
        actorAliases: new Set(
          [payerAddress, pseudonymousWalletId?.toLowerCase()].filter(
            (alias): alias is string => Boolean(alias),
          ),
        ),
      });
    }
    return { purchases, incomplete: false };
  }

  private async replaceSnapshots(artistId: string, rows: SceneScoutCityDemandRow[]) {
    await prisma.$transaction(async (tx) => {
      const lockKey = `scene-scout-city-demand:${artistId}`;
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS acquired
      `);
      await tx.sceneScoutCityDemand.deleteMany({ where: { artistId } });
      const qualifyingRows = rows.filter((row) =>
        sceneScoutMeetsAudienceThreshold(row.uniqueListeners),
      );
      if (qualifyingRows.length > 0) {
        await tx.sceneScoutCityDemand.createMany({
          data: qualifyingRows.map((row) => ({
            artistId,
            releaseId: row.releaseId,
            releaseTitle: row.releaseTitle,
            citySlug: row.citySlug,
            countryCode: row.countryCode,
            windowDays: row.windowDays,
            resonantListeners: row.resonantListeners,
            saves: row.saves,
            follows: row.follows,
            purchases: row.purchases,
            pledges: row.pledges,
            uniqueListeners: row.uniqueListeners,
            signalCount: row.signalCount,
            computedAt: row.computedAt,
          })),
        });
      }
    });
  }
}
