import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { ArtistAnalyticsReportSource } from "../modules/analytics/analytics_bigquery_report";
import type { AnalyticsFactRow } from "../modules/analytics/analytics_warehouse";
import type { ResonantDiscoverySource } from "../modules/analytics/analytics_resonant_discovery";
import {
  buildDiscoveryQualityReport,
  isDiscoveryOnlyFact,
  isHomeDiscoveryFact,
} from "../modules/analytics/analytics_discovery_quality";

let sequence = 0;
function fact(
  eventName: string,
  dimensions: Record<string, unknown> = {},
  count = 1,
): AnalyticsFactRow {
  sequence += 1;
  return {
    factId: `fact_${sequence}`,
    factType: `${eventName.split(".")[0]}_event`,
    eventId: `evt_${sequence}`,
    occurredAt: "2026-09-29T10:00:00.000Z",
    occurredDate: "2026-09-29",
    count,
    dimensions: { eventName, ...dimensions },
  };
}

const home = (railId: string, variant?: string, experimentKey = "exp") => ({
  railId,
  source: "home",
  ...(variant ? { rankerVariant: variant, experimentKey } : {}),
});

function seededFacts(): AnalyticsFactRow[] {
  return [
    // Home rail because_genre: baseline vs candidate.
    fact("recommendation.served", { ...home("because_genre", "baseline"), itemCount: 8 }),
    fact("recommendation.served", { ...home("because_genre", "candidate"), itemCount: 8 }),
    fact("recommendation.clicked", home("because_genre", "baseline")),
    fact("recommendation.clicked", home("because_genre", "baseline")),
    fact("recommendation.clicked", home("because_genre", "candidate")),
    ...Array.from({ length: 4 }, () => fact("playback.started", home("because_genre", "baseline"))),
    ...Array.from({ length: 2 }, () => fact("playback.started", home("because_genre", "candidate"))),
    fact("playback.skipped", home("because_genre", "baseline")),
    fact("playback.skipped", home("because_genre", "candidate")),
    fact("playback.completed", home("because_genre", "baseline")),
    fact("playback.completed", home("because_genre", "baseline")),
    fact("playback.completed", home("because_genre", "candidate")),
    fact("library.saved", home("because_genre", "baseline")),
    // Another rail, old client without a variant.
    fact("recommendation.served", { railId: "exploration", source: "home", itemCount: 4 }),
    fact("playback.started", { railId: "exploration", source: "web_player" }),
    // Generations (exposure), Home and DJ.
    fact("recommendation.generated", { surface: "home", rankerVariant: "baseline", experimentKey: "exp" }),
    fact("recommendation.generated", { surface: "home", rankerVariant: "candidate", experimentKey: "exp" }),
    fact("recommendation.generated", { surface: "dj", rankerVariant: "candidate", experimentKey: "exp" }, 3),
    // AI DJ session: agent events plus plays sharing the session id.
    fact("agent.session_started", { sessionId: "s1", source: "agent_command_bar" }),
    fact("agent.next_pick_requested", { sessionId: "s1", status: "ok", trackId: "t1" }),
    fact("agent.next_pick_requested", { sessionId: "s1", status: "no_tracks" }),
    fact("playback.started", { sessionId: "s1", source: "web_player" }),
    fact("playback.started", { sessionId: "s1", source: "web_player" }),
    fact("playback.skipped", { sessionId: "s1", source: "web_player" }),
    fact("playback.completed", { sessionId: "s1", source: "web_player", completionRatio: 1 }),
    // Not a discovery surface: a plain play outside any DJ session.
    fact("playback.started", { sessionId: "other", source: "web_player" }),
    fact("library.saved", { sessionId: "other", source: "web_player" }),
  ];
}

describe("buildDiscoveryQualityReport", () => {
  it("aggregates per surface with rate math", () => {
    const facts = seededFacts();
    const djFacts = new Set(facts.filter((f) => f.dimensions.sessionId === "s1"));
    const report = buildDiscoveryQualityReport(facts, djFacts);

    const byGenre = report.surfaceBreakdown.find((row) => row.surface === "home:because_genre");
    expect(byGenre).toEqual({
      surface: "home:because_genre",
      impressions: 16,
      clicks: 3,
      plays: 6,
      completions: 3,
      skips: 2,
      saves: 1,
      clickThroughRate: 0.1875,
      skipRate: 0.3333,
      completionRate: 0.5,
      saveRate: 0.1667,
    });

    const dj = report.surfaceBreakdown.find((row) => row.surface === "dj");
    expect(dj).toEqual(
      expect.objectContaining({
        impressions: 1,
        clicks: 0,
        plays: 2,
        skips: 1,
        completions: 1,
        skipRate: 0.5,
        clickThroughRate: 0,
      }),
    );

    // The plain play and save outside any session are not attributed anywhere.
    expect(report.surfaceBreakdown.map((row) => row.surface).sort()).toEqual([
      "dj",
      "home:because_genre",
      "home:exploration",
    ]);
  });

  it("returns 0 rates on zero denominators", () => {
    const facts = [fact("recommendation.clicked", home("r1", "baseline"))];
    const report = buildDiscoveryQualityReport(facts, new Set());
    expect(report.surfaceBreakdown[0]).toEqual(
      expect.objectContaining({
        clicks: 1,
        impressions: 0,
        clickThroughRate: 0,
        skipRate: 0,
        completionRate: 0,
        saveRate: 0,
      }),
    );
  });

  it("groups by variant, keeps unattributed apart and compares to baseline", () => {
    const facts = seededFacts();
    const djFacts = new Set(facts.filter((f) => f.dimensions.sessionId === "s1"));
    const report = buildDiscoveryQualityReport(facts, djFacts);

    const variants = report.variantBreakdown
      .filter((row) => row.surface === "home:because_genre")
      .map((row) => [row.variant, row.plays, row.skips]);
    expect(variants).toEqual([
      ["baseline", 4, 1],
      ["candidate", 2, 1],
    ]);
    expect(
      report.variantBreakdown.find((row) => row.surface === "home:exploration")?.variant,
    ).toBe("unattributed");
    expect(report.variantBreakdown.find((row) => row.surface === "dj")?.variant).toBe("unattributed");

    expect(report.comparison.rows).toEqual([
      {
        experimentKey: "exp",
        surface: "home:because_genre",
        variant: "candidate",
        baselineVariant: "baseline",
        sampleSize: {
          baselineImpressions: 8,
          variantImpressions: 8,
          baselinePlays: 4,
          variantPlays: 2,
        },
        deltas: {
          // candidate minus baseline
          clickThroughRate: -0.125, // 1/8 - 2/8
          skipRate: 0.25, // 1/2 - 1/4
          completionRate: 0, // 1/2 - 2/4
          saveRate: -0.25, // 0 - 1/4
        },
      },
    ]);
    expect(report.comparison.note).toMatch(/no significance test/);
  });

  it("attributes DJ-surface outcomes to the DJ per variant without a DJ session (#2005)", () => {
    const dj = (variant?: string) => ({
      surface: "dj",
      source: "web_player",
      ...(variant ? { rankerVariant: variant, experimentKey: "exp" } : {}),
    });
    const facts = [
      // Accepted picks carry the variant the web forwarded from the pick.
      fact("agent.next_pick_requested", { sessionId: "s9", status: "ok", trackId: "t1", ...dj("baseline") }),
      fact("agent.next_pick_requested", { sessionId: "s9", status: "ok", trackId: "t2", ...dj("candidate") }),
      ...Array.from({ length: 2 }, () => fact("playback.started", dj("baseline"))),
      ...Array.from({ length: 2 }, () => fact("playback.started", dj("candidate"))),
      fact("playback.skipped", dj("candidate")),
      fact("playback.completed", dj("baseline")),
      fact("library.saved", dj("candidate")),
      // Not DJ-attributed and no rail: ignored.
      fact("playback.started", { source: "web_player" }),
    ];
    const djFacts = new Set(facts.filter((f) => f.dimensions.sessionId === "s9"));
    const report = buildDiscoveryQualityReport(facts, djFacts);

    expect(report.variantBreakdown.filter((row) => row.surface === "dj")).toEqual([
      expect.objectContaining({ variant: "baseline", impressions: 1, plays: 2, skips: 0, completions: 1, saves: 0 }),
      expect.objectContaining({ variant: "candidate", impressions: 1, plays: 2, skips: 1, completions: 0, saves: 1 }),
    ]);
    expect(report.variantBreakdown.some((row) => row.variant === "unattributed")).toBe(false);
    expect(report.surfaceBreakdown.find((row) => row.surface === "dj")).toEqual(
      expect.objectContaining({ impressions: 2, plays: 4, skips: 1, saves: 1 }),
    );
    expect(report.comparison.rows).toEqual([
      expect.objectContaining({
        surface: "dj",
        variant: "candidate",
        sampleSize: { baselineImpressions: 1, variantImpressions: 1, baselinePlays: 2, variantPlays: 2 },
        deltas: { clickThroughRate: 0, skipRate: 0.5, completionRate: -0.5, saveRate: 0.5 },
      }),
    ]);
    expect(isHomeDiscoveryFact(fact("playback.started", { surface: "dj" }))).toBe(true);
    expect(isHomeDiscoveryFact(fact("playback.started", { surface: "home" }))).toBe(false);
  });

  it("reports generations per surface and variant", () => {
    const report = buildDiscoveryQualityReport(seededFacts(), new Set());
    expect(report.variantExposure).toEqual([
      { experimentKey: "exp", surface: "dj", variant: "candidate", generations: 3 },
      { experimentKey: "exp", surface: "home", variant: "baseline", generations: 1 },
      { experimentKey: "exp", surface: "home", variant: "candidate", generations: 1 },
    ]);
  });

  it("classifies which facts the two sources must keep", () => {
    expect(isHomeDiscoveryFact(fact("recommendation.served", { railId: "r" }))).toBe(true);
    expect(isHomeDiscoveryFact(fact("playback.started", { railId: "r" }))).toBe(true);
    expect(isHomeDiscoveryFact(fact("playback.started", {}))).toBe(false);
    expect(isHomeDiscoveryFact(fact("agent.session_started", {}))).toBe(false);
    expect(isDiscoveryOnlyFact(fact("playback.started", {}))).toBe(true);
    expect(isDiscoveryOnlyFact(fact("playback.completed", {}))).toBe(false);
  });
});

describe("AnalyticsService.getAgentQualityDashboard discovery sections", () => {
  function serviceWith(
    facts: AnalyticsFactRow[],
    resonant?: ResonantDiscoverySource,
  ) {
    const reportSource: ArtistAnalyticsReportSource = {
      async listArtistFacts() {
        return null;
      },
      async listAgentQualityFacts() {
        return {
          facts,
          metadata: {
            source: "bigquery",
            generatedAt: "2026-09-30T00:00:00.000Z",
            timeWindow: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z", days: 30 },
            freshness: { asOf: "2026-09-29T10:00:00.000Z", lagSeconds: 0 },
            isEmpty: facts.length === 0,
            cache: { hit: false, ttlSeconds: 0 },
          },
        };
      },
    };
    return new AnalyticsService(new AnalyticsIngestService(), undefined, reportSource, undefined, resonant);
  }

  it("keeps the existing summary and adds surface, variant, comparison and resonant sections", async () => {
    const analytics = serviceWith(seededFacts(), {
      getResonantDiscoveryAggregate: async () => ({
        total: 6,
        distinctNewArtists: 4,
        activeListeners: 12,
        truncated: false,
      }),
    });

    const result = await analytics.getAgentQualityDashboard(30);

    // Existing shape is intact.
    expect(result.summary.sessionsStarted).toBe(1);
    expect(result.summary.nextPickRequests).toBe(2);
    expect(result.summary.acceptedPicks).toBe(1);
    expect(result.intentBreakdown).toEqual(expect.any(Array));
    expect(result.privacy.excludes).toContain("actor ids");
    // Home-only and discovery-only facts do not leak into the DJ summary.
    expect(result.summary.firstPickOutcomes).toBe(0);

    expect(result.surfaceBreakdown.map((row) => row.surface)).toEqual(
      expect.arrayContaining(["dj", "home:because_genre", "home:exploration"]),
    );
    expect(result.variantBreakdown.length).toBeGreaterThan(0);
    expect(result.comparison.rows).toHaveLength(1);
    expect(result.resonantDiscoveries).toEqual({
      total: 6,
      distinctNewArtists: 4,
      perActiveListener: 0.5,
      activeListeners: 12,
      status: "ok",
    });
    // Aggregate only: no actor ids anywhere in the response.
    expect(JSON.stringify(result)).not.toMatch(/actorId|userId/);
  });

  it("degrades resonant discoveries to unavailable without failing the dashboard", async () => {
    const none = await serviceWith([]).getAgentQualityDashboard(30);
    expect(none.resonantDiscoveries.status).toBe("unavailable");
    expect(none.surfaceBreakdown).toEqual([]);

    const failing = await serviceWith([], {
      getResonantDiscoveryAggregate: async () => {
        throw new Error("db down");
      },
    }).getAgentQualityDashboard(30);
    expect(failing.resonantDiscoveries).toEqual(
      expect.objectContaining({ total: 0, status: "unavailable" }),
    );
  });

  it("reports no_data for zero active listeners and truncated for capped reads", async () => {
    const noData = await serviceWith([], {
      getResonantDiscoveryAggregate: async () => ({
        total: 0,
        distinctNewArtists: 0,
        activeListeners: 0,
        truncated: false,
      }),
    }).getAgentQualityDashboard(30);
    expect(noData.resonantDiscoveries).toEqual(
      expect.objectContaining({ perActiveListener: 0, status: "no_data" }),
    );

    const truncated = await serviceWith([], {
      getResonantDiscoveryAggregate: async () => ({
        total: 3,
        distinctNewArtists: 3,
        activeListeners: 3,
        truncated: true,
      }),
    }).getAgentQualityDashboard(30);
    expect(truncated.resonantDiscoveries.status).toBe("truncated");
  });

  it("keeps Home facts from the warehouse-export fallback", async () => {
    const ingest = new AnalyticsIngestService();
    const analytics = new AnalyticsService(ingest);
    const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await ingest.ingest({
      eventName: "recommendation.served",
      occurredAt: at,
      sessionId: "browser-1",
      payload: { requestId: "r1", railId: "because_genre", count: 8, source: "home", rankerVariant: "baseline" },
    });
    await ingest.ingest({
      eventName: "playback.started",
      occurredAt: at,
      subjectType: "track",
      subjectId: "track-1",
      payload: { trackId: "track-1", artistId: "a1", source: "web_player", railId: "because_genre", rankerVariant: "baseline" },
    });
    await ingest.ingest({
      eventName: "playback.started",
      occurredAt: at,
      subjectType: "track",
      subjectId: "track-2",
      payload: { trackId: "track-2", artistId: "a1", source: "web_player" },
    });

    const result = await analytics.getAgentQualityDashboard(7);

    expect(result.surfaceBreakdown).toEqual([
      expect.objectContaining({ surface: "home:because_genre", impressions: 8, plays: 1 }),
    ]);
  });
});
