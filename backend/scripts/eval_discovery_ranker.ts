#!/usr/bin/env npx ts-node
/**
 * Offline evaluation of the discovery ranker (#1455 WS-8): recall@k and NDCG@k
 * against held-out positive implicit feedback from the #978 training table
 * (`user_track_signal_training`), next to a popularity baseline and a seeded
 * random floor.
 *
 * Why a script and not SQL: the ranker's ordering is TypeScript
 * (`DiscoveryRankingService` plus the policy-free scoring core); it cannot be
 * reproduced in BigQuery SQL. This script loads a bounded sample of the table
 * (exported by an operator), resolves tracks from the catalog database, runs
 * the real ranker, and scores it with `rankingMetrics`.
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/eval_discovery_ranker.ts \
 *     --signals ./signals.ndjson [--k 10] [--holdout 0.3] [--max-users 500] \
 *     [--out ./eval-results/discovery-ranker-eval.json]
 *
 * Input: newline-delimited JSON, or a JSON array (what `bq query
 * --format=json` prints), with the columns `user_id`, `track_id`,
 * `signal_weight`, `occurred_at`. Reads DATABASE_URL for the catalog. Read-only.
 * The sample holds pseudonymous ids: keep the file local and do not commit it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { prisma } from "../src/db/prisma";
import { DiscoveryRankingService } from "../src/modules/recommendations/discovery-ranking.service";
import {
  DEFAULT_EVAL_OPTIONS,
  evaluateRanker,
  popularityRanker,
  seededRandomRanker,
  splitSignalsByTime,
  type EvalCandidate,
  type EvalRanker,
  type TrainingSignal,
} from "../src/modules/recommendations/discovery_offline_eval";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArgument(name: string, fallback: number) {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

function parseRows(text: string): Array<Record<string, unknown>> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function toSignals(rows: Array<Record<string, unknown>>): TrainingSignal[] {
  const signals: TrainingSignal[] = [];
  for (const row of rows) {
    const weight = Number(row.signal_weight);
    const occurredAt = new Date(String(row.occurred_at));
    if (!row.user_id || !row.track_id || !Number.isFinite(weight) || Number.isNaN(occurredAt.getTime())) continue;
    signals.push({ userId: String(row.user_id), trackId: String(row.track_id), weight, occurredAt });
  }
  return signals;
}

async function main() {
  const path = argument("signals");
  if (!path) throw new Error("--signals <file> is required (see the usage comment)");
  const k = numberArgument("k", DEFAULT_EVAL_OPTIONS.k);
  const holdoutFraction = numberArgument("holdout", DEFAULT_EVAL_OPTIONS.holdoutFraction);
  const maxUsers = numberArgument("max-users", DEFAULT_EVAL_OPTIONS.maxUsers);

  const signals = toSignals(parseRows(readFileSync(path, "utf8")));
  const splits = splitSignalsByTime(signals, holdoutFraction).slice(0, maxUsers);
  console.log(`signals=${signals.length} evaluable_users=${splits.length}`);
  if (splits.length === 0) {
    console.log("No listener has two positive tracks in the sample; nothing to evaluate.");
    return;
  }

  // Candidate pool: the catalog tracks seen in the sample, public releases only.
  const trackIds = [...new Set(signals.map((signal) => signal.trackId))];
  const tracks = await prisma.track.findMany({
    where: { id: { in: trackIds }, release: { status: { in: ["ready", "published"] } } },
    select: {
      id: true,
      title: true,
      release: { select: { genre: true, title: true, moods: true, artistId: true } },
    },
    orderBy: { id: "asc" },
  });
  const catalogById = new Map(tracks.map((track) => [track.id, track]));
  const candidates: EvalCandidate[] = tracks.map((track) => ({ id: track.id, genre: track.release.genre }));
  console.log(`candidate_pool=${candidates.length}`);

  const core = new DiscoveryRankingService();
  const discoveryRanker: EvalRanker = async ({ candidates: pool, learnedGenreWeights }) => {
    const ranked = await core.rank(
      pool.map((candidate) => {
        const track = catalogById.get(candidate.id)!;
        return {
          id: track.id,
          title: track.title,
          artistId: track.release.artistId,
          release: { genre: track.release.genre, title: track.release.title, moods: track.release.moods },
        };
      }),
      // Offline sample: only the learned-genre signal is reproducible. Taste
      // queries, cohorts, embeddings and warehouse scores are not in the sample.
      { originalQueries: [], expandedQueries: [], learnedGenreWeights },
    );
    return ranked.map((entry) => entry.id);
  };

  const options = { k, holdoutFraction, maxUsers };
  const report = {
    generatedAt: new Date().toISOString(),
    options,
    sample: { signals: signals.length, evaluableUsers: splits.length, candidatePool: candidates.length },
    note: "Sampled-ranking metrics over the candidate pool in the sample; compare rankers on the same sample.",
    rankers: {
      discovery_ranker: await evaluateRanker({ splits, candidates, ranker: discoveryRanker, options }),
      popularity: await evaluateRanker({ splits, candidates, ranker: popularityRanker(splits), options }),
      random: await evaluateRanker({ splits, candidates, ranker: seededRandomRanker(1), options }),
    },
  };

  console.table(
    Object.entries(report.rankers).map(([name, metrics]) => ({
      ranker: name,
      [`recall@${k}`]: metrics.recallAtK?.toFixed(4) ?? "n/a",
      [`ndcg@${k}`]: metrics.ndcgAtK?.toFixed(4) ?? "n/a",
      users: metrics.evaluatedUsers,
    })),
  );

  const out = argument("out");
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${out}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
