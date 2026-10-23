import "dotenv/config";
import { chmodSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma";
import {
  formatAttestationReportSummary,
  runAttestationCandidateReport,
  type AttestationCandidateReport,
} from "../modules/catalog/ai-disclosure-attestation";
import { writeStructuredLog } from "../modules/shared/structured_logging";

/**
 * #2252 - READ-ONLY report of the releases that still carry an `UNDECLARED`
 * AI disclosure, each placed in exactly one bucket:
 *
 * - `proposed`     signals support an attestation; a person still decides;
 * - `needs_review` some signal exists but evidence is incomplete or conflicts;
 * - `excluded`     `ai_generated`, remix, any `generationMetadata`, or no
 *                  supporting signal at all.
 *
 * The rules and their reasons live in `classifyAttestationCandidate`
 * (`modules/catalog/ai-disclosure-attestation.ts`). Signals only propose.
 *
 * The output is the raw material for the reviewed manifest: the JSON carries
 * a `manifestDraft` of the proposed release ids. The operator edits it down to
 * the releases they approve and passes that file to
 * `apply_ai_disclosure_attestation.ts`. The manifest is an input for one
 * environment and is never committed.
 *
 * Needs only a database URL (`DATABASE_URL`); no application boot, and it
 * writes nothing to the database.
 *
 * Output:
 * - default: a readable summary (counts per bucket and reason tallies);
 * - `--json`: the full report as JSON on stdout (and nothing else);
 * - `--out <path>`: also write the full JSON report to a local file with
 *   owner-only permissions.
 *
 * Exit codes: `0` when the report completed, `1` on a bad flag or an error.
 *
 * Usage: `node dist/scripts/report_ai_disclosure_attestation_candidates.js [--json] [--out <path>]`
 */
export function parseReportArgs(argv: string[]): { json: boolean; out?: string } {
  let json = false;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--out needs a file path");
      out = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { json, out };
}

export async function runAttestationReportScript(
  argv: string[] = process.argv.slice(2),
): Promise<AttestationCandidateReport> {
  const args = parseReportArgs(argv);
  try {
    const report = await runAttestationCandidateReport(prisma);
    if (args.out) {
      writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      chmodSync(args.out, 0o600);
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatAttestationReportSummary(report)}\n`);
      if (args.out) process.stdout.write(`full report written to ${args.out}\n`);
    }
    return report;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runAttestationReportScript()
    .then(() => process.exit(0))
    .catch((error) => {
      writeStructuredLog({
        level: "error",
        event: "catalog.ai_disclosure_attestation.report_failed",
        message: "AI disclosure attestation report could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
