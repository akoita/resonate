/**
 * Operator generation-credit grant (#1334).
 *
 * A one-command way to top up any account's generation-credit balance without
 * standing up an operator JWT — mirrors the operator-only `POST /credits/grant`
 * endpoint, but runs directly against the database (the operator ergonomics
 * called for by the contract-ops one-click convention).
 *
 * Usage (any context that already exposes DATABASE_URL — local, or a deployed
 * env via a one-off job):
 *
 *   DATABASE_URL="<db-url>" npm run credits:grant -- \
 *     --user <userId> --amount <cents> [--reason <text>]
 *
 * Amount is in USD cents (e.g. 100 = $1.00). Reason defaults to
 * "operator_grant" and is recorded on the append-only credit ledger.
 *
 * This writes straight to the ledger via GenerationCreditsService.grant, which
 * upserts the account, increments the balance atomically, and appends a `grant`
 * transaction. Note: run standalone (no NestJS app), so no EventBus subscriber
 * is attached — the grant is durable but does NOT emit a
 * `generation.credits_granted` analytics event. Use the API endpoint when you
 * need the grant reflected in analytics.
 */
import { prisma } from "../db/prisma";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main() {
  const userId = arg("user");
  const amountRaw = arg("amount");
  const reason = arg("reason") ?? "operator_grant";

  if (!userId || !amountRaw) {
    console.error(
      "Usage: npm run credits:grant -- --user <userId> --amount <cents> [--reason <text>]",
    );
    process.exit(2);
    return;
  }

  const amountCents = Number.parseInt(amountRaw, 10);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    console.error(`Invalid --amount "${amountRaw}": must be a positive integer number of cents.`);
    process.exit(2);
    return;
  }

  // Constructed standalone: no ConfigService/EventBus, so grant() writes to the
  // ledger without publishing (see the module note above).
  const credits = new GenerationCreditsService();
  const balanceCents = await credits.grant(userId, amountCents, reason);

  console.log(
    JSON.stringify(
      { userId, grantedCents: amountCents, reason, balanceCents },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
}
