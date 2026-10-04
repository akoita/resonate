#!/usr/bin/env npx ts-node
/**
 * Reproducible explicit-cutoff replay for My Mix habit lanes (#2067).
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only scripts/eval_habit_mix.ts \
 *     --signals ./signals.ndjson --catalog ./catalog.json --cutoff 2026-07-01 \
 *     [--k 10] [--max-users 500] [--out ./eval-results/habit-mix.json]
 *
 * `--signals` accepts a JSON array or NDJSON export of
 * `user_track_signal_training` with snake_case `user_id`, `track_id`,
 * `session_id`, `event_name`, `signal_type`, `signal_weight`,
 * `completion_ratio`, `occurred_at` and optional JSON `payload`. Payload
 * session/context values are read when available. Projected fixtures may use
 * `action`, `session_key` or `local_hour_bucket`/`weekday_kind` instead.
 * `--catalog` is a JSON array of `{id, genre, moods, artistId,
 * aiDisclosureLevel?}` rows. Fully AI-generated catalog rows are excluded;
 * omitted legacy disclosure remains unspecified and eligible under the
 * production policy helper. The script is pure local-file I/O: it does not
 * connect to a database or read production credentials. Keep pseudonymous
 * input exports local and do not commit them.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  evaluateHabitMixOffline,
  HabitMixCatalogRow,
  HabitMixSignalMartRow,
} from "../src/modules/recommendations/habit_mix_offline_eval";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveIntegerArgument(name: string, fallback: number): number {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function parseJsonOrNdjson(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = trimmed.startsWith("[")
    ? JSON.parse(trimmed)
    : trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (!Array.isArray(parsed)) throw new Error("input file must contain a JSON array or NDJSON rows");
  return parsed;
}

function cutoffDay(raw: string | undefined): Date {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("--cutoff must be an explicit UTC day in YYYY-MM-DD form");
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error("--cutoff is not a valid calendar day");
  }
  return date;
}

function main() {
  const signalsPath = argument("signals");
  const catalogPath = argument("catalog");
  if (!signalsPath || !catalogPath) {
    throw new Error("--signals <file> and --catalog <file> are required (see usage comment)");
  }

  const report = evaluateHabitMixOffline({
    signals: parseJsonOrNdjson(readFileSync(signalsPath, "utf8")) as HabitMixSignalMartRow[],
    catalog: parseJsonOrNdjson(readFileSync(catalogPath, "utf8")) as HabitMixCatalogRow[],
    options: {
      cutoff: cutoffDay(argument("cutoff")),
      k: positiveIntegerArgument("k", 10),
      maxUsers: positiveIntegerArgument("max-users", 500),
    },
  });

  const output = `${JSON.stringify(report, null, 2)}\n`;
  const outPath = argument("out");
  if (!outPath) {
    process.stdout.write(output);
    return;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output);
  process.stdout.write(`Wrote aggregate evaluation report to ${outPath}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
