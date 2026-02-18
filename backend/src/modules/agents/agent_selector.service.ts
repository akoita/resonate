import { Injectable, Logger } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";
import type { CuratorAgentService } from "./curator_agent.service";

export interface AgentSelectorInput {
  queries?: string[];
  recentTrackIds: string[];
  allowExplicit?: boolean;
  useEmbeddings?: boolean;
  limit?: number;
  /** Minimum quality score (0-100). Stems below this are deprioritised. */
  qualityThreshold?: number;
}

@Injectable()
export class AgentSelectorService {
  private readonly logger = new Logger(AgentSelectorService.name);
  private curatorService: CuratorAgentService | null = null;

  constructor(private readonly tools: ToolRegistry) { }

  /** Set curator service reference (avoids circular DI). */
  setCuratorService(service: CuratorAgentService) {
    this.curatorService = service;
  }

  async select(input: AgentSelectorInput) {
    const queries = (input.queries ?? []).filter(Boolean);
    const limit = input.limit ?? 5;

    // Gather candidates from all vibes/queries
    const seen = new Set<string>();
    let allCandidates: any[] = [];

    for (const query of queries.length > 0 ? queries : [""]) {
      const tool = this.tools.get("catalog.search");
      const result = await tool.run({
        query,
        limit: 20,
        allowExplicit: input.allowExplicit ?? false,
      });
      const items = (result.items as any[]) ?? [];
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          allCandidates.push(item);
        }
      }
    }

    if (allCandidates.length === 0) {
      return { candidates: [], selected: [] };
    }

    // Optionally rank by embedding similarity to the combined query
    if (input.useEmbeddings && allCandidates.length > 1 && queries.length > 0) {
      const combinedQuery = queries.join(" ");
      const ranked = await this.tools.get("embeddings.similarity").run({
        query: combinedQuery,
        candidates: allCandidates.map((track) => track.id),
      });
      const rankedIds = (ranked.ranked as { trackId: string }[]) ?? [];
      const ordered = rankedIds
        .map((entry) => allCandidates.find((track) => track.id === entry.trackId))
        .filter(Boolean) as any[];
      if (ordered.length) {
        allCandidates = ordered;
      }
    }

    // Stable-sort: listed tracks first (preserves embedding rank within each group)
    allCandidates.sort((a: any, b: any) => {
      const aListed = a.hasListing ? 1 : 0;
      const bListed = b.hasListing ? 1 : 0;
      return bListed - aListed;
    });

    // ─── Quality filter ──────────────────────────────────────
    // Deprioritise low-quality tracks (sort to bottom, don't hard-filter)
    const qualityThreshold = input.qualityThreshold
      ?? Number(process.env.AGENT_QUALITY_THRESHOLD ?? "30");

    if (this.curatorService) {
      try {
        const trackIds = allCandidates.map((t: any) => t.id);
        const qualityMap = await this.curatorService.lookupTrackQuality(trackIds);

        if (qualityMap.size > 0) {
          // Stable-sort by quality: rated-and-above-threshold first,
          // then unrated, then rated-but-below-threshold
          allCandidates.sort((a: any, b: any) => {
            const aScore = qualityMap.get(a.id);
            const bScore = qualityMap.get(b.id);
            const aGroup = aScore === undefined ? 1 : aScore >= qualityThreshold ? 0 : 2;
            const bGroup = bScore === undefined ? 1 : bScore >= qualityThreshold ? 0 : 2;
            if (aGroup !== bGroup) return aGroup - bGroup;
            // Within same group, prefer higher scores
            return (bScore ?? 0) - (aScore ?? 0);
          });

          this.logger.debug(
            `Quality-sorted ${allCandidates.length} candidates (${qualityMap.size} rated, threshold=${qualityThreshold})`,
          );
        }
      } catch (err) {
        this.logger.warn(`Quality lookup failed, proceeding without: ${err}`);
      }
    }

    // Filter out recently played tracks, then take up to `limit`
    const fresh = allCandidates.filter(
      (track) => !input.recentTrackIds.includes(track.id)
    );
    const pool = fresh.length > 0 ? fresh : allCandidates;
    const selected = pool.slice(0, limit);

    return {
      candidates: allCandidates.map((track) => track.id),
      selected,
    };
  }
}
